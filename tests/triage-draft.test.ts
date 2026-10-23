import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTriageDraft } from "../apps/api/src/ai/triage.js";

// Mock the GoogleGenAI module
const mockGenerateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
      };
    },
  };
});

describe("createTriageDraft", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it("includes FHIR context in the prompt when provided", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: "Patient presents with headache and existing allergy notes.",
        suggestedUrgency: "routine",
        reasons: ["Mild symptoms reported", "No acute red flags"],
        humanReviewRequired: true,
      }),
    });

    const result = await createTriageDraft({
      scenario: "Adult reports a mild headache.",
      historySummary: "Headache for 2 hours.",
      fhirContext: '{"patient":{"id":"demo-001"}}',
    });

    expect(result.suggestedUrgency).toBe("routine");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    // Verify the prompt sent to Gemini includes the FHIR context
    const calledArg = mockGenerateContent.mock.calls[0][0];
    expect(calledArg.contents).toContain('{"patient":{"id":"demo-001"}}');
  });

  it("falls back to default text when FHIR context is omitted", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: "Patient presents with sore throat.",
        suggestedUrgency: "routine",
        reasons: ["Sore throat for 1 day"],
        humanReviewRequired: true,
      }),
    });

    await createTriageDraft({
      scenario: "Adult reports a sore throat.",
      historySummary: "Sore throat for 1 day.",
    });

    const calledArg = mockGenerateContent.mock.calls[0][0];
    expect(calledArg.contents).toContain("No FHIR context supplied.");
  });
});