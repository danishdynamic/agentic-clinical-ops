import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { TriageDraft } from "./triage.schema.js";
import { createTriageDraft } from "./triage.js";

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
  nextStep: Annotation<"history" | "draft" | "mark_review">({
    default: () => "history",
  }),
});

function supervisorNode(state: typeof TriageState.State) {
  if (!state.historySummary) {
    return { nextStep: "history" as const };
  }

  if (!state.triageDraft) {
    return { nextStep: "draft" as const };
  }

  return { nextStep: "mark_review" as const };
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

// Node 2: Mark the draft for human review.
function reviewNode() {
  return { humanReviewRequired: true };
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
  .addNode("mark_review", reviewNode)
  .addNode("history", historyNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", routeFromSupervisor, {
    history: "history",
    draft: "draft",
    mark_review: "mark_review",
  })
  .addEdge("history", "supervisor")
  .addEdge("draft", "supervisor")
  .addEdge("mark_review", END)
  .compile();