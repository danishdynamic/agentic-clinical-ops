import { randomUUID } from "node:crypto";
import { db } from "./postgres.js";
import { agentRuns } from "./schema/agent-runs.js";

export async function createAgentRun(patientId: string) {
  const [run] = await db
    .insert(agentRuns)
    .values({
      id: randomUUID(),
      patientId,
      status: "PENDING",
    })
    .returning();

  return run;
}