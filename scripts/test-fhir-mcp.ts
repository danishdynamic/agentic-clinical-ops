
import { createFhirMcpClient } from "../apps/api/src/mcp/fhir-client.js";

async function main() {
  const client = await createFhirMcpClient();

  try {
    const result = await client.listTools();

    console.log(
      "Discovered MCP tools:",
      result.tools.map((tool) => tool.name),
    );

    const expectedTools = [
      "get_patient",
      "get_observations",
      "get_allergies",
    ];

    for (const name of expectedTools) {
      if (!result.tools.some((tool) => tool.name === name)) {
        throw new Error(`Expected MCP tool not found: ${name}`);
      }
    }

    console.log("MCP connection and tool discovery succeeded.");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error("MCP smoke test failed:", error);
  process.exitCode = 1;
});
