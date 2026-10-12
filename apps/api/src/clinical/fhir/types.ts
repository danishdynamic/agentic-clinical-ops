export type FhirPatient = {
  resourceType: "Patient";
  id?: string;

  name?: Array<{
    use?: string;
    family?: string;
    given?: string[];
  }>;

  gender?: string;
};

export type FhirObservation = {
  resourceType: "Observation";
  id?: string;

  status?: string;

  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };

  valueQuantity?: {
    value?: number;
    unit?: string;
    system?: string;
    code?: string;
  };

  subject?: {
    reference?: string;
  };
};

export type FhirAllergyIntolerance = {
  resourceType: "AllergyIntolerance";
  id?: string;

  clinicalStatus?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  };

  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };

  patient?: {
    reference?: string;
  };
};