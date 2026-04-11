/**
 * pairingCountdown.test.ts — Phase 5
 *
 * Tests the countdown calculation logic in isolation (pure function, no hooks).
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure countdown logic (extracted from the hook for testability)
// ---------------------------------------------------------------------------
function computeSecondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

describe("computeSecondsLeft", () => {
  it("returns full TTL when now is exactly at start", () => {
    const now = 1000;
    const expiresAt = now + 600_000; // 600 seconds
    expect(computeSecondsLeft(expiresAt, now)).toBe(600);
  });

  it("returns 0 when code has expired", () => {
    const now = 2000;
    const expiresAt = now - 1000; // expired 1 second ago
    expect(computeSecondsLeft(expiresAt, now)).toBe(0);
  });

  it("never returns a negative value", () => {
    const now = 9999;
    const expiresAt = 0; // well in the past
    expect(computeSecondsLeft(expiresAt, now)).toBe(0);
  });

  it("returns 1 when exactly 1 ms remains", () => {
    const now = 1000;
    const expiresAt = now + 1; // 1 ms remaining
    expect(computeSecondsLeft(expiresAt, now)).toBe(1);
  });

  it("rounds up partial seconds (ceil)", () => {
    const now = 1000;
    const expiresAt = now + 1500; // 1.5 seconds remaining
    expect(computeSecondsLeft(expiresAt, now)).toBe(2);
  });

  it("returns 0 when expiresAt equals now", () => {
    const now = 5000;
    expect(computeSecondsLeft(now, now)).toBe(0);
  });
});
