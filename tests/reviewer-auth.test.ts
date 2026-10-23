import { describe, expect, it } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import { verifyReviewerJwt } from "../apps/api/src/auth/reviewer-auth.js";

const issuer = "https://identity.example.test/";
const audience = "agentic-clinical-ops";

async function createReviewerToken(roles: string[]) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "reviewer-test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const keySet = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT({ roles })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("synthetic-reviewer-001")
    .setExpirationTime("5m")
    .sign(privateKey);

  return { token, keySet };
}

describe("reviewer JWT authentication", () => {
  it("accepts a valid signed reviewer identity", async () => {
    const { token, keySet } = await createReviewerToken(["reviewer"]);

    await expect(
      verifyReviewerJwt(token, keySet, { issuer, audience }),
    ).resolves.toEqual({
      reviewerId: "synthetic-reviewer-001",
      roles: ["reviewer"],
    });
  });

  it("rejects a token with an invalid issuer", async () => {
    const { token, keySet } = await createReviewerToken(["reviewer"]);

    await expect(
      verifyReviewerJwt(token, keySet, {
        issuer: "https://untrusted.example.test/",
        audience,
      }),
    ).resolves.toBeNull();
  });

  it("preserves roles so the route can deny non-reviewers", async () => {
    const { token, keySet } = await createReviewerToken(["observer"]);

    await expect(
      verifyReviewerJwt(token, keySet, { issuer, audience }),
    ).resolves.toEqual({
      reviewerId: "synthetic-reviewer-001",
      roles: ["observer"],
    });
  });
});
