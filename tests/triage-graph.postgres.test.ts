import { describe, expect, it, vi } from "vitest";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createTriageGraph } from "../apps/api/src/ai/triage-graph.js";
import { env } from "../apps/api/src/config/env.js";

describe("triageGraph Postgres durable persistence tests", () => {
  it("persists state to PostgreSQL, survives client restart, and resumes without re-running draft node", async () => {
    const threadId = `test-thread-pg-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    // 1. First checkpointer instance (Simulates Phase 1: Initial run & pause)
    const saver1 = PostgresSaver.fromConnString(env.databaseUrl);
    await saver1.setup();

    const mockCreateTriageDraft = vi.fn().mockResolvedValue({
      summary: "Persistent patient summary via PostgreSQL",
      suggestedUrgency: "routine",
      reasons: ["Stable vitals", "No acute symptoms"],
      humanReviewRequired: true,
    });

    const mockCreateFhirMcpClient = vi.fn();

    const graph1 = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer: saver1,
    });

    // Run graph initially -> should process history & draft, then pause at approval
    await graph1.invoke({ scenarioId: "demo-001" }, config);

    const state1 = await graph1.getState(config);
    expect(state1.next).toContain("approval");
    expect(state1.values.triageDraft).not.toBeNull();
    // Verify draft was generated once during the initial run
    expect(mockCreateTriageDraft).toHaveBeenCalledTimes(1);

    // 2. Second checkpointer instance (Simulates Phase 2: Process restart / reboot)
    const saver2 = PostgresSaver.fromConnString(env.databaseUrl);
    await saver2.setup();

    const graph2 = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer: saver2,
    });

    // Resume the exact same thread from the new checkpointer connection
    await graph2.invoke(
      new Command({
        resume: { approved: true },
      }),
      config,
    );

    const finalState = await graph2.getState(config);
    expect(finalState.values.approvalStatus).toBe("approved");
    expect(finalState.next).toEqual([]); // Workflow completed successfully

    // 3. Confirm the draft generator was NOT called again (proving state and draft payload were fully retrieved from PostgreSQL)
    expect(mockCreateTriageDraft).toHaveBeenCalledTimes(1);
  });
});