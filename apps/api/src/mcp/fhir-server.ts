import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FhirClient } from "../clinical/fhir/client.js";

export function createFhirMcpServer(fhirClient = new FhirClient()) {
  const server = new McpServer({
    name: "clinical-fhir-tools",
    version: "1.0.0",
  });

  server.registerTool(
    "get_patient",
    {
      description:
        "Read a single FHIR Patient resource by its logical ID. Read-only.",
      inputSchema: {
        patientId: z
          .string()
          .regex(/^[A-Za-z0-9.-]{1,64}$/, "Invalid FHIR patient ID"),
      },
    },
    async ({ patientId }) => {
      try {
        const patient = await fhirClient.getPatient(patientId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(patient) }],
        };
      } catch (error) {
        console.error("get_patient failed:", error);
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Unable to retrieve the requested patient.",
          }],
        };
      }
    },
  );

  server.registerTool(
    "get_observations",
    {
      description:
        "Read FHIR Observation resources for a patient. Read-only.",
      inputSchema: {
        patientId: z
          .string()
          .regex(/^[A-Za-z0-9.-]{1,64}$/, "Invalid FHIR patient ID"),
      },
    },
    async ({ patientId }) => {
      try {
        const observations = await fhirClient.getObservations(patientId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(observations),
            },
          ],
        };
      } catch (error) {
        console.error("get_observations failed:", error);

        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Unable to retrieve patient observations.",
          }],
        };
      }
    },
  );

  server.registerTool(
    "get_allergies",
    {
      description:
        "Read FHIR AllergyIntolerance resources for a patient. Read-only.",
      inputSchema: {
        patientId: z
          .string()
          .regex(/^[A-Za-z0-9.-]{1,64}$/, "Invalid FHIR patient ID"),
      },
    },
    async ({ patientId }) => {
      try {
        const allergies = await fhirClient.getAllergies(patientId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(allergies),
            },
          ],
        };
      } catch (error) {
        console.error("get_allergies failed:", error);

        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Unable to retrieve patient allergies.",
          }],
        };
      }
    },
  );

  return server;
}

async function main() {
  const server = createFhirMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1]?.endsWith("fhir-server.ts")) {
  main().catch((error: unknown) => {
    console.error("FHIR MCP server failed to start:", error);
    process.exitCode = 1;
  });
}