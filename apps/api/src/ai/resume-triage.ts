import { Command } from "@langchain/langgraph";
import { eq } from "drizzle-orm";

import { db } from "../db/postgres.js";
import { approvals } from "../db/schema/approvals.js";
import { triageGraph } from "./triage-graph.js";

export async function resumeTriageWorkflow(
  runId: string,
  threadId: string,
) {
  const [approvalRecord] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
    .limit(1);

  if (!approvalRecord) {
    throw new Error(`No approval record found for run ID: ${runId}`);
  }

  if (
    approvalRecord.decision !== "approved" &&
    approvalRecord.decision !== "rejected"
  ) {
    throw new Error("Invalid persisted approval decision");
  }

  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  // Verify the workflow thread is currently paused at the approval interrupt
  const currentState = await triageGraph.getState(config);
  if (
    !currentState.next ||
    !currentState.next.includes("approval")
  ) {
    throw new Error("Workflow is not paused at an approval interrupt or has already completed.");
  }

  return triageGraph.invoke(
    new Command({
      resume: { approved: approvalRecord.decision === "approved" },
    }),
    config,
  );
}