import { describe, expect, it } from "vitest";
import { triageGraph } from "../apps/api/src/ai/triage-graph.js";

describe("triageGraph", () => {
  it("creates a draft and marks it for review", async () => {
    const result = await triageGraph.invoke({
      scenarioId: "demo-001",
    });

    expect(result.summary).toBeTypeOf("string");
    expect(result.summary.toLowerCase()).toContain("mild headache");
    expect(result.humanReviewRequired).toBe(true);
    expect(result.triageDraft).not.toBeNull();
  });

  it("rejects an unknown scenario", async () => {
    await expect(
      triageGraph.invoke({
        scenarioId: "unknown",
      }),
    ).rejects.toThrow("Unknown synthetic scenario");
  });
});