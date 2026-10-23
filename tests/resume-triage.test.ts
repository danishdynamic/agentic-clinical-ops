import { beforeEach, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";

import { createTriageGraph } from "../apps/api/src/ai/triage-graph.js";
import { resumeTriageWorkflow } from "../apps/api/src/ai/resume-triage.js";
import { createAgentRun } from "../apps/api/src/db/agent-runs.js";
import { markRunAwaitingApproval } from "../apps/api/src/db/agent-run-lifecycle.js";
import { recordApproval } from "../apps/api/src/db/approvals.js";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";
import { approvals } from "../apps/api/src/db/schema/approvals.js";
import { auditEvents } from "../apps/api/src/db/schema/audit-events.js";

function createTestGraph() {
  return createTriageGraph({
    createTriageDraft: async () => ({
      summary: "Synthetic triage summary",
      suggestedUrgency: "routine",
      reasons: ["Synthetic reason"],
      humanReviewRequired: true,
    }),
    createFhirMcpClient: async () => ({
      callTool: async () => {
        throw new Error("Unexpected FHIR tool call");
      },
      close: async () => {},
    }),
    checkpointer: new MemorySaver(),
  });
}

async function setupPausedRun(scenarioId: string, patientId: string) {
  const run = await createAgentRun(patientId);
  const graph = createTestGraph();
  await graph.invoke(
    { scenarioId },
    { configurable: { thread_id: run.id } },
  );
  await markRunAwaitingApproval(run.id);
  return { run, graph };
}

describe("resumeTriageWorkflow integration tests", () => {
  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(approvals);
    await db.delete(agentRuns);
  });

  it("resumes the paused workflow when a persisted approval exists", async () => {
    const { run, graph } = await setupPausedRun(
      "demo-001",
      "synthetic-patient-resume-001",
    );

    await recordApproval({
      runId: run.id,
      idempotencyKey: `key-approve-${run.id}`,
      decision: "approved",
      reviewerId: "synthetic-reviewer",
    });

    const result = await resumeTriageWorkflow(run.id, graph);

    expect(result.approvalStatus).toBe("approved");
  });

  it("resumes the paused workflow with rejection when a persisted rejection exists", async () => {
    const { run, graph } = await setupPausedRun(
      "demo-002",
      "synthetic-patient-resume-002",
    );

    await recordApproval({
      runId: run.id,
      idempotencyKey: `key-reject-${run.id}`,
      decision: "rejected",
      reviewerId: "synthetic-reviewer",
    });

    const result = await resumeTriageWorkflow(run.id, graph);

    expect(result.approvalStatus).toBe("rejected");
  });

  it("throws when no approval record exists for the run", async () => {
    const { run, graph } = await setupPausedRun(
      "demo-001",
      "synthetic-patient-resume-003",
    );

    await expect(resumeTriageWorkflow(run.id, graph)).rejects.toThrow(
      `No approval record found for run ID: ${run.id}`,
    );
  });

  it("does not resume a run using an approval recorded for another run", async () => {
    const { run: runA, graph } = await setupPausedRun(
      "demo-001",
      "synthetic-patient-run-a",
    );
    const runB = await createAgentRun("synthetic-patient-run-b");
    await markRunAwaitingApproval(runB.id);

    await recordApproval({
      runId: runB.id,
      idempotencyKey: `key-different-run-${runB.id}`,
      decision: "approved",
      reviewerId: "synthetic-reviewer",
    });

    await expect(resumeTriageWorkflow(runA.id, graph)).rejects.toThrow(
      `No approval record found for run ID: ${runA.id}`,
    );
  });

  it("prevents a workflow from being resumed a second time", async () => {
    const { run, graph } = await setupPausedRun(
      "demo-001",
      "synthetic-patient-resume-004",
    );

    await recordApproval({
      runId: run.id,
      idempotencyKey: `key-replay-${run.id}`,
      decision: "approved",
      reviewerId: "synthetic-reviewer",
    });

    await resumeTriageWorkflow(run.id, graph);
    await expect(resumeTriageWorkflow(run.id, graph)).rejects.toThrow();
  });
});
