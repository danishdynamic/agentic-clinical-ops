import {
  Annotation,
  END,
  interrupt,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { TriageDraft } from "./triage.schema.js";
import { createTriageDraft } from "./triage.js";
import { checkpointer } from "./checkpointer.js";
import { createFhirMcpClient } from "../mcp/fhir-client.js";
import { normalizeFhirContext } from "./fhir-context.js";

type FhirToolName =
  | "get_patient"
  | "get_observations"
  | "get_allergies";

type FhirMcpClient = {
  callTool(
    name: FhirToolName,
    patientId: string,
  ): Promise<unknown>;
  close(): Promise<void>;
};

type TriageGraphDependencies = {
  createTriageDraft: typeof createTriageDraft;
  createFhirMcpClient: () => Promise<FhirMcpClient>;
  checkpointer: BaseCheckpointSaver;
};

export function createTriageGraph(
  dependencies: TriageGraphDependencies = {
    createTriageDraft,
    createFhirMcpClient,
    checkpointer,
  },
) {
  const TriageState = Annotation.Root({
    scenarioId: Annotation<string>(),
    summary: Annotation<string>({
      value: (_current, update) => update,
      default: () => "",
    }),
    humanReviewRequired: Annotation<boolean>({
      value: (_current, update) => update,
      default: () => {
        return false;
      },
    }),
    triageDraft: Annotation<TriageDraft | null>({
      value: (_current, update) => update,
      default: () => null,
    }),
    historySummary: Annotation<string>({
      value: (_current, update) => update,
      default: () => "",
    }),
    fhirPatientId: Annotation<string | undefined>({
      value: (_current, update) => update,
      default: () => undefined,
    }),
    fhirContext: Annotation<string>({
      value: (_current, update) => update,
      default: () => "",
    }),
    fhirContextLoaded: Annotation<boolean>({
      value: (_current, update) => update,
      default: () => false,
    }),
    nextStep: Annotation<
      | "history"
      | "fhir_context"
      | "draft"
      | "approval"
      | "approved"
      | "rejected"
    >({
      value: (_current, update) => update,
      default: () => "history",
    }),
    approvalStatus: Annotation<
      "pending" | "approved" | "rejected"
    >({
      value: (_current, update) => update,
      default: () => "pending",
    }),
  });

  function supervisorNode(state: typeof TriageState.State) {
    if (!state.historySummary) {
      return { nextStep: "history" as const };
    }

    if (state.fhirPatientId && !state.fhirContextLoaded) {
      return { nextStep: "fhir_context" as const };
    }

    if (!state.triageDraft) {
      return { nextStep: "draft" as const };
    }

    return { nextStep: "approval" as const };
  }

  function routeFromSupervisor(state: typeof TriageState.State) {
    return state.nextStep;
  }

  // Node 1: Create a draft using Gemini via dependencies.createTriageDraft
  async function draftNode(state: typeof TriageState.State) {
    const scenarios: Record<string, string> = {
      "demo-001":
        "Fictional training scenario: an adult reports a mild headache after a long day.",
      "demo-002":
        "Fictional training scenario: an adult reports a sore throat and runny nose.",
    };

    const scenarioText = scenarios[state.scenarioId];

    if (!scenarioText) {
      throw new Error("Unknown synthetic scenario");
    }

    const scenario = {
      scenario: scenarioText,
      historySummary: state.historySummary,
      fhirContext: state.fhirContext,
    };

    const triageDraft =
      await dependencies.createTriageDraft(scenario);

    return {
      summary: triageDraft.summary,
      triageDraft,
    };
  }

  // Node 2: Human approval interrupt node
  function approvalNode() {
    const decision = interrupt({
      type: "human_approval_required",
      message: "Review the triage draft before proceeding.",
    });

    if (
      typeof decision !== "object" ||
      decision === null ||
      !("approved" in decision) ||
      typeof decision.approved !== "boolean"
    ) {
      throw new Error("Invalid human approval decision");
    }

    return {
      approvalStatus: decision.approved
        ? ("approved" as const)
        : ("rejected" as const),
    };
  }

  // Node 3: Post-approval decision routing node
  function afterApprovalNode(state: typeof TriageState.State) {
    if (state.approvalStatus === "approved") {
      return { nextStep: "approved" as const };
    }

    if (state.approvalStatus === "rejected") {
      return { nextStep: "rejected" as const };
    }

    throw new Error("A recorded approval decision is required");
  }

  function routeAfterApproval(state: typeof TriageState.State) {
    return state.nextStep;
  }

  function historyNode(state: typeof TriageState.State) {
    const summaries: Record<string, string> = {
      "demo-001": "Synthetic history: mild headache for 2 hours.",
      "demo-002": "Synthetic history: sore throat and runny nose for 1 day.",
    };

    const historySummary = summaries[state.scenarioId];

    if (!historySummary) {
      throw new Error("Unknown synthetic scenario");
    }

    return { historySummary };
  }

  // Node 4: FHIR Context loading and normalization node via dependencies.createFhirMcpClient
  async function fhirContextNode(state: typeof TriageState.State) {
    if (!state.fhirPatientId) {
      throw new Error("FHIR patient ID is required for FHIR context");
    }

    const client = await dependencies.createFhirMcpClient();

    try {
      const [patient, observations, allergies] = await Promise.all([
        client.callTool("get_patient", state.fhirPatientId),
        client.callTool("get_observations", state.fhirPatientId),
        client.callTool("get_allergies", state.fhirPatientId),
      ]);

      const fhirContext = normalizeFhirContext(
        patient,
        observations,
        allergies,
      );

      return {
        fhirContext,
        fhirContextLoaded: true,
      };
    } finally {
      await client.close();
    }
  }

  return new StateGraph(TriageState)
    .addNode("supervisor", supervisorNode)
    .addNode("draft", draftNode)
    .addNode("approval", approvalNode)
    .addNode("after_approval", afterApprovalNode)
    .addNode("history", historyNode)
    .addNode("fhir_context", fhirContextNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeFromSupervisor, {
      history: "history",
      fhir_context: "fhir_context",
      draft: "draft",
      approval: "approval",
    })
    .addEdge("history", "supervisor")
    .addEdge("fhir_context", "supervisor")
    .addEdge("draft", "supervisor")
    .addEdge("approval", "after_approval")
    .addConditionalEdges("after_approval", routeAfterApproval, {
      approved: END,
      rejected: END,
    })
    .compile({ checkpointer: dependencies.checkpointer });
}

export const triageGraph = createTriageGraph();