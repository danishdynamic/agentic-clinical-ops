import { Command } from "@langchain/langgraph";
import { eq } from "drizzle-orm";

import { db } from "../db/postgres.js";
import { approvals } from "../db/schema/approvals.js";
import { agentRuns } from "../db/schema/agent-runs.js";
import { claimRunResume } from "../db/claim-run-resume.js";
import { triageGraph } from "./triage-graph.js";

export async function resumeTriageWorkflow(runId: string) {
  // 1. Atomically claim the run from 'awaiting_approval' -> 'resuming'
  const claimedRun = await claimRunResume(runId);
  if (!claimedRun) {
    throw new Error(
      `Run ${runId} cannot be claimed for resume. It may already be resuming, completed, or not awaiting approval.`,
    );
  }

  // 2. Load the saved approval record
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

  // 3. Retrieve the trusted thread ID from the database record 
  // (Assuming threadId is stored on agentRuns, or if runId is used as the thread_id)
  const [runRecord] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);

  if (!runRecord) {
    throw new Error(`Agent run not found for ID: ${runId}`);
  }

  // Use the trusted thread reference (e.g., runRecord.threadId or runId)
  const threadId = runId; // Or runRecord.threadId if you added it to the schema

  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  // 4. Verify the workflow thread is currently paused at the approval interrupt
  const currentState = await triageGraph.getState(config);
  if (!currentState.next || !currentState.next.includes("approval")) {
    throw new Error(
      "Workflow is not paused at an approval interrupt or has already completed.",
    );
  }

  try {
    const result = await triageGraph.invoke(
      new Command({
        resume: { approved: approvalRecord.decision === "approved" },
      }),
      config,
    );

    // TODO: Update agent run status to 'completed' upon successful finish
    return result;
  } catch (error) {
    // TODO: Handle failure state transition if graph invocation throws
    throw error;
  }
}