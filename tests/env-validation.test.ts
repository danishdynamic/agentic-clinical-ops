import { describe, expect, it } from "vitest";

import { validateRuntimeEnv } from "../apps/api/src/config/env.js";

const validEnv = {
  PORT: "3000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  GEMINI_API_KEY: "synthetic-test-key",
  AUTH_ISSUER: "https://identity.example.test/",
  AUTH_AUDIENCE: "agentic-clinical-ops",
  AUTH_JWKS_URL: "https://identity.example.test/.well-known/jwks.json",
};

describe("runtime environment validation", () => {
  it("accepts required connection and authentication configuration", () => {
    expect(validateRuntimeEnv(validEnv).AUTH_REVIEWER_ROLE).toBe("reviewer");
  });

  it("rejects missing authentication and invalid connection URLs", () => {
    expect(() =>
      validateRuntimeEnv({
        ...validEnv,
        AUTH_JWKS_URL: "",
        DATABASE_URL: "not-a-url",
      }),
    ).toThrow();
  });
});
