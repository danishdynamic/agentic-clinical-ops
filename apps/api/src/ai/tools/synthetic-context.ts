
import { z } from "zod";

const contextRequestSchema = z.object({
  scenarioId: z.enum(["demo-001", "demo-002"]),
});

const syntheticScenarios = {
  "demo-001": {
    symptoms: ["mild headache"],
    duration: "2 hours",
    source: "synthetic-training-data",
  },
  "demo-002": {
    symptoms: ["sore throat", "runny nose"],
    duration: "1 day",
    source: "synthetic-training-data",
  },
};

export function getSyntheticContext(input: unknown) {
  const { scenarioId } = contextRequestSchema.parse(input);
  return syntheticScenarios[scenarioId];
}