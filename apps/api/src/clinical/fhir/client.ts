import { env } from "../../config/env.js";
import type {
  FhirAllergyIntolerance,
  FhirObservation,
  FhirPatient,
} from "./types.js";

const FHIR_BASE_URL = env.fhirBaseUrl;

export class FhirClient {
  async getPatient(patientId: string): Promise<FhirPatient> {
    const response = await fetch(
      `${FHIR_BASE_URL}/Patient/${encodeURIComponent(patientId)}`,
      {
        headers: {
          Accept: "application/fhir+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `FHIR request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as FhirPatient;
  }

  async getObservations(patientId: string): Promise<FhirObservation[]> {
    const response = await fetch(
      `${FHIR_BASE_URL}/Observation?patient=${encodeURIComponent(patientId)}`,
      {
        headers: {
          Accept: "application/fhir+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `FHIR request failed: ${response.status} ${response.statusText}`,
      );
    }

    const bundle = (await response.json()) as {
      resourceType: "Bundle";
      entry?: Array<{
        resource?: FhirObservation;
      }>;
    };

    return (
      bundle.entry
        ?.map((entry) => entry.resource)
        .filter(
          (resource): resource is FhirObservation =>
            resource?.resourceType === "Observation",
        ) ?? []
    );
  }

  async getAllergies(patientId: string): Promise<FhirAllergyIntolerance[]> {
    const response = await fetch(
      `${FHIR_BASE_URL}/AllergyIntolerance?patient=${encodeURIComponent(patientId)}`,
      {
        headers: {
          Accept: "application/fhir+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `FHIR request failed: ${response.status} ${response.statusText}`,
      );
    }

    const bundle = (await response.json()) as {
      resourceType: "Bundle";
      entry?: Array<{
        resource?: FhirAllergyIntolerance;
      }>;
    };

    return (
      bundle.entry
        ?.map((entry) => entry.resource)
        .filter(
          (resource): resource is FhirAllergyIntolerance =>
            resource?.resourceType === "AllergyIntolerance",
        ) ?? []
    );
  }
}