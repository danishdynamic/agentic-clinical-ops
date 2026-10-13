
import { getSyntheticContext } from "../apps/api/src/ai/tools/synthetic-context.js";

const result = getSyntheticContext({ scenarioId: "demo-001" });

console.log("Known scenario:", result.symptoms[0] === "mild headache");

let rejectedInvalidInput = false;

try {
  getSyntheticContext({ scenarioId: "real-patient-123" });
} catch {
  rejectedInvalidInput = true;
}

console.log("Invalid scenario rejected:", rejectedInvalidInput);