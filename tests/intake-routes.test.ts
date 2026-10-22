
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import { intakeRoutes } from "../apps/api/src/routes/intake.routes.js";
import { getRunState } from "../apps/api/src/redis/run-state.js";

vi.mock("../apps/api/src/ai/triage-graph.js", () => ({
  triageGraph: {
    invoke: vi.fn().mockRejectedValue(
      new Error("Synthetic Gemini failure"),
    ),
    getState: vi.fn(),
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(intakeRoutes);
  await app.ready();
  return app;
}

describe("Intake Routes Failure Tests", () => {
  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(agentRuns);
  });

  it("marks the run failed when triage graph execution fails", async () => {
    const app = await buildApp();
    const patientId = crypto.randomUUID();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/intake",
        payload: {
          patientId,
          scenarioId: "demo-001",
        },
      });

      expect(response.statusCode).toBe(400);

      const runs = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.patientId, patientId));

      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("failed");

      const redisState = await getRunState(runs[0].id);
      expect(redisState).toEqual({
        status: "failed",
        currentStep: "failed",
      });

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.runId, runs[0].id));

      expect(events.some((event) => event.eventType === "workflow_failed"))
        .toBe(true);
    } finally {
      await app.close();
    }
  });
});
