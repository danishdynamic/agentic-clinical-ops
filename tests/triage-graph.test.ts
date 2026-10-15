import { describe, expect, it } from "vitest";
import { Command } from "@langchain/langgraph";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";

describe("triageGraph with Approval Interrupt", () => {
  it(
    "creates a draft, pauses at the approval interrupt, and resumes successfully when approved",
    async () => {
      const config = {
        configurable: {
          thread_id: `test-approval-${Date.now()}`,
        },
      };

      // 1. Invoke the graph; it runs history -> draft -> supervisor -> approval, then pauses.
      const initialResult = await triageGraph.invoke(
        { scenarioId: "demo-001" },
        config,
      );

      // Verify the draft was created and summary is populated before the interrupt
      expect(initialResult.summary).toBeTypeOf("string");
      expect(initialResult.summary.toLowerCase()).toContain("mild headache");
      expect(initialResult.triageDraft).not.toBeNull();
      expect(initialResult.historySummary).toBeTruthy();

      // Verify via getState that the next step waiting is "approval" and status is pending defaults
      const currentState = await triageGraph.getState(config);
      expect(currentState.next).toContain("approval");
      expect(currentState.values.approvalStatus).toBe("pending");

      // 2. Resume the workflow by providing the approval decision via Command
      const resumedResult = await triageGraph.invoke(
        new Command({
          resume: { approved: true },
        }),
        config,
      );

      // 3. Verify final state after approval
      expect(resumedResult.approvalStatus).toBe("approved");

      const finalState = await triageGraph.getState(config);
      expect(finalState.values.approvalStatus).toBe("approved");
    },
    15000, // 15 seconds timeout for API calls & graph steps
  );

  it(
    "handles the rejection path properly",
    async () => {
      const config = {
        configurable: {
          thread_id: `test-rejection-${Date.now()}`,
        },
      };

      // Run until the interrupt
      await triageGraph.invoke({ scenarioId: "demo-002" }, config);

      // Resume with a rejection decision
      const resumedResult = await triageGraph.invoke(
        new Command({
          resume: { approved: false },
        }),
        config,
      );

      // Verify rejection status
      expect(resumedResult.approvalStatus).toBe("rejected");
    },
    15000,
  );

  it("rejects an unknown scenario", async () => {
    const config = {
      configurable: {
        thread_id: `test-unknown-${Date.now()}`,
      },
    };

    await expect(
      triageGraph.invoke(
        { scenarioId: "unknown" },
        config,
      ),
    ).rejects.toThrow("Unknown synthetic scenario");
  });
});