/**
 * pairingClient.ts — Stage 11.10
 *
 * Hosted runners always register a pending claim on startup so additional
 * users on the same machine can authorize the existing device without
 * re-pairing. First-boot still receives a fresh token through the claim poll.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

const POLL_INTERVAL_MS = 1_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;

const RegisterClaimResponseSchema = z.object({
  claimId: z.string().min(1),
  pollToken: z.string().min(1),
  expiresAt: z.string().min(1),
});

const PollResponseSchema = z.object({
  status: z.enum(["pending", "approved", "authorized", "rejected", "expired"]),
  token: z.string().optional(),
  deviceId: z.string().optional(),
  userId: z.string().optional(),
});

const ResolveDeviceResponseSchema = z.object({
  deviceId: z.string().uuid(),
});

export type RegisterClaimResult = z.infer<typeof RegisterClaimResponseSchema>;

export type PollClaimResult =
  | {
      readonly status: "approved";
      readonly token: string;
      readonly deviceId: string;
      readonly userId: string;
    }
  | {
      readonly status: "authorized";
      readonly deviceId: string;
      readonly userId?: string;
    };

export type AutoClaimResult = Extract<PollClaimResult, { status: "approved" }>;

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
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFetch(deps: AutoClaimDeps): typeof globalThis.fetch {
  return deps.fetch ?? globalThis.fetch;
}

function getSleep(deps: AutoClaimDeps): (ms: number) => Promise<void> {
  return deps.sleep ?? defaultSleep;
}

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

export async function registerClaim(
  opts: {
    backendUrl: string;
    deviceId?: string;
    abortSignal?: AbortSignal;
  },
  deps: AutoClaimDeps = {}
): Promise<RegisterClaimResult> {
  const fetchFn = getFetch(deps);
  const base = opts.backendUrl.replace(/\/$/, "");

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
        ...(opts.deviceId ? { deviceId: opts.deviceId } : {}),
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

  return registerParsed.data;
}

export async function resolveDeviceId(
  opts: {
    backendUrl: string;
    deviceToken: string;
    abortSignal?: AbortSignal;
  },
  deps: AutoClaimDeps = {}
): Promise<string | undefined> {
  const fetchFn = getFetch(deps);
  const base = opts.backendUrl.replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetchFn(`${base}/auth/device/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.abortSignal,
      body: JSON.stringify({ deviceToken: opts.deviceToken }),
    });
  } catch (err) {
    throw new AutoClaimError(
      "network_error",
      `Failed to resolve device ID: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new AutoClaimError(
      "network_error",
      `Device ID resolution failed (${response.status})`
    );
  }

  const raw = await response.json().catch(() => null);
  const parsed = ResolveDeviceResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AutoClaimError("network_error", "Unexpected resolve-device response shape");
  }

  return parsed.data.deviceId;
}

export async function pollClaim(
  opts: {
    backendUrl: string;
    claimId: string;
    pollToken: string;
    abortSignal?: AbortSignal;
  },
  deps: AutoClaimDeps = {}
): Promise<PollClaimResult> {
  const fetchFn = getFetch(deps);
  const sleep = getSleep(deps);
  const base = opts.backendUrl.replace(/\/$/, "");
  const deadline = Date.now() + MAX_WAIT_MS;
  let networkErrors = 0;

  while (Date.now() < deadline) {
    if (opts.abortSignal?.aborted) {
      throw new AutoClaimError("network_error", "Auto-claim aborted");
    }

    await sleep(POLL_INTERVAL_MS);

    let pollRes: Response;
    try {
      pollRes = await fetchFn(
        `${base}/auth/device-claim/${opts.claimId}?pollToken=${encodeURIComponent(opts.pollToken)}`,
        { signal: opts.abortSignal }
      );
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

    const { status, deviceId, token, userId } = pollParsed.data;

    if (status === "approved") {
      if (!token || !deviceId || !userId) {
        throw new AutoClaimError("network_error", "Approved claim missing token/deviceId/userId");
      }
      return { status, token, deviceId, userId };
    }

    if (status === "authorized") {
      if (!deviceId) {
        throw new AutoClaimError("network_error", "Authorized claim missing deviceId");
      }
      return { status, deviceId, userId };
    }

    if (status === "rejected") {
      throw new AutoClaimError("rejected", "Device claim was rejected by the user");
    }

    if (status === "expired") {
      throw new AutoClaimError("expired", "Device claim expired before approval");
    }
  }

  throw new AutoClaimError("expired", "Device claim timed out after 10 minutes");
}

export async function pollClaimNonBlocking(
  opts: {
    backendUrl: string;
    claimId: string;
    pollToken: string;
    abortSignal?: AbortSignal;
  },
  deps: AutoClaimDeps = {}
): Promise<PollClaimResult> {
  return pollClaim(opts, deps);
}

export async function autoClaimDevice(
  opts: { backendUrl: string; abortSignal?: AbortSignal },
  deps: AutoClaimDeps = {}
): Promise<AutoClaimResult> {
  const claim = await registerClaim(
    {
      backendUrl: opts.backendUrl,
      abortSignal: opts.abortSignal,
    },
    deps
  );

  console.log(`[runner] Waiting for approval at ${opts.backendUrl.replace(/\/$/, "")} (claim ${claim.claimId.slice(0, 8)}...)`);
  console.log("[runner] Open the web UI, log in, and click Connect.");

  const result = await pollClaim(
    {
      backendUrl: opts.backendUrl,
      claimId: claim.claimId,
      pollToken: claim.pollToken,
      abortSignal: opts.abortSignal,
    },
    deps
  );

  if (result.status !== "approved") {
    throw new AutoClaimError("network_error", "Expected approved claim with token for first-time pairing");
  }

  return result;
}
