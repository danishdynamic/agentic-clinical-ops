import { describe, expect, it, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { recordApproval } from "../apps/api/src/db/approvals.js";
import { createAgentRun } from "../apps/api/src/db/agent-runs.js";
import { db } from "../apps/api/src/db/postgres.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";

describe("recordApproval integration tests", () => {
  let testRunId: string;
  let otherRunId: string;

  beforeEach(async () => {
    // Create valid agent runs to satisfy the foreign key constraint on runId
    const run1 = await createAgentRun("patient-001");
    testRunId = run1.id;

    const run2 = await createAgentRun("patient-002");
    otherRunId = run2.id;
  });

  it("inserts one record on first approval and returns replayed: false", async () => {
    const idempotencyKey = `key-${Date.now()}-first`;
    const result = await recordApproval({
      runId: testRunId,
      idempotencyKey,
      decision: "approved",
      reviewerId: "dr-smith",
    });

    expect(result.replayed).toBe(false);
    expect(result.approval).toBeDefined();
    expect(result.approval.idempotencyKey).toBe(idempotencyKey);
    expect(result.approval.decision).toBe("approved");
  });

  it("returns the same record with replayed: true on an identical retry", async () => {
    const idempotencyKey = `key-${Date.now()}-retry`;
    const input = {
      runId: testRunId,
      idempotencyKey,
      decision: "approved" as const,
      reviewerId: "dr-smith",
    };

    const first = await recordApproval(input);
    expect(first.replayed).toBe(false);

    const second = await recordApproval(input);
    expect(second.replayed).toBe(true);
    expect(second.approval.id).toBe(first.approval.id);
  });

  it("rejects when using the same key with a different decision", async () => {
    const idempotencyKey = `key-${Date.now()}-diff-decision`;
    await recordApproval({
      runId: testRunId,
      idempotencyKey,
      decision: "approved",
      reviewerId: "dr-smith",
    });

    await expect(
      recordApproval({
        runId: testRunId,
        idempotencyKey,
        decision: "rejected", // Changed decision
        reviewerId: "dr-smith",
      }),
    ).rejects.toThrow(
      "Idempotency key was already used for a different approval request",
    );
  });

  it("rejects when using the same key with a different run", async () => {
    const idempotencyKey = `key-${Date.now()}-diff-run`;
    await recordApproval({
      runId: testRunId,
      idempotencyKey,
      decision: "approved",
      reviewerId: "dr-smith",
    });

    await expect(
      recordApproval({
        runId: otherRunId, // Different run ID
        idempotencyKey,
        decision: "approved",
        reviewerId: "dr-smith",
      }),
    ).rejects.toThrow(
      "Idempotency key was already used for a different approval request",
    );
  });

  it("handles concurrent identical requests and results in only one database record", async () => {
    const idempotencyKey = `key-${Date.now()}-concurrent`;
    const input = {
      runId: testRunId,
      idempotencyKey,
      decision: "approved" as const,
      reviewerId: "dr-smith",
    };

    // Fire multiple identical insertion attempts simultaneously
    const results = await Promise.all([
      recordApproval(input),
      recordApproval(input),
      recordApproval(input),
    ]);

    // All should resolve successfully, but map to the exact same underlying approval record
    const uniqueApprovalIds = new Set(results.map((r) => r.approval.id));
    expect(uniqueApprovalIds.size).toBe(1);

    // Verify there is precisely 1 record in the database table for this idempotency key
    const dbRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.idempotencyKey, idempotencyKey));

    expect(dbRecords.length).toBe(1);
  });

  it("rolls back the approval insertion if the audit event insertion fails", async () => {
    // 1. Cause the audit insert to fail by adding a check constraint that rejects a specific actorId
    await db.execute(
      sql`ALTER TABLE audit_events ADD CONSTRAINT fail_audit_actor CHECK (actor_id != 'bad-reviewer')`,
    );

    try {
      const idempotencyKey = `key-${Date.now()}-rollback`;

      // 2. Attempt to record an approval with the failing reviewerId
      await expect(
        recordApproval({
          runId: testRunId,
          idempotencyKey,
          decision: "approved",
          reviewerId: "bad-reviewer",
        }),
      ).rejects.toThrow();

      // 3. Verify that the approval row was rolled back too (does not exist in db)
      const savedApprovals = await db
        .select()
        .from(approvals)
        .where(eq(approvals.idempotencyKey, idempotencyKey));

      expect(savedApprovals.length).toBe(0);
    } finally {
      // Clean up the constraint so other tests are not affected
      await db.execute(
        sql`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS fail_audit_actor`,
      );
    }
  });
});