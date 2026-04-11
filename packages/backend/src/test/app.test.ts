import * as assert from "node:assert/strict";
import test from "node:test";
import {
  makeFakePool,
  makeFakeRedis,
  makeInMemorySessionStore,
} from "./fakes";
import { buildTestApp } from "./testApp";

test("/healthz returns ok:true when pg and redis are up", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { ok: boolean; pg: boolean; redis: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.pg, true);
  assert.equal(body.redis, true);

  await app.close();
});

test("/healthz returns ok:false when pg ping throws", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool({ failPing: true }),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body) as { ok: boolean; pg: boolean; redis: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.pg, false);
  assert.equal(body.redis, true);

  await app.close();
});

test("/healthz returns ok:false when redis ping throws", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis({ failPing: true }),
    store,
    userMap,
  });

  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body) as { ok: boolean; pg: boolean; redis: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.redis, false);

  await app.close();
});

test("/healthz returns ok:false when both pg and redis fail", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool({ failPing: true }),
    redis: makeFakeRedis({ failPing: true }),
    store,
    userMap,
  });

  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body) as { ok: boolean; pg: boolean; redis: boolean };
  assert.equal(body.ok, false);
  assert.equal(body.pg, false);
  assert.equal(body.redis, false);

  await app.close();
});
