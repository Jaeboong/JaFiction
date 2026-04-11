/**
 * csp.test.ts
 *
 * Verifies Phase 9 strict CSP + security headers are applied to responses.
 */
import * as assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerStrictSecurityHeaders } from "../security/csp";

test("strict CSP — headers present on a minimal response", async () => {
  const app = Fastify({ logger: false });
  await registerStrictSecurityHeaders(app);
  app.get("/", async () => ({ ok: true }));

  const res = await app.inject({ method: "GET", url: "/" });

  const csp = res.headers["content-security-policy"];
  assert.ok(typeof csp === "string", "CSP header should be a string");
  const cspStr = csp as string;
  assert.ok(cspStr.includes("default-src 'none'"));
  assert.ok(cspStr.includes("script-src 'self'"));
  assert.ok(cspStr.includes("style-src 'self'"));
  assert.ok(cspStr.includes("img-src 'self' data:"));
  assert.ok(cspStr.includes("connect-src 'self'"));
  assert.ok(cspStr.includes("font-src 'self'"));
  assert.ok(cspStr.includes("frame-ancestors 'none'"));
  assert.ok(cspStr.includes("base-uri 'none'"));
  assert.ok(cspStr.includes("form-action 'self'"));

  assert.equal(res.headers["referrer-policy"], "no-referrer");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");

  await app.close();
});

test("strict CSP — JSON responses still round-trip payload", async () => {
  const app = Fastify({ logger: false });
  await registerStrictSecurityHeaders(app);
  app.get("/api/json", async () => ({ hello: "world", n: 1 }));

  const res = await app.inject({ method: "GET", url: "/api/json" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { hello: string; n: number };
  assert.equal(body.hello, "world");
  assert.equal(body.n, 1);

  // Headers should still be applied without breaking JSON.
  assert.ok(typeof res.headers["content-security-policy"] === "string");

  await app.close();
});
