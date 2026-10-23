import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import { recordApproval } from "../apps/api/src/db/approvals.js";
import { ApprovalAlreadyRecordedError } from "../apps/api/src/db/approval-errors.js";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Approvals Enforcement Integration Tests", () => {
  beforeEach(async () => {
    // Clean up child tables first in foreign key order
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
  });

  it("enforces a single authoritative decision per run across different idempotency keys and supports safe replays", async () => {
    const runId = crypto.randomUUID();
    const reviewerIdA = crypto.randomUUID();
    const reviewerIdB = crypto.randomUUID();

    // 1. Create a run in awaiting_approval
    await db.insert(agentRuns).values({
      id: runId,
      status: "awaiting_approval",
      patientId: "synthetic-patient-001",
    });

    // 2. Record the first approved decision with key approval-key-A
    const firstResult = await recordApproval({
      runId,
      idempotencyKey: "approval-key-A",
      decision: "approved",
      reviewerId: reviewerIdA,
    });

    expect(firstResult.replayed).toBe(false);
    expect(firstResult.approval.decision).toBe("approved");

    // 3. Attempt a second decision using a different idempotency key (approval-key-B) and rejected status
    await expect(
      recordApproval({
        runId,
        idempotencyKey: "approval-key-B",
        decision: "rejected",
        reviewerId: reviewerIdB,
      })
    ).rejects.toThrow(ApprovalAlreadyRecordedError);

    // 4. Verify the original decision remains unchanged
    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);
    expect(approvalRecords[0].decision).toBe("approved");
    expect(approvalRecords[0].idempotencyKey).toBe("approval-key-A");

    // 5. Verify the approval audit event count remains one
    const auditLogs = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].eventType).toBe("approval_granted");

    // 6. Verify existing idempotency replay tests still pass (replaying same key & decision)
    const replayResult = await recordApproval({
      runId,
      idempotencyKey: "approval-key-A",
      decision: "approved",
      reviewerId: reviewerIdA,
    });

    expect(replayResult.replayed).toBe(true);
    expect(replayResult.approval.id).toBe(firstResult.approval.id);

    // Audit event count should still be 1 after replay
    const auditLogsAfterReplay = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(auditLogsAfterReplay).toHaveLength(1);
  });
});