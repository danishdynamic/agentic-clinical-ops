
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function textAt(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 200)
    : undefined;
}

function displayFromCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const directText = textAt(value.text);
  if (directText) return directText;

  if (Array.isArray(value.coding)) {
    for (const coding of value.coding) {
      if (!isRecord(coding)) continue;
      const display = textAt(coding.display);
      if (display) return display;
    }
  }

  return undefined;
}

export function normalizeFhirContext(
  patient: unknown,
  observations: unknown,
  allergies: unknown,
): string {
  if (
    !isRecord(patient) ||
    patient.resourceType !== "Patient"
  ) {
    throw new Error("Invalid FHIR Patient resource");
  }

  if (!Array.isArray(observations) || !Array.isArray(allergies)) {
    throw new Error("Invalid FHIR context collections");
  }

  const normalizedObservations = observations
    .slice(0, 20)
    .map((item) => {
      if (!isRecord(item) || item.resourceType !== "Observation") {
        throw new Error("Invalid FHIR Observation resource");
      }

      const valueQuantity = isRecord(item.valueQuantity)
        ? item.valueQuantity
        : undefined;

      return {
        status: textAt(item.status),
        code: displayFromCode(item.code),
        effectiveDateTime: textAt(item.effectiveDateTime),
        value: valueQuantity &&
          typeof valueQuantity.value === "number"
          ? {
              amount: valueQuantity.value,
              unit: textAt(valueQuantity.unit),
            }
          : undefined,
        valueString: textAt(item.valueString),
      };
    });

  const normalizedAllergies = allergies
    .slice(0, 20)
    .map((item) => {
      if (!isRecord(item) || item.resourceType !== "AllergyIntolerance") {
        throw new Error("Invalid FHIR AllergyIntolerance resource");
      }

      return {
        substance: displayFromCode(item.code),
        clinicalStatus: displayFromCode(item.clinicalStatus),
        verificationStatus: displayFromCode(item.verificationStatus),
      };
    });

  // Deliberately omit patient identifiers and other demographics.
  return JSON.stringify({
    source: "FHIR",
    patientResourceValidated: true,
    observations: normalizedObservations,
    allergies: normalizedAllergies,
  });
}
