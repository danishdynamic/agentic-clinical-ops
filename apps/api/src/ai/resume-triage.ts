import { Command } from "@langchain/langgraph";
import { eq } from "drizzle-orm";

import { db } from "../db/postgres.js";
import { approvals } from "../db/schema/approvals.js";
import { agentRuns } from "../db/schema/agent-runs.js";
import { claimRunResume } from "../db/claim-run-resume.js";
import { markRunCompleted, markRunFailed } from "../db/agent-run-lifecycle.js";
import { triageGraph } from "./triage-graph.js";

export async function resumeTriageWorkflow(
  runId: string,
  graph: typeof triageGraph = triageGraph,
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

  // 3. Retrieve the trusted thread ID from the database record
  const [runRecord] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);

  if (!runRecord) {
    throw new Error(`Agent run not found for ID: ${runId}`);
  }

  const claimedRun = await claimRunResume(runId);
  if (!claimedRun) {
    throw new Error(
      `Run ${runId} cannot be claimed for resume. It may already be resuming or completed.`,
    );
  }

  const config = {
    configurable: {
      thread_id: runId,
    },
  };

  try {
    const currentState = await graph.getState(config);

    if (
      currentState.next?.length === 0 &&
      (currentState.values.approvalStatus === "approved" ||
        currentState.values.approvalStatus === "rejected")
    ) {
      await markRunCompleted(runId);
      return currentState.values;
    }

    if (!currentState.next?.includes("approval")) {
      throw new Error(
        "Workflow is not paused at an approval interrupt or a completed decision checkpoint.",
      );
    }

    const result = await graph.invoke(
      new Command({
        resume: {
          approved: approvalRecord.decision === "approved",
        },
      }),
      config,
    );

    const finalState = await graph.getState(config);

    if (finalState.next.length > 0) {
      throw new Error(
        "Workflow resumed but has not reached a terminal state",
      );
    }

    // Centralized lifecycle completion
    await markRunCompleted(runId);

    return result;
  } catch (error) {
    try {
      await markRunFailed(runId);
    } catch (transitionError) {
      throw new AggregateError(
        [error, transitionError],
        "Workflow resume failed and the run could not be marked failed",
      );
    }

    throw error;
  }
}