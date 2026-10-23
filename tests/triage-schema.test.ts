import { describe, expect, it } from "vitest";

import { triageDraftSchema } from "../apps/api/src/ai/triage.schema.js";

const validDraft = {
  summary: "Synthetic scenario",
  suggestedUrgency: "routine",
  reasons: ["Fictional test reason"],
  humanReviewRequired: true,
};

describe("triageDraftSchema", () => {
  it("accepts a valid synthetic draft", () => {
    expect(triageDraftSchema.safeParse(validDraft).success).toBe(true);
  });

  it("rejects an unsupported urgency", () => {
    expect(
      triageDraftSchema.safeParse({
        ...validDraft,
        suggestedUrgency: "super-urgent",
      }).success,
    ).toBe(false);
  });

  it("rejects a draft that does not require human review", () => {
    expect(
      triageDraftSchema.safeParse({
        ...validDraft,
        humanReviewRequired: false,
      }).success,
    ).toBe(false);
  });
});
