import { describe, expect, it, vi } from "vitest";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createTriageGraph } from "../apps/api/src/ai/triage-graph.js";

function createSyntheticGraph() {
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

describe("triageGraph with Approval Interrupt", () => {
  it(
    "creates a draft, pauses at the approval interrupt, and resumes successfully when approved",
    async () => {
      const graph = createSyntheticGraph();
      const config = {
        configurable: {
          thread_id: `test-approval-${Date.now()}`,
        },
      };

      // 1. Invoke the graph; it runs history -> draft -> supervisor -> approval, then pauses.
      const initialResult = await graph.invoke(
        { scenarioId: "demo-001" },
        config,
      );

      // Verify the draft was created and summary is populated before the interrupt
      expect(initialResult.summary).toBeTypeOf("string");
      expect(initialResult.summary).toBe("Synthetic triage summary");
      expect(initialResult.triageDraft).not.toBeNull();
      expect(initialResult.historySummary).toBeTruthy();

      // Verify via getState that the next step waiting is "approval" and status is pending defaults
      const currentState = await graph.getState(config);
      expect(currentState.next).toContain("approval");
      expect(currentState.values.approvalStatus).toBe("pending");

      // 2. Resume the workflow by providing the approval decision via Command
      const resumedResult = await graph.invoke(
        new Command({
          resume: { approved: true },
        }),
        config,
      );

      // 3. Verify final state after approval
      expect(resumedResult.approvalStatus).toBe("approved");

      const finalState = await graph.getState(config);
      expect(finalState.values.approvalStatus).toBe("approved");
    },
    15000, // 15 seconds timeout for API calls & graph steps
  );

  it(
    "handles the rejection path properly",
    async () => {
      const graph = createSyntheticGraph();
      const config = {
        configurable: {
          thread_id: `test-rejection-${Date.now()}`,
        },
      };

      // Run until the interrupt
      await graph.invoke({ scenarioId: "demo-002" }, config);

      // Resume with a rejection decision
      const resumedResult = await graph.invoke(
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
    const graph = createSyntheticGraph();
    const config = {
      configurable: {
        thread_id: `test-unknown-${Date.now()}`,
      },
    };

    await expect(
      graph.invoke(
        { scenarioId: "unknown" },
        config,
      ),
    ).rejects.toThrow("Unknown synthetic scenario");
  });

  it("propagates a draft-generation failure", async () => {
    const graph = createTriageGraph({
      createTriageDraft: async () => {
        throw new Error("Synthetic Gemini failure");
      },
      createFhirMcpClient: async () => ({
        callTool: async () => {
          throw new Error("Unexpected MCP call");
        },
        close: async () => {},
      }),
      checkpointer: new MemorySaver(),
    });

    await expect(
      graph.invoke(
        { scenarioId: "demo-001" },
        {
          configurable: {
            thread_id: "test-gemini-failure-001",
          },
        },
      ),
    ).rejects.toThrow("Synthetic Gemini failure");
  });

  it("closes the MCP client after successfully loading FHIR context", async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === "get_patient") {
        return { resourceType: "Patient", id: "synthetic-patient-001" };
      }
      return [];
    });
    const close = vi.fn(async () => {});
    const graph = createTriageGraph({
      createTriageDraft: async () => ({
        summary: "Synthetic triage summary",
        suggestedUrgency: "routine",
        reasons: ["Synthetic reason"],
        humanReviewRequired: true,
      }),
      createFhirMcpClient: async () => ({ callTool, close }),
      checkpointer: new MemorySaver(),
    });

    await graph.invoke(
      {
        scenarioId: "demo-001",
        fhirPatientId: "synthetic-patient-001",
      },
      { configurable: { thread_id: "mcp-close-success" } },
    );

    expect(callTool).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the MCP client when a tool call fails", async () => {
    const callTool = vi.fn(async () => {
      throw new Error("Synthetic MCP tool failure");
    });
    const close = vi.fn(async () => {});
    const graph = createTriageGraph({
      createTriageDraft: async () => ({
        summary: "Synthetic triage summary",
        suggestedUrgency: "routine",
        reasons: ["Synthetic reason"],
        humanReviewRequired: true,
      }),
      createFhirMcpClient: async () => ({ callTool, close }),
      checkpointer: new MemorySaver(),
    });

    await expect(
      graph.invoke(
        {
          scenarioId: "demo-001",
          fhirPatientId: "synthetic-patient-002",
        },
        { configurable: { thread_id: "mcp-close-tool-error" } },
      ),
    ).rejects.toThrow("Synthetic MCP tool failure");

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not call clinical tools after a human rejects the proposal", async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === "get_patient") {
        return { resourceType: "Patient", id: "synthetic-patient-rejected" };
      }
      return [];
    });
    const close = vi.fn(async () => {});
    const graph = createTriageGraph({
      createTriageDraft: async () => ({
        summary: "Synthetic triage summary",
        suggestedUrgency: "routine",
        reasons: ["Synthetic reason"],
        humanReviewRequired: true,
      }),
      createFhirMcpClient: async () => ({ callTool, close }),
      checkpointer: new MemorySaver(),
    });
    const config = {
      configurable: { thread_id: "rejected-no-write-test" },
    };

    await graph.invoke(
      {
        scenarioId: "demo-001",
        fhirPatientId: "synthetic-patient-rejected",
      },
      config,
    );
    const callsAtApproval = callTool.mock.calls.length;
    expect(callsAtApproval).toBe(3);

    const result = await graph.invoke(
      new Command({ resume: { approved: false } }),
      config,
    );

    expect(result.approvalStatus).toBe("rejected");
    expect(callTool).toHaveBeenCalledTimes(callsAtApproval);
    expect(callTool.mock.calls.map(([name]) => name)).toEqual([
      "get_patient",
      "get_observations",
      "get_allergies",
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});