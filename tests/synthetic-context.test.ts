import { describe, it, expect } from "vitest";
import { getSyntheticContext } from "../apps/api/src/ai/tools/synthetic-context.js";

describe("getSyntheticContext", () => {
  it("should return the correct context for a known scenario", () => {
    const result = getSyntheticContext({ scenarioId: "demo-001" });
    expect(result.symptoms[0]).toBe("mild headache");
  });

  it("should reject invalid or unknown scenarios", () => {
    expect(() => {
      getSyntheticContext({ scenarioId: "real-patient-123" });
    }).toThrow();
  });

  it("should reject various invalid input types and payloads", () => {
    const invalidInputs: unknown[] = [
      {},
      { scenarioId: "unknown-scenario" },
      { scenarioId: 123 },
      null,
      undefined,
    ];

    for (const input of invalidInputs) {
      expect(() => {
        getSyntheticContext(input);
      }).toThrow();
    }
  });
});