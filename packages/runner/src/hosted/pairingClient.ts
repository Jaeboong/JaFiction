/**
 * pairingClient.ts — Stage 11.9
 *
 * Auto-claim flow: on first boot, registers a pending device claim with the backend
 * and polls for approval. No manual code entry or environment variables needed.
 *
 * The backend matches the claim by source IP — in dev both runner and web are
 * on 127.0.0.1; in prod both arrive through nginx which passes X-Forwarded-For.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

const POLL_INTERVAL_MS = 1_000;
// 10 minutes matches the backend claim TTL.
const MAX_WAIT_MS = 10 * 60 * 1_000;

const RegisterClaimResponseSchema = z.object({
  claimId: z.string().min(1),
  pollToken: z.string().min(1),
  expiresAt: z.string().min(1),
});

const PollResponseSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  token: z.string().optional(),
  deviceId: z.string().optional(),
  userId: z.string().optional(),
});

export type AutoClaimResult = {
  readonly token: string;
  readonly deviceId: string;
  readonly userId: string;
};

export class AutoClaimError extends Error {
  constructor(
    readonly reason: "rejected" | "expired" | "network_error",
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AutoClaimError";
  }
}

export interface AutoClaimDeps {
  readonly fetch?: typeof globalThis.fetch;
}

// Read the runner version from its own package.json at module load time.
function readRunnerVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    const content = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const RUNNER_VERSION = readRunnerVersion();

export async function autoClaimDevice(
  opts: { backendUrl: string; abortSignal?: AbortSignal },
  deps: AutoClaimDeps = {}
): Promise<AutoClaimResult> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const base = opts.backendUrl.replace(/\/$/, "");

  // Step 1: register the pending claim
  let registerRes: Response;
  try {
    registerRes = await fetchFn(`${base}/auth/device-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.abortSignal,
      body: JSON.stringify({
        hostname: os.hostname(),
        os: process.platform,
        runnerVersion: RUNNER_VERSION,
      }),
    });
  } catch (err) {
    throw new AutoClaimError(
      "network_error",
      `Failed to register device claim: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  if (!registerRes.ok) {
    throw new AutoClaimError(
      "network_error",
      `Device claim registration failed (${registerRes.status})`
    );
  }

  const registerRaw = await registerRes.json().catch(() => null);
  const registerParsed = RegisterClaimResponseSchema.safeParse(registerRaw);
  if (!registerParsed.success) {
    throw new AutoClaimError("network_error", "Unexpected claim registration response shape");
  }

  const { claimId, pollToken } = registerParsed.data;

  console.log(`[runner] Waiting for approval at ${base} (claim ${claimId.slice(0, 8)}...)`);
  console.log("[runner] Open the web UI, log in, and click Connect.");

  // Step 2: poll for approval
  const deadline = Date.now() + MAX_WAIT_MS;
  let networkErrors = 0;

  while (Date.now() < deadline) {
    if (opts.abortSignal?.aborted) {
      throw new AutoClaimError("network_error", "Auto-claim aborted");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let pollRes: Response;
    try {
      pollRes = await fetchFn(`${base}/auth/device-claim/${claimId}?pollToken=${encodeURIComponent(pollToken)}`, {
        signal: opts.abortSignal,
      });
      networkErrors = 0;
    } catch (err) {
      networkErrors++;
      if (networkErrors >= 3) {
        throw new AutoClaimError(
          "network_error",
          `Device claim poll failed after 3 network errors: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
      continue;
    }

    if (!pollRes.ok) {
      throw new AutoClaimError("network_error", `Device claim poll returned ${pollRes.status}`);
    }

    const pollRaw = await pollRes.json().catch(() => null);
    const pollParsed = PollResponseSchema.safeParse(pollRaw);
    if (!pollParsed.success) {
      continue;
    }

    const { status } = pollParsed.data;

    if (status === "approved") {
      const { token, deviceId, userId } = pollParsed.data;
      if (!token || !deviceId || !userId) {
        throw new AutoClaimError("network_error", "Approved claim missing token/deviceId/userId");
      }
      return { token, deviceId, userId };
    }

    if (status === "rejected") {
      throw new AutoClaimError("rejected", "Device claim was rejected by the user");
    }

    if (status === "expired") {
      throw new AutoClaimError("expired", "Device claim expired before approval");
    }

    // status === "pending" — continue polling
  }

  throw new AutoClaimError("expired", "Device claim timed out after 10 minutes");
}
