import { describe, expect, it } from "vitest";
import { createAgentRun } from "../apps/api/src/db/agent-runs.js";
import { recordApproval } from "../apps/api/src/db/approvals.js";
import { resumeTriageWorkflow } from "../apps/api/src/ai/resume-triage.js";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";

describe("resumeTriageWorkflow integration tests", () => {
  it(
    "resumes the paused workflow when a persisted approval exists",
    async () => {
      const agentRun = await createAgentRun("patient-resume-001");
      const threadId = `thread-approve-${Date.now()}`;
      const config = { configurable: { thread_id: threadId } };

      // 1. Run graph until it pauses at the approval interrupt
      await triageGraph.invoke({ scenarioId: "demo-001" }, config);

      // 2. Persist an approval record associated with this run
      await recordApproval({
        runId: agentRun.id,
        idempotencyKey: `key-approve-${Date.now()}`,
        decision: "approved",
        reviewerId: "dr-test",
      });

      // 3. Resume the workflow using the resume service
      const result = await resumeTriageWorkflow(agentRun.id, threadId);

      // 4. Verify successful completion with approved status
      expect(result.approvalStatus).toBe("approved");
    },
    20000,
  );

  it(
    "resumes the paused workflow with rejection when a persisted rejection exists",
    async () => {
      const agentRun = await createAgentRun("patient-resume-002");
      const threadId = `thread-reject-${Date.now()}`;
      const config = { configurable: { thread_id: threadId } };

      await triageGraph.invoke({ scenarioId: "demo-002" }, config);

      await recordApproval({
        runId: agentRun.id,
        idempotencyKey: `key-reject-${Date.now()}`,
        decision: "rejected",
        reviewerId: "dr-test",
      });

      const result = await resumeTriageWorkflow(agentRun.id, threadId);

      expect(result.approvalStatus).toBe("rejected");
    },
    20000,
  );

  it("throws an error when no approval record is found for the given run ID", async () => {
    const agentRun = await createAgentRun("patient-resume-003");
    const threadId = `thread-missing-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    await triageGraph.invoke({ scenarioId: "demo-001" }, config);

    // Attempting to resume without recording an approval first
    await expect(
      resumeTriageWorkflow(agentRun.id, threadId),
    ).rejects.toThrow(`No approval record found for run ID: ${agentRun.id}`);
  });

  it(
    "cannot resume a workflow using an approval for a different run",
    async () => {
      const runA = await createAgentRun("patient-resume-runA");
      const runB = await createAgentRun("patient-resume-runB");
      const threadId = `thread-diff-run-${Date.now()}`;
      const config = { configurable: { thread_id: threadId } };

      // Start workflow thread for run A
      await triageGraph.invoke({ scenarioId: "demo-001" }, config);

      // Record approval for run B instead of run A
      await recordApproval({
        runId: runB.id,
        idempotencyKey: `key-diff-run-${Date.now()}`,
        decision: "approved",
        reviewerId: "dr-test",
      });

      // Attempting to resume using runA's ID (which has no approval record) fails
      await expect(
        resumeTriageWorkflow(runA.id, threadId),
      ).rejects.toThrow(`No approval record found for run ID: ${runA.id}`);
    },
    20000,
  );

  it(
    "prevents resuming a workflow a second time once already handled",
    async () => {
      const agentRun = await createAgentRun("patient-resume-004");
      const threadId = `thread-replay-${Date.now()}`;
      const config = { configurable: { thread_id: threadId } };

      await triageGraph.invoke({ scenarioId: "demo-001" }, config);

      await recordApproval({
        runId: agentRun.id,
        idempotencyKey: `key-replay-${Date.now()}`,
        decision: "approved",
        reviewerId: "dr-test",
      });

      // First resume succeeds
      await resumeTriageWorkflow(agentRun.id, threadId);

      // Second resume attempt fails because the thread is no longer waiting at an interrupt
      await expect(
        resumeTriageWorkflow(agentRun.id, threadId),
      ).rejects.toThrow();
    },
    20000,
  );
});