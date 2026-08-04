/**
 * instanceLock.test.ts
 *
 * Tests the pure decision logic of the single-instance lock.
 * IO (read/write/kill) is dependency-injected — no real FS or subprocess calls.
 */
import * as assert from "node:assert/strict";
import test from "node:test";
import {
  decideLockAction,
  type LockFile,
  type LockDecision,
  type ProcessProbeResult,
} from "../hosted/instanceLock";

// Helper: build a probe that returns a fixed result for a given PID.
function makeProbe(
  responses: ReadonlyArray<{ pid: number; result: ProcessProbeResult }>
): (pid: number) => ProcessProbeResult {
  return (pid: number) => {
    const entry = responses.find((r) => r.pid === pid);
    return entry?.result ?? "dead";
  };
}

test("decideLockAction: no lock file → take-over", () => {
  const decision = decideLockAction({
    currentLock: null,
    ownPid: 100,
    probe: makeProbe([]),
  });
  assert.deepEqual(decision, { action: "take-over" } satisfies LockDecision);
});

test("decideLockAction: lock has own PID → take-over (no-op re-entry)", () => {
  const lock: LockFile = { pid: 100, startedAt: new Date().toISOString() };
  const decision = decideLockAction({
    currentLock: lock,
    ownPid: 100,
    probe: makeProbe([{ pid: 100, result: "jasojeon" }]),
  });
  assert.deepEqual(decision, { action: "take-over" } satisfies LockDecision);
});

test("decideLockAction: holder is dead → take-over", () => {
  const lock: LockFile = { pid: 999, startedAt: new Date().toISOString() };
  const decision = decideLockAction({
    currentLock: lock,
    ownPid: 100,
    probe: makeProbe([{ pid: 999, result: "dead" }]),
  });
  assert.deepEqual(decision, { action: "take-over" } satisfies LockDecision);
});

test("decideLockAction: holder is alive jasojeon-runner → kill-then-take", () => {
  const lock: LockFile = { pid: 42, startedAt: new Date().toISOString() };
  const decision = decideLockAction({
    currentLock: lock,
    ownPid: 100,
    probe: makeProbe([{ pid: 42, result: "jasojeon" }]),
  });
  assert.deepEqual(decision, { action: "kill-then-take", pid: 42 } satisfies LockDecision);
});

test("decideLockAction: holder is alive but not jasojeon-runner (PID reuse) → take-over only (no kill)", () => {
  const lock: LockFile = { pid: 55, startedAt: new Date().toISOString() };
  const decision = decideLockAction({
    currentLock: lock,
    ownPid: 100,
    probe: makeProbe([{ pid: 55, result: "other" }]),
  });
  // PID reuse: do NOT kill unrelated process, just inherit the lock.
  assert.deepEqual(decision, { action: "take-over" } satisfies LockDecision);
});

test("decideLockAction: EPERM probe (different user process) → take-over only", () => {
  const lock: LockFile = { pid: 77, startedAt: new Date().toISOString() };
  const decision = decideLockAction({
    currentLock: lock,
    ownPid: 100,
    probe: makeProbe([{ pid: 77, result: "eperm" }]),
  });
  // Cannot verify ownership, cannot kill → safe to just inherit lock.
  assert.deepEqual(decision, { action: "take-over" } satisfies LockDecision);
});
