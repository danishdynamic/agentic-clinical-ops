
import { z } from "zod";

export const triageDraftSchema = z.object({
  summary: z.string().min(1),
  suggestedUrgency: z.enum([
    "routine",
    "prompt",
    "emergency",
  ]),
  reasons: z.array(z.string()).min(1),
  humanReviewRequired: z.literal(true),
});

export type TriageDraft = z.infer<typeof triageDraftSchema>;