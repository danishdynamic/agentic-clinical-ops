import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAgentRun } from "../apps/api/src/db/agent-runs.js";
import { claimRunResume } from "../apps/api/src/db/claim-run-resume.js";
import { db } from "../apps/api/src/db/postgres.js";
import { agentRuns } from "../apps/api/src/db/schema/agent-runs.js";

describe("claimRunResume integration tests", () => {
  it("successfully claims a run when status is awaiting_approval", async () => {
    // 1. Create a run and set its status to awaiting_approval
    const run = await createAgentRun("patient-claim-001");
    await db
      .update(agentRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(agentRuns.id, run.id));

    // 2. Attempt to claim the run
    const claimed = await claimRunResume(run.id);

    // 3. Verify it was successfully claimed
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(run.id);

    // 4. Verify in DB that status transitioned to 'resuming'
    const [updated] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, run.id));
    expect(updated.status).toBe("resuming");
  });

  it("returns null and cannot claim the same run a second time", async () => {
    const run = await createAgentRun("patient-claim-002");
    await db
      .update(agentRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(agentRuns.id, run.id));

    // First claim succeeds
    const firstClaim = await claimRunResume(run.id);
    expect(firstClaim).not.toBeNull();

    // Second claim should fail and return null
    const secondClaim = await claimRunResume(run.id);
    expect(secondClaim).toBeNull();
  });

  it("cannot claim a run whose status is completed", async () => {
    const run = await createAgentRun("patient-claim-003");
    await db
      .update(agentRuns)
      .set({ status: "completed" })
      .where(eq(agentRuns.id, run.id));

    const claimed = await claimRunResume(run.id);
    expect(claimed).toBeNull();
  });

  it("handles concurrent claims and results in exactly one successful claim", async () => {
    const run = await createAgentRun("patient-claim-004");
    await db
      .update(agentRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(agentRuns.id, run.id));

    // Fire multiple claim requests simultaneously against PostgreSQL
    const results = await Promise.all([
      claimRunResume(run.id),
      claimRunResume(run.id),
      claimRunResume(run.id),
      claimRunResume(run.id),
    ]);

    // Filter out null results (failed claims)
    const successfulClaims = results.filter((res) => res !== null);

    // Exactly one concurrent request must win the race
    expect(successfulClaims.length).toBe(1);
    expect(successfulClaims[0].id).toBe(run.id);
  });
});