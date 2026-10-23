import "dotenv/config";
import { z } from "zod";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  fhirBaseUrl:
    process.env.FHIR_BASE_URL ?? "http://localhost:8080/fhir",
  ehrbaseBaseUrl:
    process.env.EHRBASE_BASE_URL ?? "http://localhost:8081/ehrbase/rest/openehr/v1",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  authIssuer: process.env.AUTH_ISSUER ?? "",
  authAudience: process.env.AUTH_AUDIENCE ?? "",
  authJwksUrl: process.env.AUTH_JWKS_URL ?? "",
  reviewerRole: process.env.AUTH_REVIEWER_ROLE ?? "reviewer",
};

const runtimeEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GEMINI_API_KEY: z.string().trim().min(1),
  FHIR_BASE_URL: z.string().url().default("http://localhost:8080/fhir"),
  EHRBASE_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:8081/ehrbase/rest/openehr/v1"),
  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string().trim().min(1),
  AUTH_JWKS_URL: z.string().url(),
  AUTH_REVIEWER_ROLE: z.string().trim().min(1).default("reviewer"),
});

export function validateRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
) {
  return runtimeEnvSchema.parse(source);
}