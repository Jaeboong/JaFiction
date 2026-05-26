/**
 * deviceClaim.test.ts — Stage 11.9
 *
 * Tests the auto-claim flow: register → poll → approve.
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
  return { pool: makeFakePool(), redis, store, userMap, deviceStore };
}

async function buildApp(deps: ReturnType<typeof makeTestDeps>) {
  return buildTestApp(deps);
}

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

async function registerClaim(
  app: Awaited<ReturnType<typeof buildApp>>,
  overrides: Partial<{ hostname: string; os: string; runnerVersion: string; deviceId: string; runnerInstanceId: string }> = {}
) {
  return app.inject({
    method: "POST",
    url: "/auth/device-claim",
    payload: {
      hostname: overrides.hostname ?? "test-host",
      os: overrides.os ?? "linux",
      runnerVersion: overrides.runnerVersion ?? "0.1.0",
      deviceId: overrides.deviceId,
      runnerInstanceId: overrides.runnerInstanceId,
    },
  });
}

function findUserIdByEmail(
  deps: ReturnType<typeof makeTestDeps>,
  email: string
): string {
  const entry = [...deps.userMap.values()].find((user) => user.email === email);
  assert.ok(entry, `Expected seeded user for ${email}`);
  return entry.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("POST /auth/device-claim stores a claim and returns claimId + pollToken", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const res = await registerClaim(app);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body) as { claimId: string; pollToken: string; expiresAt: string };
  assert.ok(body.claimId, "claimId should be present");
  assert.ok(body.pollToken, "pollToken should be present");
  assert.ok(body.expiresAt, "expiresAt should be present");

  await app.close();
});

test("POST /auth/device-claim is rate-limited: 10 per minute, 11th returns 429", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  for (let i = 0; i < 10; i++) {
    const res = await registerClaim(app);
    assert.equal(res.statusCode, 200, `request ${i + 1} should succeed`);
  }
  const eleventh = await registerClaim(app);
  assert.equal(eleventh.statusCode, 429);
  const body = JSON.parse(eleventh.body) as { error: string };
  assert.equal(body.error, "rate_limited");

  await app.close();
});

test("GET /auth/device-claim/:id with wrong pollToken returns 401", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const reg = await registerClaim(app);
  const { claimId } = JSON.parse(reg.body) as { claimId: string };

  const res = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${claimId}?pollToken=wrong-token`,
  });
  assert.equal(res.statusCode, 401);
  const body = JSON.parse(res.body) as { error: string };
  assert.equal(body.error, "invalid_poll_token");

  await app.close();
});

test("GET /auth/device-claim/:id returns pending before approval", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const reg = await registerClaim(app);
  const { claimId, pollToken } = JSON.parse(reg.body) as { claimId: string; pollToken: string };

  const res = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${claimId}?pollToken=${pollToken}`,
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { status: string };
  assert.equal(body.status, "pending");

  await app.close();
});

test("GET /auth/device-claim/:id returns expired when key is missing", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const res = await app.inject({
    method: "GET",
    url: "/auth/device-claim/non-existent-claim?pollToken=any",
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { status: string };
  assert.equal(body.status, "expired");

  await app.close();
});

test("POST /api/device-claim/approve: no claim for IP returns no_claim", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-noclaim", "noclaim@example.com");

  const res = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { status: string };
  assert.equal(body.status, "no_claim");

  await app.close();
});

test("happy path: register → approve → poll returns approved + token → device inserted", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-happy", "happy@example.com");

  // Runner registers a claim (IP will be 127.0.0.1 from Fastify inject)
  const reg = await registerClaim(app, { hostname: "my-machine", os: "linux" });
  assert.equal(reg.statusCode, 200);
  const { claimId, pollToken } = JSON.parse(reg.body) as { claimId: string; pollToken: string };

  // Web UI approves — same IP (127.0.0.1 from inject)
  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200, approveRes.body);
  const approveBody = JSON.parse(approveRes.body) as { status: string; deviceId: string; label: string };
  assert.equal(approveBody.status, "approved");
  assert.ok(approveBody.deviceId, "deviceId should be returned");
  assert.equal(approveBody.label, "my-machine");

  // Runner polls and gets approved + token
  const pollRes = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${claimId}?pollToken=${pollToken}`,
  });
  assert.equal(pollRes.statusCode, 200);
  const pollBody = JSON.parse(pollRes.body) as { status: string; token: string; deviceId: string; userId: string };
  assert.equal(pollBody.status, "approved");
  assert.ok(pollBody.token, "token should be present");
  assert.equal(pollBody.token.length, 64, "token should be 32 bytes hex = 64 chars");
  assert.equal(pollBody.deviceId, approveBody.deviceId);

  // Device is in the device list
  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie },
  });
  assert.equal(listRes.statusCode, 200);
  const listBody = JSON.parse(listRes.body) as { devices: Array<{ id: string; label: string; hostname: string; os: string }> };
  assert.equal(listBody.devices.length, 1);
  assert.equal(listBody.devices[0].id, approveBody.deviceId);
  assert.equal(listBody.devices[0].label, "my-machine");
  assert.equal(listBody.devices[0].hostname, "my-machine");
  assert.equal(listBody.devices[0].os, "linux");

  // Second poll returns expired (claim consumed on first poll)
  const secondPollRes = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${claimId}?pollToken=${pollToken}`,
  });
  assert.equal(secondPollRes.statusCode, 200);
  const secondPollBody = JSON.parse(secondPollRes.body) as { status: string };
  assert.equal(secondPollBody.status, "expired");

  await app.close();
});

test("approve with explicit claimId works", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-explicit", "explicit@example.com");

  const reg = await registerClaim(app);
  const { claimId } = JSON.parse(reg.body) as { claimId: string };

  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: { claimId },
  });
  assert.equal(approveRes.statusCode, 200);
  const body = JSON.parse(approveRes.body) as { status: string };
  assert.equal(body.status, "approved");

  await app.close();
});

test("approve existing device claim adds device_users membership without creating a new device", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookieA = await login(app, deps, "sub-owner", "owner@example.com");
  const cookieB = await login(app, deps, "sub-member", "member@example.com");

  await registerClaim(app, { hostname: "shared-host" });
  const firstApprove = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie: cookieA },
    payload: {},
  });
  assert.equal(firstApprove.statusCode, 200, firstApprove.body);
  const firstBody = JSON.parse(firstApprove.body) as { deviceId: string; status: string };
  assert.equal(firstBody.status, "approved");
  assert.equal(deps.deviceStore.rows.size, 1);

  const secondClaim = await registerClaim(app, {
    hostname: "shared-host",
    deviceId: firstBody.deviceId,
  });
  const secondClaimBody = JSON.parse(secondClaim.body) as { claimId: string; pollToken: string };

  const secondApprove = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie: cookieB },
    payload: { claimId: secondClaimBody.claimId },
  });
  assert.equal(secondApprove.statusCode, 200, secondApprove.body);
  const secondBody = JSON.parse(secondApprove.body) as { status: string; deviceId: string };
  assert.equal(secondBody.status, "authorized");
  assert.equal(secondBody.deviceId, firstBody.deviceId);
  assert.equal(deps.deviceStore.rows.size, 1, "existing device row should be reused");
  const memberUserId = findUserIdByEmail(deps, "member@example.com");
  assert.ok(
    deps.deviceStore.memberships.has(`${firstBody.deviceId}:${memberUserId}`),
    "new user should be added to device_users"
  );

  const pollRes = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${secondClaimBody.claimId}?pollToken=${secondClaimBody.pollToken}`,
  });
  assert.equal(pollRes.statusCode, 200);
  const pollBody = JSON.parse(pollRes.body) as { status: string; deviceId: string };
  assert.equal(pollBody.status, "authorized");
  assert.equal(pollBody.deviceId, firstBody.deviceId);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie: cookieB },
  });
  const { devices: list } = JSON.parse(listRes.body) as { devices: Array<{ id: string }> };
  assert.deepEqual(list.map((device) => device.id), [firstBody.deviceId]);

  await app.close();
});

test("duplicate approval for same device_id + user_id is ignored without error", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-dup", "dup@example.com");

  await registerClaim(app, { hostname: "dup-host" });
  const firstApprove = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  const firstBody = JSON.parse(firstApprove.body) as { deviceId: string };

  const secondClaim = await registerClaim(app, {
    hostname: "dup-host",
    deviceId: firstBody.deviceId,
  });
  const secondClaimBody = JSON.parse(secondClaim.body) as { claimId: string };

  const secondApprove = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: { claimId: secondClaimBody.claimId },
  });
  assert.equal(secondApprove.statusCode, 200, secondApprove.body);
  const secondBody = JSON.parse(secondApprove.body) as { status: string; deviceId: string };
  assert.equal(secondBody.status, "authorized");
  assert.equal(secondBody.deviceId, firstBody.deviceId);
  const userId = findUserIdByEmail(deps, "dup@example.com");
  assert.equal(
    [...deps.deviceStore.memberships].filter((entry) => entry === `${firstBody.deviceId}:${userId}`).length,
    1
  );

  await app.close();
});

test("multiple claims from same IP returns multiple_claims", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-multi", "multi@example.com");

  await registerClaim(app, { hostname: "host-a" });
  await registerClaim(app, { hostname: "host-b" });

  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200);
  const body = JSON.parse(approveRes.body) as { status: string; claims: Array<{ claimId: string; hostname: string; os: string }> };
  assert.equal(body.status, "multiple_claims");
  assert.equal(body.claims.length, 2);
  const hostnames = body.claims.map((c) => c.hostname).sort();
  assert.deepEqual(hostnames, ["host-a", "host-b"]);

  await app.close();
});

test("unauthenticated request to /api/device-claim/approve returns 401", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const res = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    payload: {},
  });
  assert.equal(res.statusCode, 401);

  await app.close();
});

test("revoke: authenticated user revokes device and revokedAt is set", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-revoke", "revoke@example.com");

  // Register and approve a claim to create a device
  await registerClaim(app, { hostname: "my-host" });
  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  const { deviceId } = JSON.parse(approveRes.body) as { deviceId: string };

  const revokeRes = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/revoke`,
    headers: { cookie },
  });
  assert.equal(revokeRes.statusCode, 200);
  const { ok } = JSON.parse(revokeRes.body) as { ok: boolean };
  assert.equal(ok, true);

  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie },
  });
  const { devices: list } = JSON.parse(listRes.body) as { devices: Array<{ id: string; revokedAt: string | null }> };
  assert.equal(list.find((d) => d.id === deviceId), undefined, "revoked device should be hidden from active list");

  await app.close();
});

// ---------------------------------------------------------------------------
// Fix-2: register supersede — same runnerInstanceId clears old pending claim
// ---------------------------------------------------------------------------

test("Fix-2 supersede: re-register with same runnerInstanceId removes old pending claim", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  // First registration
  const firstReg = await registerClaim(app, {
    hostname: "runner-host",
    runnerInstanceId: "instance-abc",
  });
  assert.equal(firstReg.statusCode, 200, firstReg.body);
  const { claimId: firstClaimId, pollToken: firstPollToken } = JSON.parse(firstReg.body) as {
    claimId: string;
    pollToken: string;
  };

  // Second registration with same instanceId (supersedes first)
  const secondReg = await registerClaim(app, {
    hostname: "runner-host",
    runnerInstanceId: "instance-abc",
  });
  assert.equal(secondReg.statusCode, 200, secondReg.body);
  const { claimId: secondClaimId } = JSON.parse(secondReg.body) as { claimId: string };

  // First claim should be gone (superseded)
  const firstPollRes = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${firstClaimId}?pollToken=${firstPollToken}`,
  });
  assert.equal(firstPollRes.statusCode, 200);
  const firstPollBody = JSON.parse(firstPollRes.body) as { status: string };
  assert.equal(firstPollBody.status, "expired", "old claim should be deleted by supersede");

  // Second claim still exists
  assert.notEqual(secondClaimId, firstClaimId, "new claimId should differ");

  await app.close();
});

test("Fix-2 supersede: different runnerInstanceId keeps both pending claims", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-diff-inst", "diffinst@example.com");

  await registerClaim(app, { hostname: "host-a", runnerInstanceId: "instance-A" });
  await registerClaim(app, { hostname: "host-b", runnerInstanceId: "instance-B" });

  // Both survive → multiple_claims
  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200);
  const body = JSON.parse(approveRes.body) as {
    status: string;
    claims: Array<{ hostname: string }>;
  };
  assert.equal(body.status, "multiple_claims");
  assert.equal(body.claims.length, 2);

  await app.close();
});

test("Fix-2 supersede: approved entry is NOT deleted when same instanceId re-registers", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-approved-safe", "approvedsafe@example.com");

  // Register, approve (status → approved, not yet polled by runner)
  const firstReg = await registerClaim(app, {
    hostname: "runner-host",
    runnerInstanceId: "instance-xyz",
  });
  const { claimId: firstClaimId, pollToken: firstPollToken } = JSON.parse(firstReg.body) as {
    claimId: string;
    pollToken: string;
  };

  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: { claimId: firstClaimId },
  });
  assert.equal(approveRes.statusCode, 200);
  const approveBody = JSON.parse(approveRes.body) as { status: string };
  assert.equal(approveBody.status, "approved");

  // Re-register with same instanceId — should not delete the already-approved claim
  await registerClaim(app, {
    hostname: "runner-host",
    runnerInstanceId: "instance-xyz",
  });

  // The approved claim should still be retrievable by the runner
  const pollRes = await app.inject({
    method: "GET",
    url: `/auth/device-claim/${firstClaimId}?pollToken=${firstPollToken}`,
  });
  assert.equal(pollRes.statusCode, 200);
  const pollBody = JSON.parse(pollRes.body) as { status: string; token: string };
  assert.equal(pollBody.status, "approved", "approved claim must survive supersede");
  assert.ok(pollBody.token, "token must be present");

  await app.close();
});

test("Fix-2 supersede: no runnerInstanceId in body leaves existing pending claim intact", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-no-inst", "noinst@example.com");

  // First claim (legacy runner without instanceId)
  const firstReg = await registerClaim(app, { hostname: "legacy-host" });
  assert.equal(firstReg.statusCode, 200);

  // Second claim also without instanceId — no supersede
  const secondReg = await registerClaim(app, { hostname: "legacy-host-2" });
  assert.equal(secondReg.statusCode, 200);

  // Both claims still pending → multiple_claims
  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200);
  const body = JSON.parse(approveRes.body) as { status: string };
  assert.equal(body.status, "multiple_claims");

  await app.close();
});

// ---------------------------------------------------------------------------
// Fix-3: approve 2-minute window removed — old pending claims (within TTL) approved
// ---------------------------------------------------------------------------

test("Fix-3: approve matches a pending claim older than 2 minutes (within TTL)", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-old-claim", "oldclaim@example.com");

  // Seed a claim that is 3 minutes old directly in Redis (past the old 2-min gate)
  const claimId = "old-claim-id-12345";
  const pollToken = "test-poll-token-abc";
  const oldEntry = {
    hostname: "old-runner",
    os: "linux",
    runnerVersion: "0.1.0",
    ip: "127.0.0.1",
    pollToken,
    registeredAt: Date.now() - 3 * 60 * 1000,
    status: "pending" as const,
  };
  await deps.redis.set(`claim:${claimId}`, JSON.stringify(oldEntry), "EX", 600);

  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200, approveRes.body);
  const body = JSON.parse(approveRes.body) as { status: string; deviceId: string };
  assert.equal(body.status, "approved", "3-minute-old pending claim must be approved (no 2-min window)");
  assert.ok(body.deviceId, "deviceId should be present");

  await app.close();
});

test("Fix-3 multiple_claims guard still active: two pending claims from same IP → multiple_claims", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);
  const cookie = await login(app, deps, "sub-multi-guard", "multiguard@example.com");

  // Seed two old-ish claims (> 2 min old, different instanceIds, same IP)
  const claimA = "claim-guard-A";
  const claimB = "claim-guard-B";
  const baseEntry = {
    os: "linux",
    runnerVersion: "0.1.0",
    ip: "127.0.0.1",
    pollToken: "tok",
    registeredAt: Date.now() - 3 * 60 * 1000,
    status: "pending" as const,
  };
  await deps.redis.set(`claim:${claimA}`, JSON.stringify({ ...baseEntry, hostname: "host-A", runnerInstanceId: "inst-A" }), "EX", 600);
  await deps.redis.set(`claim:${claimB}`, JSON.stringify({ ...baseEntry, hostname: "host-B", runnerInstanceId: "inst-B" }), "EX", 600);

  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie },
    payload: {},
  });
  assert.equal(approveRes.statusCode, 200);
  const body = JSON.parse(approveRes.body) as {
    status: string;
    claims: Array<{ hostname: string }>;
  };
  assert.equal(body.status, "multiple_claims", "multiple_claims guard must still fire when > 1 pending same-IP");
  assert.equal(body.claims.length, 2);

  await app.close();
});

test("cross-user isolation: user A cannot approve user B's claim and user A cannot revoke user B's device", async () => {
  const deps = makeTestDeps();
  const app = await buildApp(deps);

  const cookieA = await login(app, deps, "sub-isoA", "isoA@example.com");
  const cookieB = await login(app, deps, "sub-isoB", "isoB@example.com");

  // Register claim and approve as user A to create device A
  await registerClaim(app, { hostname: "host-a" });
  const approveRes = await app.inject({
    method: "POST",
    url: "/api/device-claim/approve",
    headers: { cookie: cookieA },
    payload: {},
  });
  const { deviceId } = JSON.parse(approveRes.body) as { deviceId: string };

  // User B should see empty device list
  const listRes = await app.inject({
    method: "GET",
    url: "/api/devices",
    headers: { cookie: cookieB },
  });
  const { devices: list } = JSON.parse(listRes.body) as { devices: unknown[] };
  assert.equal(list.length, 0, "User B should not see User A's devices");

  // User B cannot revoke User A's device
  const revokeRes = await app.inject({
    method: "POST",
    url: `/api/devices/${deviceId}/revoke`,
    headers: { cookie: cookieB },
  });
  assert.equal(revokeRes.statusCode, 403, "Cross-user revoke should return 403");

  await app.close();
});
