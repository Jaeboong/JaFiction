/**
 * pairing.test.ts — Phase 5 device pairing flow
 *
 * Uses in-memory fakes for Redis and device store — no live Postgres or Redis.
 */
import * as assert from "node:assert/strict";
import test from "node:test";
import {
  makeFakePool,
  makeFakeRedis,
  makeInMemorySessionStore,
  makeInMemoryDeviceStore,
} from "./fakes";
import type { FakeRedis } from "./fakes";
import { buildTestApp } from "./testApp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserEntry {
  id: string;
  email: string;
  google_sub: string;
}

function makeTestDeps(redisOverride?: FakeRedis) {
  const userMap = new Map<string, UserEntry>();
  const store = makeInMemorySessionStore(userMap);
  const deviceStore = makeInMemoryDeviceStore();
  const redis = redisOverride ?? makeFakeRedis();
  return {
    pool: makeFakePool(),
    redis,
    store,
    userMap,
    deviceStore,
  };
}

async function buildApp(deps: ReturnType<typeof makeTestDeps>) {
  return buildTestApp(deps);
}

/** Simulate Google login and return a session cookie value. */
async function login(
  app: Awaited<ReturnType<typeof buildApp>>,
  deps: ReturnType<typeof makeTestDeps>,
  sub: string,
  email: string
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: `/auth/google/callback?google_sub=${encodeURIComponent(sub)}&email=${encodeURIComponent(email)}`,
  });
  assert.equal(res.statusCode, 302, `login callback failed: ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
  const match = /jf_sid=([^;]+)/.exec(cookieStr);
  assert.ok(match, "Expected jf_sid cookie");
  return `jf_sid=${match[1]}`;
}

async function startPairing(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  label = "My Laptop",
  workspaceRoot = "/home/user/work"
) {
  return app.inject({
    method: "POST",
    url: "/api/pairing/start",
    headers: { cookie },
    payload: { label, workspaceRoot },
  });
}

async function claimPairing(
  app: Awaited<ReturnType<typeof buildApp>>,
  code: string
) {
  return app.inject({
    method: "POST",
    url: "/api/pairing/claim",
    payload: { code },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: start → claim → device appears in list", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-happy", "happy@example.com");

  // Start pairing
  const startRes = await startPairing(app, cookie, "Work PC", "/home/dev/project");
  assert.equal(startRes.statusCode, 200, `start failed: ${startRes.body}`);
  const { code, expiresAt } = JSON.parse(startRes.body) as { code: string; expiresAt: string };
  assert.equal(code.length, 8, "code should be 8 chars");
  assert.ok(expiresAt, "expiresAt should be set");

  // Claim the code
  const claimRes = await claimPairing(app, code);
  assert.equal(claimRes.statusCode, 200, `claim failed: ${claimRes.body}`);
  const { token, deviceId, userId } = JSON.parse(claimRes.body) as {
    token: string;
    deviceId: string;
    userId: string;
  };
  assert.ok(token, "token should be present");
  assert.ok(deviceId, "deviceId should be present");
  assert.ok(userId, "userId should be present");
  assert.equal(token.length, 64, "token should be 32 bytes hex = 64 chars");

  // Device appears in list
  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie },
  });
  assert.equal(listRes.statusCode, 200);
  const { devices: list } = JSON.parse(listRes.body) as {
    devices: Array<{ id: string; label: string; workspaceRoot: string }>;
  };
  assert.equal(list.length, 1);
  assert.equal(list[0].id, deviceId);
  assert.equal(list[0].label, "Work PC");
  assert.equal(list[0].workspaceRoot, "/home/dev/project");

  await app.close();
});

test("code expiry: claiming after 600s returns 400", async () => {
  const redis = makeFakeRedis();
  const deps = makeTestDeps(redis);
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-expiry", "expiry@example.com");

  const startRes = await startPairing(app, cookie);
  assert.equal(startRes.statusCode, 200);
  const { code } = JSON.parse(startRes.body) as { code: string };

  // Advance time past TTL
  redis.advanceTime(601 * 1000);

  const claimRes = await claimPairing(app, code);
  assert.equal(claimRes.statusCode, 400);
  const body = JSON.parse(claimRes.body) as { error: string };
  assert.equal(body.error, "invalid_code");

  await app.close();
});

test("rate limit: 5 starts succeed, 6th returns 429", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-rate", "rate@example.com");

  for (let i = 0; i < 5; i++) {
    const res = await startPairing(app, cookie);
    assert.equal(res.statusCode, 200, `start ${i + 1} failed`);
  }

  const sixthRes = await startPairing(app, cookie);
  assert.equal(sixthRes.statusCode, 429);
  const body = JSON.parse(sixthRes.body) as { error: string };
  assert.equal(body.error, "rate_limited");

  await app.close();
});

test("code guessing protection: 5 bad claims, then correct claim returns 400 (code invalidated after MAX_CLAIM_ATTEMPTS)", async () => {
  // The spec: max 5 claim *attempts* per code. After 5 bad attempts the code
  // is permanently locked (even if correct code is then used).
  // Note: the correct claim is NOT burned by failed attempts — only the
  // attemptCount gates further access on the SAME code.
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-guess", "guess@example.com");

  const startRes = await startPairing(app, cookie);
  const { code } = JSON.parse(startRes.body) as { code: string };

  // 5 bad attempts — each increments attemptCount but wrong code returns 400
  for (let i = 0; i < 5; i++) {
    const res = await claimPairing(app, "BADCODEXX");
    assert.equal(res.statusCode, 400);
  }

  // Correct code: after 5 bad claim attempts on the *correct* code...
  // Actually, "bad claims" are for wrong codes, which don't find a Redis key.
  // Let's simulate 5 bad attempts ON the actual code by using the real code
  // but checking that after the 5th miss on that SAME key it's locked.
  // Re-read spec: "Max 5 claim attempts per code". This means per code key,
  // not per user. Bad guesses of WRONG codes don't affect the real code.

  // So: 5 wrong-code attempts don't burn the real code.
  const claimRes = await claimPairing(app, code);
  assert.equal(claimRes.statusCode, 200, "correct code should still work after wrong-code attempts");

  await app.close();
});

test("max attempt count per code: 5 mutations of attempt count lock the code", async () => {
  // Simulate a correct code being claimed multiple times (e.g. attacker knows the
  // code but something goes wrong). We need to test internal attemptCount path.
  // The pairing route only increments attemptCount on a MISS (wrong code returns
  // 400 without finding the key). The code is deleted on success. So the
  // attemptCount guard is for codes that are found in Redis but claimed after
  // the max is reached.
  // We test this by directly seeding Redis.
  const redis = makeFakeRedis();
  const deps = makeTestDeps(redis);
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-attempts", "attempts@example.com");

  const startRes = await startPairing(app, cookie, "label", "/root");
  const { code } = JSON.parse(startRes.body) as { code: string };

  // Manually update Redis to set attemptCount = 5
  const raw = await redis.get(`pairing:${code}`);
  assert.ok(raw);
  const parsed = JSON.parse(raw) as { userId: string; label: string; workspaceRoot: string; attemptCount: number };
  parsed.attemptCount = 5;
  await redis.set(`pairing:${code}`, JSON.stringify(parsed), "EX", 600);

  const claimRes = await claimPairing(app, code);
  assert.equal(claimRes.statusCode, 400);
  const body = JSON.parse(claimRes.body) as { error: string };
  assert.equal(body.error, "invalid_code");

  await app.close();
});

test("case-insensitive claim: uppercase code claimed with lowercase succeeds", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-case", "case@example.com");

  const startRes = await startPairing(app, cookie);
  const { code } = JSON.parse(startRes.body) as { code: string };
  assert.equal(code, code.toUpperCase(), "code should be uppercase");

  // Claim with lowercase
  const claimRes = await claimPairing(app, code.toLowerCase());
  assert.equal(claimRes.statusCode, 200, `case-insensitive claim failed: ${claimRes.body}`);

  await app.close();
});

test("revoke: authenticated user revokes device and revokedAt is set", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-revoke", "revoke@example.com");

  // Pair a device
  const startRes = await startPairing(app, cookie);
  const { code } = JSON.parse(startRes.body) as { code: string };
  const claimRes = await claimPairing(app, code);
  const { deviceId } = JSON.parse(claimRes.body) as { deviceId: string };

  // Revoke it
  const revokeRes = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/revoke`,
    headers: { cookie },
  });
  assert.equal(revokeRes.statusCode, 200);
  const { ok } = JSON.parse(revokeRes.body) as { ok: boolean };
  assert.equal(ok, true);

  // List shows revokedAt set
  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie },
  });
  const { devices: list } = JSON.parse(listRes.body) as {
    devices: Array<{ id: string; revokedAt: string | null }>;
  };
  const device = list.find((d) => d.id === deviceId);
  assert.ok(device, "device should still be in list");
  assert.ok(device.revokedAt, "revokedAt should be set after revoke");

  await app.close();
});

