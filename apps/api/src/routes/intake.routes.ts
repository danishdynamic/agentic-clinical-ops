import type { FastifyInstance } from "fastify";
import { createAgentRun } from "../db/agent-runs.js";
import {
  markRunAwaitingApproval,
  markRunFailed,
} from "../db/agent-run-lifecycle.js";
import { triageGraph } from "../ai/triage-graph.js";
import { setRunState } from "../redis/run-state.js";
import { intakeSchema } from "./intake.schema.js";

export async function intakeRoutes(app: FastifyInstance) {
  app.post("/api/intake", async (request, reply) => {
    const parsed = intakeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid intake request",
        details: parsed.error.flatten(),
      });
    }

    const { patientId, scenarioId } = parsed.data;
    const run = await createAgentRun(patientId);

    const config = {
      configurable: { thread_id: run.id },
    };

    let result;
    let graphState;

    // Stage 1: Execute the graph and inspect its checkpoint.
    try {
      result = await triageGraph.invoke({ scenarioId }, config);
      graphState = await triageGraph.getState(config);
    } catch (error) {
      request.log.error(
        { err: error, runId: run.id },
        "Triage graph execution failed",
      );

      await markRunFailed(run.id);
      await setRunState(run.id, {
        status: "failed",
        currentStep: "failed",
      });

      throw error;
    }

    // Stage 2: This workflow must pause for human approval.
    if (!graphState.next.includes("approval")) {
      await markRunFailed(run.id);
      await setRunState(run.id, {
        status: "failed",
        currentStep: "unexpected_graph_completion",
      });

      request.log.error(
        { runId: run.id, next: graphState.next },
        "Workflow finished without the required approval pause",
      );

      return reply.status(500).send({
        error: "Workflow did not pause for human approval",
        runId: run.id,
      });
    }

    // Stage 3: Persist the approval-pending state.
    await markRunAwaitingApproval(run.id);

    await setRunState(run.id, {
      status: "awaiting_approval",
      currentStep: "approval",
    });

    return reply.status(201).send({
      runId: run.id,
      threadId: run.id,
      status: "awaiting_approval",
      currentStep: "approval",
      draft: graphState.values.triageDraft ?? null,
      result,
    });
  });
}