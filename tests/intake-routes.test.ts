
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";
import { intakeRoutes } from "../apps/api/src/routes/intake.routes.js";
import { getRunState } from "../apps/api/src/redis/run-state.js";
import type { ReviewerIdentity } from "../apps/api/src/auth/reviewer-auth.js";

const runStates = vi.hoisted(
  () => new Map<string, { status: string; currentStep: string }>(),
);

vi.mock("../apps/api/src/redis/run-state.js", () => ({
  setRunState: vi.fn(async (runId, state) => runStates.set(runId, state)),
  getRunState: vi.fn(async (runId) => runStates.get(runId) ?? null),
}));

vi.mock("../apps/api/src/ai/triage-graph.js", () => ({
  triageGraph: {
    invoke: vi.fn().mockRejectedValue(
      new Error("Synthetic Gemini failure"),
    ),
    getState: vi.fn(),
  },
}));

async function buildApp(
  authenticate: (authorization: string | undefined) =>
    Promise<ReviewerIdentity | null> = async () => ({
      reviewerId: "synthetic-intake-user",
      roles: ["reviewer"],
    }),
) {
  const app = Fastify();
  await app.register(intakeRoutes, { authenticate });
  await app.ready();
  return app;
}

describe("Intake Routes Failure Tests", () => {
  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
    runStates.clear();
    vi.mocked(triageGraph.invoke).mockClear();
  });

  it("requires authentication before validating or creating an intake run", async () => {
    const app = await buildApp(async () => null);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/intake",
        payload: {
          patientId: "synthetic-patient-unauthenticated",
          symptoms: ["synthetic symptom"],
          scenarioId: "demo-001",
        },
      });

      expect(response.statusCode).toBe(401);
      expect(await db.select().from(agentRuns)).toHaveLength(0);
      expect(triageGraph.invoke).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    [
      "missing patientId",
      { symptoms: ["synthetic symptom"], scenarioId: "demo-001" },
    ],
    [
      "empty patientId",
      { patientId: "", symptoms: ["synthetic symptom"], scenarioId: "demo-001" },
    ],
    [
      "invalid scenarioId",
      {
        patientId: "synthetic-patient-001",
        symptoms: ["synthetic symptom"],
        scenarioId: "unknown-scenario",
      },
    ],
  ])("rejects an intake request with %s", async (_description, payload) => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/intake",
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(triageGraph.invoke).not.toHaveBeenCalled();
      expect(await db.select().from(agentRuns)).toHaveLength(0);
    } finally {
      await app.close();
    }
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
          symptoms: ["synthetic symptom"],
          scenarioId: "demo-001",
        },
      });

      expect(response.statusCode).toBe(500);
      expect(triageGraph.invoke).toHaveBeenCalledOnce();

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
