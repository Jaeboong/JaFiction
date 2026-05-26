/**
 * instanceLock.ts — Single-instance lock (PID-based, stale-tolerant, last-wins)
 *
 * Lock file: ~/.jasojeon/runner.lock  →  { pid, startedAt } JSON
 *
 * Policy: the most recently started runner wins (last-wins).
 * A new runner signals/kills the old one and takes the lock.
 *
 * Platform: process.platform ("win32" | "linux" | "darwin" | …)
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LockFile {
  readonly pid: number;
  readonly startedAt: string; // ISO-8601
}

export type ProcessProbeResult =
  | "jasojeon" // alive and is jasojeon-runner
  | "other"    // alive but a different process (PID reuse)
  | "dead"     // no longer alive
  | "eperm";   // alive but permission denied — ownership unknown

export type LockDecision =
  | { readonly action: "take-over" }
  | { readonly action: "kill-then-take"; readonly pid: number };

// ── Pure decision function (testable with no IO) ──────────────────────────

export interface DecideLockActionOpts {
  readonly currentLock: LockFile | null;
  readonly ownPid: number;
  readonly probe: (pid: number) => ProcessProbeResult;
}

/**
 * Pure: given the current lock state and a process probe, decide what to do.
 * All IO is handled by the caller.
 */
export function decideLockAction(opts: DecideLockActionOpts): LockDecision {
  const { currentLock, ownPid, probe } = opts;

  if (currentLock === null) {
    return { action: "take-over" };
  }

  if (currentLock.pid === ownPid) {
    // Re-entrant or already holding — just refresh.
    return { action: "take-over" };
  }

  const probeResult = probe(currentLock.pid);

  switch (probeResult) {
    case "dead":
    case "other":
    case "eperm":
      // Stale, PID reuse, or inaccessible — safe to inherit without killing.
      return { action: "take-over" };
    case "jasojeon":
      return { action: "kill-then-take", pid: currentLock.pid };
  }
}

// ── IO helpers ───────────────────────────────────────────────────────────────

const DEFAULT_LOCK_PATH = path.join(os.homedir(), ".jasojeon", "runner.lock");

function parseLockFile(content: string): LockFile | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "pid" in parsed &&
      "startedAt" in parsed &&
      typeof (parsed as Record<string, unknown>).pid === "number" &&
      typeof (parsed as Record<string, unknown>).startedAt === "string"
    ) {
      return parsed as LockFile;
    }
  } catch {
    // Corrupt file — treat as missing.
  }
  return null;
}

function probeProcess(pid: number): ProcessProbeResult {
  // Check liveness via signal 0.
  try {
    process.kill(pid, 0);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      return "eperm";
    }
    // ESRCH or anything else → dead.
    return "dead";
  }

  // Process is alive — check if it's jasojeon-runner to prevent PID-reuse kills.
  try {
    if (process.platform === "win32") {
      // tasklist /FI "PID eq <pid>" /FO CSV /NH
      const out = execFileSync("tasklist", [
        "/FI", `PID eq ${pid}`,
        "/FO", "CSV",
        "/NH",
      ], { timeout: 3000, encoding: "utf8" });
      return out.toLowerCase().includes("jasojeon-runner") ? "jasojeon" : "other";
    } else {
      // ps -p <pid> -o comm=
      const out = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
        timeout: 3000,
        encoding: "utf8",
      });
      return out.toLowerCase().includes("jasojeon-runner") ? "jasojeon" : "other";
    }
  } catch {
    // If the verification command fails, treat as "other" (safe — don't kill).
    return "other";
  }
}

async function killAndWait(pid: number, timeoutMs = 5000): Promise<void> {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/F"], { timeout: 5000 });
    } catch {
      // Already dead or permission denied — continue.
    }
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }

    // Wait for the process to die, then SIGKILL if needed.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      try {
        process.kill(pid, 0);
      } catch {
        // Dead — done.
        return;
      }
    }

    // Still alive after SIGTERM grace period.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead — fine.
    }
  }
}

async function writeLock(lockPath: string, pid: number): Promise<void> {
  const dir = path.dirname(lockPath);
  await fs.mkdir(dir, { recursive: true });
  const content: LockFile = { pid, startedAt: new Date().toISOString() };
  await fs.writeFile(lockPath, JSON.stringify(content), "utf8");
}

async function removeLockIfOwned(lockPath: string, ownPid: number): Promise<void> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const lock = parseLockFile(raw);
    if (lock?.pid === ownPid) {
      await fs.unlink(lockPath);
    }
    // If another process has already taken the lock, leave it alone.
  } catch {
    // Best-effort — ignore errors.
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Acquire the single-instance lock.
 *
 * Returns a `release` function that should be called on clean shutdown
 * (removes the lock file if this process still owns it).
 *
 * @param lockPath Override the lock path (used in tests).
 */
export async function acquireInstanceLock(
  lockPath: string = DEFAULT_LOCK_PATH
): Promise<() => Promise<void>> {
  const ownPid = process.pid;

  // Read current lock.
  let currentLock: LockFile | null = null;
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    currentLock = parseLockFile(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Unexpected read error — treat as no lock.
    }
  }

  const decision = decideLockAction({ currentLock, ownPid, probe: probeProcess });

  if (decision.action === "kill-then-take") {
    await killAndWait(decision.pid);
  }

  await writeLock(lockPath, ownPid);

  return () => removeLockIfOwned(lockPath, ownPid);
}
