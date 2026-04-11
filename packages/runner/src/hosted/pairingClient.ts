/**
 * pairingClient.ts — Phase 5
 *
 * Calls POST <backendUrl>/api/pairing/claim with a pairing code and returns
 * the device token + identifiers on success.
 *
 * Uses native fetch (Node 22). Validates the response shape with zod.
 * Throws on non-200 responses or schema mismatch.
 *
 * The optional `fetch` parameter allows dependency injection in tests.
 */

import { z } from "zod";

const ClaimResponseSchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().min(1),
  userId: z.string().min(1),
});

export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export interface PairingClientOpts {
  readonly backendUrl: string;
  readonly code: string;
}

export interface PairingClientDeps {
  readonly fetch?: typeof globalThis.fetch;
}

export async function claimPairingCode(
  opts: PairingClientOpts,
  deps: PairingClientDeps = {}
): Promise<ClaimResponse> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const url = `${opts.backendUrl.replace(/\/$/, "")}/api/pairing/claim`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: opts.code }),
    });
  } catch (err) {
    throw new Error(
      `Pairing claim request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = null;
    }
    const errorCode =
      typeof errorBody === "object" &&
      errorBody !== null &&
      "error" in errorBody &&
      typeof (errorBody as Record<string, unknown>).error === "string"
        ? (errorBody as Record<string, string>).error
        : "unknown_error";
    throw new Error(
      `Pairing claim failed (${response.status}): ${errorCode}`
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    throw new Error("Pairing claim response is not valid JSON");
  }

  const parsed = ClaimResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error(
      `Pairing claim response has unexpected shape: ${parsed.error.message}`
    );
  }

  return parsed.data;
}
