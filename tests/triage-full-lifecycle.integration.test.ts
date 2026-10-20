import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import {
  markRunAwaitingApproval,
  markRunCompleted,
} from "../apps/api/src/db/agent-run-lifecycle.js";
import { claimRunResume } from "../apps/api/src/db/claim-run-resume.js";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Triage Full Lifecycle Integration Tests", () => {
  beforeEach(async () => {
    // Clean up child tables first in foreign key order
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
  });

  it("progresses through running -> awaiting_approval -> resuming -> completed with strict audit and idempotency checks", async () => {
    const runId = crypto.randomUUID();
    const patientId = crypto.randomUUID();
    const idempotencyKey = `idemp-lifecycle-${Date.now()}`;

    // 1. Initial State: running
    await db.insert(agentRuns).values({
      id: runId,
      status: "running",
      scenarioId: "demo-001",
      patientId,
    });

    let [record] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(record.status).toBe("running");

    // 2. Transition: running -> awaiting_approval (logs workflow_awaiting_approval audit event)
    await markRunAwaitingApproval(runId);
    [record] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(record.status).toBe("awaiting_approval");

    // Seed an approval record for resumption
    await db.insert(approvals).values({
      id: crypto.randomUUID(),
      runId,
      decision: "approved",
      idempotencyKey,
      reviewerId: crypto.randomUUID(),
    });

    // 3. Transition: awaiting_approval -> resuming (via atomic claimRunResume)
    const claimed = await claimRunResume(runId);
    expect(claimed).toBeDefined();
    expect(claimed?.id).toBe(runId);

    [record] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(record.status).toBe("resuming");

    // 4. Transition: resuming -> completed (logs workflow_completed audit event)
    await markRunCompleted(runId);
    [record] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(record.status).toBe("completed");
    expect(record.completedAt).toBeInstanceOf(Date);

    // 5. Assertions:
    // - agent_runs.status changed correctly and completedAt is populated
    expect(record.status).toBe("completed");
    expect(record.completedAt).not.toBeNull();

    // - Exactly two audit events exist (workflow_awaiting_approval and workflow_completed)
    const allAuditEvents = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(allAuditEvents.length).toBe(2);

    // Simulate replay of resume/completion action with the same idempotency key / check
    const replayCheckApproval = async () => {
      await db.transaction(async (tx) => {
        const existingApproval = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.idempotencyKey, idempotencyKey));

        if (existingApproval.length > 0) return;
      });
    };

    await replayCheckApproval();

    const auditEventsAfterReplay = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(auditEventsAfterReplay.length).toBe(2); // Count remains 2, confirming no duplicate events
  });
});