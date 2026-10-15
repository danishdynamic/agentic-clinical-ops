import {
  Annotation,
  END,
  interrupt,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { TriageDraft } from "./triage.schema.js";
import { createTriageDraft } from "./triage.js";
import { checkpointer } from "./checkpointer.js";

const TriageState = Annotation.Root({
  scenarioId: Annotation<string>(),
  summary: Annotation<string>({
    default: () => "",
  }),
  humanReviewRequired: Annotation<boolean>({
    default: () => false,
  }),
  triageDraft: Annotation<TriageDraft | null>({
    default: () => null,
  }),
  historySummary: Annotation<string>({
    default: () => "",
  }),
  nextStep: Annotation<"history" | "draft" | "approval">({
    default: () => "history",
  }),
  approvalStatus: Annotation<
    "pending" | "approved" | "rejected"
  >({
    default: () => "pending",
  }),
});

function supervisorNode(state: typeof TriageState.State) {
  if (!state.historySummary) {
    return { nextStep: "history" as const };
  }

  if (!state.triageDraft) {
    return { nextStep: "draft" as const };
  }

  return { nextStep: "approval" as const };
}

function routeFromSupervisor(state: typeof TriageState.State) {
  return state.nextStep;
}

// Node 1: Create a draft using Gemini via createTriageDraft
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
  };

  const triageDraft = await createTriageDraft(scenario);

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
    approvalStatus: decision.approved ? "approved" : "rejected",
  };
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

export const triageGraph = new StateGraph(TriageState)
  .addNode("supervisor", supervisorNode)
  .addNode("draft", draftNode)
  .addNode("approval", approvalNode)
  .addNode("history", historyNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", routeFromSupervisor, {
    history: "history",
    draft: "draft",
    approval: "approval",
  })
  .addEdge("history", "supervisor")
  .addEdge("draft", "supervisor")
  .addEdge("approval", END)
  .compile({ checkpointer });