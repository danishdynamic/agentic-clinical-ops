import { triageDraftSchema } from "../apps/api/src/ai/triage.schema.js";

const validDraft = {
  summary: "Synthetic scenario",
  suggestedUrgency: "routine",
  reasons: ["Fictional test reason"],
  humanReviewRequired: true,
};

console.log("Valid draft:", triageDraftSchema.safeParse(validDraft).success);

console.log(
  "Invalid urgency rejected:",
  !triageDraftSchema.safeParse({
    ...validDraft,
    suggestedUrgency: "super-urgent",
  }).success,
);

console.log(
  "Missing human review rejected:",
  !triageDraftSchema.safeParse({
    ...validDraft,
    humanReviewRequired: false,
  }).success,
);