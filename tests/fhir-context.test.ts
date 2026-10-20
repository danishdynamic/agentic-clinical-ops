
import { describe, expect, it } from "vitest";
import { normalizeFhirContext } from "../apps/api/src/ai/fhir-context.js";

describe("normalizeFhirContext", () => {
  it("keeps selected fields and omits patient identifiers", () => {
    const result = JSON.parse(
      normalizeFhirContext(
        {
          resourceType: "Patient",
          id: "synthetic-patient-1",
          name: [{ text: "Example Person" }],
        },
        [{
          resourceType: "Observation",
          status: "final",
          code: { text: "Heart rate" },
          valueQuantity: { value: 72, unit: "beats/min" },
        }],
        [{
          resourceType: "AllergyIntolerance",
          code: { text: "Example substance" },
          clinicalStatus: {
            coding: [{ display: "active" }],
          },
        }],
      ),
    );

    expect(result.observations[0].value.amount).toBe(72);
    expect(result.allergies[0].substance).toBe("Example substance");
    expect(JSON.stringify(result)).not.toContain("Example Person");
    expect(JSON.stringify(result)).not.toContain("synthetic-patient-1");
  });

  it("rejects an invalid patient resource", () => {
    expect(() =>
      normalizeFhirContext(
        { resourceType: "Observation" },
        [],
        [],
      ),
    ).toThrow("Invalid FHIR Patient resource");
  });

  it("rejects an invalid observation", () => {
    expect(() =>
      normalizeFhirContext(
        { resourceType: "Patient" },
        [{ resourceType: "Patient" }],
        [],
      ),
    ).toThrow("Invalid FHIR Observation resource");
  });

  it("limits the number of observations and allergies", () => {
    const observations = Array.from({ length: 25 }, () => ({
      resourceType: "Observation",
      status: "final",
    }));

    const allergies = Array.from({ length: 25 }, () => ({
      resourceType: "AllergyIntolerance",
    }));

    const result = JSON.parse(
      normalizeFhirContext(
        { resourceType: "Patient" },
        observations,
        allergies,
      ),
    );

    expect(result.observations).toHaveLength(20);
    expect(result.allergies).toHaveLength(20);
  });
});
