import * as assert from "node:assert/strict";
import test from "node:test";
import {
  makeFakePool,
  makeFakeRedis,
  makeInMemorySessionStore,
} from "./fakes";
import { buildTestApp } from "./testApp";

function makeTestDeps() {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  return {
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  };
}

test("GET /auth/google redirects to Google", async () => {
  const deps = makeTestDeps();
  const app = await buildTestApp(deps);

  const res = await app.inject({ method: "GET", url: "/auth/google" });
  assert.equal(res.statusCode, 302);
  assert.ok(
    res.headers["location"]?.includes("accounts.google.com"),
    "Should redirect to Google"
  );

  await app.close();
});

test("GET /auth/google/callback with missing params returns 400", async () => {
  const deps = makeTestDeps();
  const app = await buildTestApp(deps);

  const res = await app.inject({
    method: "GET",
    url: "/auth/google/callback",
  });
  assert.equal(res.statusCode, 400);

  await app.close();
});

test("Full login flow: callback sets cookie, /api/me returns user, logout clears session", async () => {
  const deps = makeTestDeps();
  const app = await buildTestApp(deps);

  // Step 1: Hit callback — simulates successful OAuth exchange
  const callbackRes = await app.inject({
    method: "GET",
    url: "/auth/google/callback?google_sub=sub-123&email=test%40example.com",
  });
  assert.equal(callbackRes.statusCode, 302, "Callback should redirect");

  // Extract the session cookie
  const setCookieHeader = callbackRes.headers["set-cookie"];
  assert.ok(setCookieHeader, "Should set a cookie");
  const cookieStr = Array.isArray(setCookieHeader)
    ? setCookieHeader.join("; ")
    : String(setCookieHeader);
  const jfSidMatch = /jf_sid=([^;]+)/.exec(cookieStr);
  assert.ok(jfSidMatch, "jf_sid cookie should be present");
  const sessionCookie = `jf_sid=${jfSidMatch[1]}`;

  // Step 2: /api/me with the session cookie returns user
  const meRes = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: sessionCookie },
  });
  assert.equal(meRes.statusCode, 200);
  const meBody = JSON.parse(meRes.body) as { user: { id: string; email: string } };
  assert.equal(meBody.user.email, "test@example.com");
  assert.ok(meBody.user.id, "User id should be present");

  // Step 3: Logout
  const logoutRes = await app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: { cookie: sessionCookie },
  });
  assert.equal(logoutRes.statusCode, 200);
  const logoutBody = JSON.parse(logoutRes.body) as { ok: boolean };
  assert.equal(logoutBody.ok, true);

  // Step 4: /api/me returns 401 after logout
  const meAfterLogout = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: sessionCookie },
  });
  assert.equal(meAfterLogout.statusCode, 401);

  await app.close();
});

test("Second login with same google_sub reuses existing user", async () => {
  const deps = makeTestDeps();
  const app = await buildTestApp(deps);

  // First login
  const res1 = await app.inject({
    method: "GET",
    url: "/auth/google/callback?google_sub=sub-reuse&email=reuse%40example.com",
  });
  const cookie1 = extractSessionCookie(res1.headers["set-cookie"]);

  // Second login
  const res2 = await app.inject({
    method: "GET",
    url: "/auth/google/callback?google_sub=sub-reuse&email=reuse%40example.com",
  });
  const cookie2 = extractSessionCookie(res2.headers["set-cookie"]);

  // Both sessions work
  const me1 = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: `jf_sid=${cookie1}` },
  });
  const me2 = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: `jf_sid=${cookie2}` },
  });

  const user1 = (JSON.parse(me1.body) as { user: { id: string } }).user;
  const user2 = (JSON.parse(me2.body) as { user: { id: string } }).user;

  assert.equal(user1.id, user2.id, "Same google_sub should map to same user");

  await app.close();
});

function extractSessionCookie(
  header: string | string[] | undefined
): string {
  const str = Array.isArray(header) ? header.join("; ") : String(header ?? "");
  const match = /jf_sid=([^;]+)/.exec(str);
  assert.ok(match, "Expected jf_sid cookie in response");
  return match[1];
}
