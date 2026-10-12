import type { FastifyInstance } from "fastify";
import { createAgentRun } from "../db/agent-runs.js";
import { intakeSchema } from "./intake.schema.js";
import { setRunState } from "../redis/run-state.js";

export async function intakeRoutes(app: FastifyInstance) {
  app.post("/api/intake", async (request, reply) => {
    const result = intakeSchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        error: "Invalid intake request",
        details: result.error.flatten(),
      });
    }

    const run = await createAgentRun(result.data.patientId);

    await setRunState(run.id, {
      status: run.status,
      currentStep: "intake_received",
    });

    return reply.status(201).send({
      runId: run.id,
      status: run.status,
    });
  });
}