import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

import { approvalRoutes } from "../apps/api/src/routes/approval.routes.js";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";

async function buildApp() {
  const app = Fastify();
  await app.register(approvalRoutes);
  await app.ready();
  return app;
}

// Helper to run graph until it pauses at the approval node
async function setupPausedGraphRun(runId: string, patientId: string) {
  await db.insert(agentRuns).values({
    id: runId,
    status: "awaiting_approval",
    scenarioId: "demo-001",
    patientId,
  });

  const config = { configurable: { thread_id: runId } };
  
  // Invoke graph so it processes up to the approval interrupt point
  await triageGraph.invoke(
    {
      patientId,
      scenarioId: "demo-001",
    },
    config
  );
}

describe("Approval Routes Integration Tests", () => {
  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
  });

  it("rejects invalid request body or malformed runId with 400 Bad Request", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/not-a-valid-uuid/approval",
      headers: { "idempotency-key": "test-key-1" },
      payload: { decision: "invalid-decision", reviewerId: "" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe("Invalid approval request");

    await app.close();
  });

  it("rejects request missing the Idempotency-Key header with 400 Bad Request", async () => {
    const app = await buildApp();
    const validUuid = crypto.randomUUID();

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${validUuid}/approval`,
      payload: { decision: "approved", reviewerId: "reviewer-123" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe("A valid Idempotency-Key header is required");

    await app.close();
  });

  it("records a valid approval, resumes the workflow, and completes the run", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    const patientId = crypto.randomUUID();

    await setupPausedGraphRun(runId, patientId);

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "approval-test-001" },
      payload: { decision: "approved", reviewerId: "reviewer-test-001" },
    });

    expect(response.statusCode).toBe(200);
    const jsonBody = response.json();
    expect(jsonBody.runId).toBe(runId);
    expect(jsonBody.decision).toBe("approved");
    expect(jsonBody.replayed).toBe(false);
    expect(jsonBody.status).toBe("completed");

    const [runRecord] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(runRecord.status).toBe("completed");

    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);
    expect(approvalRecords[0].decision).toBe("approved");

    await app.close();
  });

  it("supports exact replay of the same approval request without re-resuming", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    const patientId = crypto.randomUUID();

    await setupPausedGraphRun(runId, patientId);

    const res1 = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "replay-key-1" },
      payload: { decision: "approved", reviewerId: "reviewer-1" },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "replay-key-1" },
      payload: { decision: "approved", reviewerId: "reviewer-1" },
    });

    expect(res2.statusCode).toBe(200);
    const jsonBody = res2.json();
    expect(jsonBody.replayed).toBe(true);
    expect(jsonBody.status).toBe("decision_recorded");

    await app.close();
  });

  it("rejects conflicting decisions with 409 Conflict", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    const patientId = crypto.randomUUID();

    await setupPausedGraphRun(runId, patientId);

    const res1 = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "key-approve" },
      payload: { decision: "approved", reviewerId: "reviewer-1" },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "key-reject" },
      payload: { decision: "rejected", reviewerId: "reviewer-2" },
    });

    expect(res2.statusCode).toBe(409);
    const jsonBody = res2.json();
    expect(jsonBody.error).toBe("An approval decision has already been recorded for this run");

    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);
    expect(approvalRecords[0].decision).toBe("approved");

    await app.close();
  });

  it("prevents concurrent submissions from claiming the same run twice", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    const patientId = crypto.randomUUID();

    await setupPausedGraphRun(runId, patientId);

    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/runs/${runId}/approval`,
        headers: { "idempotency-key": "concurrent-key-1" },
        payload: { decision: "approved", reviewerId: "reviewer-1" },
      }),
      app.inject({
        method: "POST",
        url: `/api/runs/${runId}/approval`,
        headers: { "idempotency-key": "concurrent-key-2" },
        payload: { decision: "approved", reviewerId: "reviewer-2" },
      }),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    expect(statusCodes).toEqual([200, 409]);

    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);

    await app.close();
  });
});