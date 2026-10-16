
import { and, eq } from "drizzle-orm";
import { db } from "./postgres.js";
import { agentRuns } from "./schema/agent-runs.js";

export async function claimRunResume(runId: string) {
  const [claimedRun] = await db
    .update(agentRuns)
    .set({ status: "resuming" })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.status, "awaiting_approval"),
      ),
    )
    .returning({ id: agentRuns.id });

  // Only one concurrent request can transition
  // awaiting_approval -> resuming.
  return claimedRun ?? null;
}
