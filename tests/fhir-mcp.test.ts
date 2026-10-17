import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFhirMcpServer } from "../apps/api/src/mcp/fhir-server.js";
import { FhirClient } from "../apps/api/src/clinical/fhir/client.js";

const mockGetPatient = vi.fn();
const mockGetObservations = vi.fn();
const mockGetAllergies = vi.fn();

const fakeFhirClient = {
  getPatient: mockGetPatient,
  getObservations: mockGetObservations,
  getAllergies: mockGetAllergies,
} as unknown as FhirClient;

const openConnections: Array<{
  client: Client;
  server: ReturnType<typeof createFhirMcpServer>;
}> = [];

beforeEach(() => {
  mockGetPatient.mockReset();
  mockGetObservations.mockReset();
  mockGetAllergies.mockReset();
});

async function createHarness() {
  const server = createFhirMcpServer(fakeFhirClient);
  const client = new Client({
    name: "fhir-mcp-test-client",
    version: "1.0.0",
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  openConnections.push({ client, server });

  return { client };
}

afterEach(async () => {
  while (openConnections.length > 0) {
    const connection = openConnections.pop()!;
    await connection.client.close();
    await connection.server.close();
  }

  vi.restoreAllMocks();
});

describe("FHIR MCP server", () => {
  it("registers all three read-only FHIR tools", async () => {
    const { client } = await createHarness();

    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "get_patient",
        "get_observations",
        "get_allergies",
      ]),
    );
  });

  it("calls the FHIR client with a valid patient ID", async () => {
    mockGetPatient.mockResolvedValue({
      resourceType: "Patient",
      id: "demo-001",
    });

    const { client } = await createHarness();

    const result = await client.callTool({
      name: "get_patient",
      arguments: { patientId: "demo-001" },
    });

    expect(mockGetPatient).toHaveBeenCalledWith("demo-001");
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"id":"demo-001"'),
      }),
    );
  });

  it("rejects an invalid patient ID", async () => {
    const { client } = await createHarness();

    const result = await client.callTool({
      name: "get_patient",
      arguments: { patientId: "invalid patient ID!" },
    });

    expect(result.isError).toBe(true);
    expect(mockGetPatient).not.toHaveBeenCalled();
  });

  it("returns a tool error when FHIR is unavailable", async () => {
    mockGetPatient.mockRejectedValue(new Error("Simulated FHIR outage"));

    const { client } = await createHarness();

    const result = await client.callTool({
      name: "get_patient",
      arguments: { patientId: "demo-001" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Unable to retrieve the requested patient.",
      }),
    );
  });

  it("calls get_observations with a valid patient ID and handles errors", async () => {
    mockGetObservations.mockResolvedValue([
      { resourceType: "Observation", id: "obs-001" },
    ]);

    const { client } = await createHarness();

    const successResult = await client.callTool({
      name: "get_observations",
      arguments: { patientId: "demo-001" },
    });

    expect(mockGetObservations).toHaveBeenCalledWith("demo-001");
    expect(successResult.isError).not.toBe(true);
    expect(successResult.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"id":"obs-001"'),
      }),
    );

    // Test invalid ID rejection
    const invalidResult = await client.callTool({
      name: "get_observations",
      arguments: { patientId: "bad id!" },
    });
    expect(invalidResult.isError).toBe(true);

    // Test client rejection
    mockGetObservations.mockRejectedValue(new Error("Outage"));
    const errorResult = await client.callTool({
      name: "get_observations",
      arguments: { patientId: "demo-001" },
    });
    expect(errorResult.isError).toBe(true);
    expect(errorResult.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Unable to retrieve patient observations.",
      }),
    );
  });

  it("calls get_allergies with a valid patient ID and handles errors", async () => {
    mockGetAllergies.mockResolvedValue([
      { resourceType: "AllergyIntolerance", id: "allergy-001" },
    ]);

    const { client } = await createHarness();

    const successResult = await client.callTool({
      name: "get_allergies",
      arguments: { patientId: "demo-001" },
    });

    expect(mockGetAllergies).toHaveBeenCalledWith("demo-001");
    expect(successResult.isError).not.toBe(true);
    expect(successResult.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"id":"allergy-001"'),
      }),
    );

    // Test invalid ID rejection
    const invalidResult = await client.callTool({
      name: "get_allergies",
      arguments: { patientId: "bad id!" },
    });
    expect(invalidResult.isError).toBe(true);

    // Test client rejection
    mockGetAllergies.mockRejectedValue(new Error("Outage"));
    const errorResult = await client.callTool({
      name: "get_allergies",
      arguments: { patientId: "demo-001" },
    });
    expect(errorResult.isError).toBe(true);
    expect(errorResult.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Unable to retrieve patient allergies.",
      }),
    );
  });
});