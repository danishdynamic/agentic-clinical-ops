import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  fhirBaseUrl:
    process.env.FHIR_BASE_URL ?? "http://localhost:8080/fhir",
  ehrbaseBaseUrl:
    process.env.EHRBASE_BASE_URL ?? "http://localhost:8081/ehrbase/rest/openehr/v1",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
};