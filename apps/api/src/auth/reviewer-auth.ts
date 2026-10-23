import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

import { env } from "../config/env.js";

export type ReviewerIdentity = {
  reviewerId: string;
  roles: string[];
};

export class ReviewerAuthConfigurationError extends Error {
  constructor() {
    super("Reviewer authentication is not configured");
    this.name = "ReviewerAuthConfigurationError";
  }
}

let remoteJwks: JWTVerifyGetKey | undefined;

export async function verifyReviewerJwt(
  token: string,
  keySet: JWTVerifyGetKey,
  settings: { issuer: string; audience: string },
): Promise<ReviewerIdentity | null> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      algorithms: ["RS256"],
      issuer: settings.issuer,
      audience: settings.audience,
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return null;
    }
    throw error;
  }

  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter(
        (role: unknown): role is string => typeof role === "string",
      )
    : [];

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return null;
  }

  return { reviewerId: payload.sub, roles };
}

export async function authenticateReviewer(
  authorization: string | undefined,
): Promise<ReviewerIdentity | null> {
  if (!env.authIssuer || !env.authAudience || !env.authJwksUrl) {
    throw new ReviewerAuthConfigurationError();
  }

  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    return null;
  }

  remoteJwks ??= createRemoteJWKSet(new URL(env.authJwksUrl));
  return verifyReviewerJwt(match[1], remoteJwks, {
    issuer: env.authIssuer,
    audience: env.authAudience,
  });
}
