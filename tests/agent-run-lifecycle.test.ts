import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";
import {
  markRunAwaitingApproval,
  markRunCompleted,
  markRunFailed,
} from "../apps/api/src/db/agent-run-lifecycle.js";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

describe("Agent Run Lifecycle Repository Integration Tests", () => {
  beforeEach(async () => {
    // Clean up referencing child tables first using the actual schema tables
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
  });

  it("allows a running run to move to awaiting_approval", async () => {
    const runId = crypto.randomUUID();
    await db.insert(agentRuns).values({
      id: runId,
      status: "running",
      scenarioId: "demo-001",
      patientId: "synthetic-patient-001",
    });

    const updated = await markRunAwaitingApproval(runId);
    expect(updated.id).toBe(runId);

    const [record] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(record.status).toBe("awaiting_approval");
  });

  it("prevents a run from entering awaiting_approval twice", async () => {
    const runId = crypto.randomUUID();
    await db.insert(agentRuns).values({
      id: runId,
      status: "running",
      scenarioId: "demo-001",
      patientId: "synthetic-patient-001",
    });

    await markRunAwaitingApproval(runId);

    // Second attempt should fail because status is no longer 'running'
    await expect(markRunAwaitingApproval(runId)).rejects.toThrow(
      /Run does not exist or is not in running state/i,
    );
  });

  it("allows a resuming run to move to completed and populates completedAt", async () => {
    const runId = crypto.randomUUID();
    await db.insert(agentRuns).values({
      id: runId,
      status: "resuming",
      scenarioId: "demo-001",
      patientId: "synthetic-patient-001",
    });

    const updated = await markRunCompleted(runId);
    expect(updated.id).toBe(runId);

    const [record] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(record.status).toBe("completed");
    expect(record.completedAt).toBeInstanceOf(Date);
  });

  it("prevents a run in the wrong state from being marked completed", async () => {
    const runId = crypto.randomUUID();
    await db.insert(agentRuns).values({
      id: runId,
      status: "running", // incorrect state; requires resuming
      scenarioId: "demo-001",
      patientId: "synthetic-patient-001",
    });

    await expect(markRunCompleted(runId)).rejects.toThrow(
      /Run does not exist or is not in resuming state/i,
    );
  });

  it("prevents a failure update from overwriting or failing a completed run", async () => {
    const runId = crypto.randomUUID();
    await db.insert(agentRuns).values({
      id: runId,
      status: "completed",
      scenarioId: "demo-001",
      patientId: "synthetic-patient-001",
      completedAt: new Date(),
    });

    // markRunFailed requires status "running"
    await expect(markRunFailed(runId)).rejects.toThrow(
      /Run does not exist or is not in running state/i,
    );

    // Confirm status remains completed
    const [record] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    expect(record.status).toBe("completed");
  });
});