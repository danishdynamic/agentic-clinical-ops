import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

import { approvalRoutes } from "../apps/api/src/routes/approval.routes.js";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";
import type { ReviewerIdentity } from "../apps/api/src/auth/reviewer-auth.js";

const graphState = vi.hoisted(() => ({
  next: ["approval"],
  approvalStatus: "pending",
  decision: "approved",
  failNextInvoke: false,
}));

vi.mock("../apps/api/src/ai/triage-graph.js", () => ({
  triageGraph: {
    getState: vi.fn(async () => ({
      next: [...graphState.next],
      values: { approvalStatus: graphState.approvalStatus },
    })),
    invoke: vi.fn(async () => {
      if (graphState.failNextInvoke) {
        graphState.failNextInvoke = false;
        throw new Error("Synthetic graph resume failure");
      }
      graphState.approvalStatus = graphState.decision;
      graphState.next = [];
      return { approvalStatus: graphState.approvalStatus };
    }),
  },
}));

const reviewerIdentity = {
  reviewerId: "authenticated-reviewer",
  roles: ["reviewer"],
};

async function buildApp(
  authenticate: (authorization: string | undefined) =>
    Promise<ReviewerIdentity | null> = async () => reviewerIdentity,
) {
  const app = Fastify();
  await app.register(approvalRoutes, { authenticate });
  await app.ready();
  return app;
}

async function setupPausedGraphRun(runId: string, patientId: string) {
  await db.insert(agentRuns).values({
    id: runId,
    status: "awaiting_approval",
    patientId,
  });
}

describe("Approval Routes Integration Tests", () => {
  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
    graphState.next = ["approval"];
    graphState.approvalStatus = "pending";
    graphState.decision = "approved";
    graphState.failNextInvoke = false;
    vi.mocked(triageGraph.invoke).mockClear();
    vi.mocked(triageGraph.getState).mockClear();
  });

  it("requires authentication before recording a decision", async () => {
    const app = await buildApp(async () => null);
    const runId = crypto.randomUUID();
    await setupPausedGraphRun(runId, "synthetic-patient-unauthenticated");

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "unauthenticated-key" },
      payload: { decision: "approved", reviewerId: "spoofed-reviewer" },
    });

    expect(response.statusCode).toBe(401);
    expect(await db.select().from(approvals)).toHaveLength(0);
    expect(triageGraph.invoke).not.toHaveBeenCalled();
    await app.close();
  });

  it("denies authenticated callers without the reviewer role", async () => {
    const app = await buildApp(async () => ({
      reviewerId: "synthetic-observer",
      roles: ["observer"],
    }));
    const runId = crypto.randomUUID();
    await setupPausedGraphRun(runId, "synthetic-patient-observer");

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "unauthorized-role-key" },
      payload: { decision: "rejected" },
    });

    expect(response.statusCode).toBe(403);
    expect(await db.select().from(approvals)).toHaveLength(0);
    expect(triageGraph.invoke).not.toHaveBeenCalled();
    await app.close();
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
      payload: { decision: "approved", reviewerId: "spoofed-reviewer" },
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
    expect(approvalRecords[0].reviewerId).toBe(reviewerIdentity.reviewerId);

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

  it("records rejection, completes the run, and writes a rejection audit event", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    graphState.decision = "rejected";
    await setupPausedGraphRun(runId, "synthetic-patient-rejected");

    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "rejection-safety-key" },
      payload: { decision: "rejected" },
    });

    expect(response.statusCode).toBe(200);
    expect(graphState.approvalStatus).toBe("rejected");

    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(run.status).toBe("completed");

    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);
    expect(approvalRecords[0].decision).toBe("rejected");

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["approval_rejected", "workflow_completed"]),
    );
    expect(triageGraph.invoke).toHaveBeenCalledOnce();
    await app.close();
  });

  it("recovers a persisted approval after graph resume failure without duplicating the decision", async () => {
    const app = await buildApp();
    const runId = crypto.randomUUID();
    graphState.failNextInvoke = true;
    await setupPausedGraphRun(runId, "synthetic-patient-retry");

    const request = {
      method: "POST" as const,
      url: `/api/runs/${runId}/approval`,
      headers: { "idempotency-key": "resume-retry-key" },
      payload: { decision: "approved" },
    };

    const firstResponse = await app.inject(request);
    expect(firstResponse.statusCode).toBe(500);

    const [failedRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(failedRun.status).toBe("failed");

    const retryResponse = await app.inject(request);
    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().replayed).toBe(true);
    expect(retryResponse.json().status).toBe("completed");

    const [completedRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(completedRun.status).toBe("completed");

    const approvalRecords = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));
    expect(approvalRecords).toHaveLength(1);

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.runId, runId));
    expect(events.filter((event) => event.eventType === "approval_granted"))
      .toHaveLength(1);
    expect(events.filter((event) => event.eventType === "workflow_completed"))
      .toHaveLength(1);
    expect(triageGraph.invoke).toHaveBeenCalledTimes(2);

    const completedReplay = await app.inject(request);
    expect(completedReplay.statusCode).toBe(200);
    expect(triageGraph.invoke).toHaveBeenCalledTimes(2);
    await app.close();
  });
});