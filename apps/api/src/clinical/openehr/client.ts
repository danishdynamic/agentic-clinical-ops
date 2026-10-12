import { env } from "../../config/env.js";
import { OpenEhrComposition } from "./types.js";

const EHRBASE_BASE_URL = env.ehrbaseBaseUrl;

export class OpenEhrClient {
  async getTemplates(): Promise<unknown[]> {
    const response = await fetch(
      `${EHRBASE_BASE_URL}/definition/template/adl1.4`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `openEHR request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as unknown[];
  }

  async getComposition(
    ehrId: string,
    compositionUid: string,
  ): Promise<OpenEhrComposition> {
    const response = await fetch(
      `${EHRBASE_BASE_URL}/ehr/${ehrId}/composition/${compositionUid}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `openEHR request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as OpenEhrComposition;
  }
}