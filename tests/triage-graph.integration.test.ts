import { describe, expect, it, vi } from "vitest";
import { MemorySaver, Command } from "@langchain/langgraph";
import { createTriageGraph } from "../apps/api/src/ai/triage-graph.js";

describe("triageGraph integration tests", () => {
  it("walks through history, drafts triage, interrupts for human approval, and resumes successfully", async () => {
    // 1. Set up an in-memory checkpointer for testing state persistence & interrupts
    const checkpointer = new MemorySaver();

    // 2. Mock createTriageDraft
    const mockCreateTriageDraft = vi.fn().mockResolvedValue({
      summary: "Patient presents with a mild headache.",
      suggestedUrgency: "routine",
      reasons: ["Mild symptoms", "No red flags"],
      humanReviewRequired: true,
    });

    // 3. Mock FHIR MCP Client (not invoked when fhirPatientId is omitted)
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockCallTool = vi.fn();
    const mockCreateFhirMcpClient = vi.fn().mockResolvedValue({
      callTool: mockCallTool,
      close: mockClose,
    });

    // 4. Instantiate graph with fake dependencies
    const graph = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer,
    });

    const config = { configurable: { thread_id: "test-thread-001" } };

    // 5. Run graph initially. It should process history -> draft -> interrupt at approval.
    await graph.invoke(
      { scenarioId: "demo-001" },
      config,
    );

    // Verify it paused at approval node (interrupt)
    const currentState = await graph.getState(config);
    expect(currentState.next).toContain("approval");
    expect(currentState.values.triageDraft).not.toBeNull();

    // 6. Resume graph with an approval decision using Command
    await graph.invoke(
      new Command({
        resume: { approved: true },
      }),
      config,
    );

    const finalState = await graph.getState(config);
    expect(finalState.values.approvalStatus).toBe("approved");
    expect(finalState.next).toEqual([]); // Workflow finished (reached END)
  });

  it("resumes successfully with a rejection decision", async () => {
    const checkpointer = new MemorySaver();

    const mockCreateTriageDraft = vi.fn().mockResolvedValue({
      summary: "Patient presents with symptoms requiring review.",
      suggestedUrgency: "routine",
      reasons: ["Review required"],
      humanReviewRequired: true,
    });

    const graph = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: vi.fn(),
      checkpointer,
    });

    const config = { configurable: { thread_id: "test-thread-rejection-001" } };

    // Run graph initially to reach the approval interrupt
    await graph.invoke({ scenarioId: "demo-001" }, config);

    // Resume graph with a rejection decision
    await graph.invoke(
      new Command({
        resume: { approved: false },
      }),
      config,
    );

    const finalState = await graph.getState(config);
    expect(finalState.values.approvalStatus).toBe("rejected");
    expect(finalState.next).toEqual([]); // Workflow finished (reached END)
  });

  it("loads FHIR context when fhirPatientId is provided and ensures client is closed", async () => {
    const checkpointer = new MemorySaver();

    const mockCreateTriageDraft = vi.fn().mockResolvedValue({
      summary: "Patient reviewed with FHIR data.",
      suggestedUrgency: "routine",
      reasons: ["Stable vitals"],
      humanReviewRequired: true,
    });

    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockCallTool = vi.fn().mockImplementation(async (toolName: string) => {
      if (toolName === "get_patient") return { resourceType: "Patient", id: "demo-001" };
      if (toolName === "get_observations") return [];
      if (toolName === "get_allergies") return [];
      return {};
    });

    const mockCreateFhirMcpClient = vi.fn().mockResolvedValue({
      callTool: mockCallTool,
      close: mockClose,
    });

    const graph = createTriageGraph({
      createTriageDraft: mockCreateTriageDraft,
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer,
    });

    const config = { configurable: { thread_id: "test-thread-fhir-001" } };

    await graph.invoke(
      { scenarioId: "demo-001", fhirPatientId: "demo-001" },
      config,
    );

    // Verify FHIR tools were called
    expect(mockCallTool).toHaveBeenCalledTimes(3);
    expect(mockCallTool).toHaveBeenCalledWith("get_patient", "demo-001");
    
    // Verify client was successfully closed in `finally` block
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("ensures FHIR client is closed even if a tool call fails", async () => {
    const checkpointer = new MemorySaver();

    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockCallTool = vi.fn().mockRejectedValue(new Error("FHIR server timeout"));

    const mockCreateFhirMcpClient = vi.fn().mockResolvedValue({
      callTool: mockCallTool,
      close: mockClose,
    });

    const graph = createTriageGraph({
      createTriageDraft: vi.fn(),
      createFhirMcpClient: mockCreateFhirMcpClient,
      checkpointer,
    });

    const config = { configurable: { thread_id: "test-thread-fhir-error" } };

    // Expect graph invocation to throw due to tool failure
    await expect(
      graph.invoke({ scenarioId: "demo-001", fhirPatientId: "demo-001" }, config),
    ).rejects.toThrow("FHIR server timeout");

    // Verify client cleanup still occurred in `finally` block despite failure
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});