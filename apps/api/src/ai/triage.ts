
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import {
  triageDraftSchema,
  type TriageDraft,
} from "./triage.schema.js";

const ai = new GoogleGenAI({
  apiKey: env.geminiApiKey,
});

export async function createTriageDraft(
  syntheticScenario: string,
): Promise<TriageDraft> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
      You are producing a training-only intake draft.
      The scenario is fictional and must not be used for real care.

      Summarize the scenario and suggest one of these labels:
      routine, prompt, emergency.

      Give at least one reason.
      Set humanReviewRequired to true.
      Do not claim that this output is a diagnosis.

      Fictional scenario:
      ${syntheticScenario}
    `,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          suggestedUrgency: {
            type: "STRING",
            enum: ["routine", "prompt", "emergency"],
          },
          reasons: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
          humanReviewRequired: { type: "BOOLEAN" },
        },
        required: [
          "summary",
          "suggestedUrgency",
          "reasons",
          "humanReviewRequired",
        ],
        propertyOrdering: [
          "summary",
          "suggestedUrgency",
          "reasons",
          "humanReviewRequired",
        ],
      },
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed: unknown = JSON.parse(response.text);

  return triageDraftSchema.parse(parsed);
}