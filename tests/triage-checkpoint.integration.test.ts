import { describe, expect, it, vi } from "vitest";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createTriageGraph } from "../apps/api/src/ai/triage-graph.js";
import { env } from "../apps/api/src/config/env.js";

describe("triage checkpoint integration tests", () => {
  it("persists checkpoints in PostgreSQL, survives restart, and resumes without re-running draft generation", async () => {
    const threadId = `test-checkpoint-${Date.now()}-${Math.random()}`;
    const config = { configurable: { thread_id: threadId } };

    let draftCallCount = 0;
    const mockCreateTriageDraft = vi.fn().mockImplementation(async () => {
      draftCallCount++;
      return {
        summary: "Synthetic draft summary",
        suggestedUrgency: "routine",
        reasons: ["Synthetic reason"],
        humanReviewRequired: true,
      };
    });

    const mockCreateFhirMcpClient = vi.fn();

    // 1. Initial PostgresSaver connection & setup
    const saver1 = PostgresSaver.fromConnString(env.databaseUrl);
    await saver1.setup();

    const graph1 = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer: saver1,
    });

    // 2. Start workflow -> processes history and draft, then interrupts for human approval
    await graph1.invoke({ scenarioId: "demo-001" }, config);

    // 3. Verify checkpoint exists and graph is paused at approval
    const currentState = await graph1.getState(config);
    expect(currentState).toBeDefined();
    expect(currentState.next).toContain("approval");
    expect(currentState.values.triageDraft).not.toBeNull();
    expect(draftCallCount).toBe(1);

    // 4. Recreate graph using a new PostgresSaver instance (simulating a service restart)
    const saver2 = PostgresSaver.fromConnString(env.databaseUrl);
    await saver2.setup();

    const graph2 = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer: saver2,
    });

    // 5. Resume the original thread with an approval decision using Command
    await graph2.invoke(
      new Command({
        resume: { approved: true },
      }),
      config,
    );

    // 6. Verify workflow completed successfully and draft generator was NOT called again
    const finalState = await graph2.getState(config);
    expect(finalState.values.approvalStatus).toBe("approved");
    expect(finalState.next).toEqual([]);
    expect(draftCallCount).toBe(1);
  });
});