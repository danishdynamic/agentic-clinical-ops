
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function createFhirMcpClient() {
  const client = new Client({
    name: "clinical-ops-agent",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: "pnpm",
    args: [
      "exec",
      "tsx",
      "apps/api/src/mcp/fhir-server.ts",
    ],
    cwd: process.cwd(),
  });

  await client.connect(transport);

  return {
    async listTools() {
      return client.listTools();
    },

    async callTool(
      name: "get_patient" | "get_observations" | "get_allergies",
      patientId: string,
    ): Promise<unknown> {
      const result = await client.callTool({
        name,
        arguments: { patientId },
      });

      if (result.isError) {
        throw new Error(`FHIR MCP tool failed: ${name}`);
      }

      const textContent = result.content.find(
        (item) => item.type === "text",
      );

      if (!textContent || textContent.type !== "text") {
        throw new Error(`FHIR MCP tool returned no text: ${name}`);
      }

      return JSON.parse(textContent.text) as unknown;
    },

    async close() {
      await client.close();
    },
  };
}