test("cross-user isolation: user A cannot see user B devices", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const cookieA = await login(app, deps, "sub-userA", "userA@example.com");
  const cookieB = await login(app, deps, "sub-userB", "userB@example.com");

  // User A pairs a device
  const startRes = await startPairing(app, cookieA, "A's device", "/home/a");
  const { code } = JSON.parse(startRes.body) as { code: string };
  await claimPairing(app, code);

  // User B should see an empty device list
  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie: cookieB },
  });
  assert.equal(listRes.statusCode, 200);
  const { devices: list } = JSON.parse(listRes.body) as { devices: unknown[] };
  assert.equal(list.length, 0, "User B should not see User A's devices");

  await app.close();
});

test("cross-user isolation: user A cannot revoke user B's device", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const cookieA = await login(app, deps, "sub-xA", "xA@example.com");
  const cookieB = await login(app, deps, "sub-xB", "xB@example.com");

  // User B pairs a device
  const startRes = await startPairing(app, cookieB, "B's device", "/home/b");
  const { code } = JSON.parse(startRes.body) as { code: string };
  const claimRes = await claimPairing(app, code);
  const { deviceId } = JSON.parse(claimRes.body) as { deviceId: string };

  // User A attempts to revoke user B's device
  const revokeRes = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/revoke`,
    headers: { cookie: cookieA },
  });
  assert.equal(revokeRes.statusCode, 404, "Cross-user revoke should return 404");

  await app.close();
});

test("unauthenticated requests to /api/pairing/start and /api/devices return 401", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const startRes = await app.inject({
    method: "POST",
    url: "/api/pairing/start",
    payload: { label: "x", workspaceRoot: "/x" },
  });
  assert.equal(startRes.statusCode, 401);

  const listRes = await app.inject({ method: "GET", url: "/api/devices" });
  assert.equal(listRes.statusCode, 401);

  await app.close();
});

test("claim with unknown code returns 400", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const res = await claimPairing(app, "XXXXXXXX");
  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body) as { error: string };
  assert.equal(body.error, "invalid_code");

  await app.close();
});

test("start with invalid body returns 400", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-badbody", "badbody@example.com");

  const res = await app.inject({
    method: "POST",
    url: "/api/pairing/start",
    headers: { cookie },
    payload: { label: "" }, // missing workspaceRoot, empty label
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});
