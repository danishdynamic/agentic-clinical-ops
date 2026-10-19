import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./postgres.js";
import { agentRuns } from "./schema/agent-runs.js";
import { auditEvents } from "./schema/audit-events.js";

export async function markRunAwaitingApproval(runId: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .update(agentRuns)
      .set({ status: "awaiting_approval" })
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.status, "running"),
        ),
      )
      .returning({ id: agentRuns.id });

    if (!run) {
      throw new Error(
        "Run does not exist or is not in running state",
      );
    }

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      runId,
      eventType: "workflow_awaiting_approval",
      actorId: "system",
      details: {},
    });

    return run;
  });
}

export async function markRunCompleted(runId: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .update(agentRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          eq(agentRuns.status, "resuming"),
        ),
      )
      .returning({ id: agentRuns.id });

    if (!run) {
      throw new Error(
        "Run does not exist or is not in resuming state",
      );
    }

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      runId,
      eventType: "workflow_completed",
      actorId: "system",
      details: {},
    });

    return run;
  });
}

export async function markRunFailed(runId: string) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .update(agentRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          inArray(agentRuns.status, [
            "running",
            "resuming",
          ]),
        ),
      )
      .returning({ id: agentRuns.id });

    if (!run) {
      throw new Error(
        "Run does not exist or is not in running or resuming state",
      );
    }

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      runId,
      eventType: "workflow_failed",
      actorId: "system",
      details: {},
    });

    return run;
  });
}