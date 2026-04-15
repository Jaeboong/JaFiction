import { OpenDartClient, OpenDartCompanyResolution } from "../openDart";
import { OpenDartCandidate } from "../types";
import { DartSourcePayload } from "./types";

export type DartFetchResult =
  | { kind: "resolved"; payload: DartSourcePayload }
  | { kind: "ambiguous"; candidates: readonly OpenDartCandidate[] }
  | { kind: "notFound"; notices: readonly string[] }
  | { kind: "unavailable"; notices: readonly string[] }
  | { kind: "skipped" };

export async function fetchDartSource(
  companyName: string,
  existingCorpCode: string | undefined,
  storageRoot: string,
  apiKey: string
): Promise<DartFetchResult> {
  const client = new OpenDartClient(storageRoot, apiKey);
  let resolution: OpenDartCompanyResolution;

  try {
    resolution = await client.resolveAndFetchCompany(companyName, existingCorpCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unavailable", notices: [`OpenDART enrichment failed: ${message}`] };
  }

  if (resolution.status === "ambiguous") {
    return { kind: "ambiguous", candidates: resolution.candidates };
  }

  if (resolution.status === "notFound") {
    return { kind: "notFound", notices: resolution.notices };
  }

  if (resolution.status === "unavailable") {
    return { kind: "unavailable", notices: resolution.notices };
  }

  return { kind: "resolved", payload: { resolution } };
}
