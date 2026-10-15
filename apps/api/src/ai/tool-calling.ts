
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { getSyntheticContext } from "./tools/synthetic-context.js";

const ai = new GoogleGenAI({
  apiKey: env.geminiApiKey,
});

const getSyntheticContextDeclaration = {
  name: "get_synthetic_context",
  description:
    "Retrieve a predefined fictional training scenario by its scenario ID.",
  parametersJsonSchema: {
    type: "OBJECT",
    properties: {
      scenarioId: {
        type: "STRING",
        enum: ["demo-001", "demo-002"],
        description: "The ID of a predefined synthetic scenario.",
      },
    },
    required: ["scenarioId"],
  },
};

export async function runToolCallingDemo(): Promise<string> {
  const prompt =
    "Retrieve scenario demo-001 using the available tool. " +
    "Then summarize the returned fictional context in one sentence.";

  // 1. Ask Gemini to request the tool.
  const firstResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [
        {
          functionDeclarations: [getSyntheticContextDeclaration],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["get_synthetic_context"],
        },
      },
    },
  });

  const functionCall = firstResponse.functionCalls?.[0];

  if (
    !functionCall ||
    functionCall.name !== "get_synthetic_context" ||
    !functionCall.args
  ) {
    throw new Error("Gemini did not return the expected tool call");
  }

  // 2. Your application executes the requested function.
  const toolResult = getSyntheticContext(functionCall.args);

  // Preserve Gemini's original function-call message.
  const modelContent = firstResponse.candidates?.[0]?.content;

  if (!modelContent) {
    throw new Error("Gemini's tool-call message was missing");
  }

  // 3. Send the tool result back to Gemini.
  const finalResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: prompt }] },
      modelContent,
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: functionCall.name,
              response: { result: toolResult },
            },
          },
        ],
      },
    ],
  });

  if (!finalResponse.text) {
    throw new Error("Gemini returned no final text");
  }

  return finalResponse.text;
}
