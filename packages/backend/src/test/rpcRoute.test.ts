/**
 * rpcRoute.test.ts
 *
 * Tests the POST /api/rpc endpoint.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { registerRpc } from "../routes/rpc";
import type { RpcDeviceStore } from "../routes/rpc";
import { createDeviceHub } from "../ws/deviceHub";
import {
  makeFakePubSubRedis,
  makeInMemorySessionStore
} from "./fakes";
import { attachFakeRunner } from "./helpers/fakeRunner";
import type { UserRow } from "../auth/session";
import { SESSION_COOKIE } from "../auth/session";
import type { RpcResponse } from "@jasojeon/shared";
import type { DeviceHub } from "../ws/deviceHub";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(id: string): UserRow {
  return { id, email: `${id}@test.com`, google_sub: `sub-${id}` };
}

function makeMemoryRpcDeviceStore(deviceIds: readonly string[]): RpcDeviceStore {
  return {
    async listActiveDeviceIds(_userId) {
      return deviceIds;
    }
  };
}

async function buildTestApp(
  store: ReturnType<typeof makeInMemorySessionStore>,
  hub: DeviceHub,
  deviceStore: RpcDeviceStore
) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie, { secret: "test-secret-32-chars-minimum-!!!" });
  await registerRpc(app, { store, hub, deviceStore });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as import("net").AddressInfo).port;
  return { app, port };
}

async function post(
  port: number,
  body: unknown,
  cookie?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/rpc", () => {
  it("no session → 401", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const userMap = new Map<string, UserRow>();
    const store = makeInMemorySessionStore(userMap);
    const { app, port } = await buildTestApp(store, hub, makeMemoryRpcDeviceStore([]));
    try {
      const { status } = await post(port, { v: 1, id: "x", op: "get_state", payload: {} });
      assert.strictEqual(status, 401);
    } finally {
      await app.close();
    }
  });

  it("session + no active device → device_offline envelope", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const userId = "user-rpc-1";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw } = await store.createSession(userId);
    // Device exists in store but is not connected.
    const { app, port } = await buildTestApp(store, hub, makeMemoryRpcDeviceStore(["dev-offline"]));
    try {
      const { status, body } = await post(
        port,
        { v: 1, id: "req-1", op: "get_state", payload: {} },
        `${SESSION_COOKIE}=${raw}`
      );
      assert.strictEqual(status, 200);
      const b = body as RpcResponse;
      assert.ok(!b.ok);
      assert.strictEqual((b as Extract<RpcResponse, { ok: false }>).error.code, "device_offline");
    } finally {
      await app.close();
    }
  });

  it("session + attached device → request reaches runner, response piped back", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const userId = "user-rpc-2";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw } = await store.createSession(userId);

    // Attach a fake runner that answers every request via the shared helper.
    const runner = attachFakeRunner({
      hub,
      deviceId: "dev-1",
      userId,
      handler: (req) => ({ v: 1, id: req.id, ok: true, result: { status: "idle" } })
    });

    const { app, port } = await buildTestApp(store, hub, makeMemoryRpcDeviceStore(["dev-1"]));
    try {
      const { status, body } = await post(
        port,
        { v: 1, id: "req-2", op: "get_state", payload: {} },
        `${SESSION_COOKIE}=${raw}`
      );
      assert.strictEqual(status, 200);
      const b = body as RpcResponse;
      assert.ok(b.ok);
      assert.deepStrictEqual((b as Extract<RpcResponse, { ok: true }>).result, { status: "idle" });
    } finally {
      runner.close();
      await app.close();
    }
  });

  it("fake runner sends error → error envelope returned (not HTTP error)", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const userId = "user-rpc-3";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw } = await store.createSession(userId);

    const runner = attachFakeRunner({
      hub,
      deviceId: "dev-1",
      userId,
      handler: (req) => ({
        v: 1,
        id: req.id,
        ok: false,
        error: { code: "not_found", message: "project missing" }
      })
    });

    const { app, port } = await buildTestApp(store, hub, makeMemoryRpcDeviceStore(["dev-1"]));
    try {
      const { status, body } = await post(
        port,
        { v: 1, id: "req-3", op: "get_state", payload: {} },
        `${SESSION_COOKIE}=${raw}`
      );
      // HTTP 200 — error is in the envelope, not the status code.
      assert.strictEqual(status, 200);
      const b = body as RpcResponse;
      assert.ok(!b.ok);
      assert.strictEqual((b as Extract<RpcResponse, { ok: false }>).error.code, "not_found");
    } finally {
      runner.close();
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// deviceHub wrapper-contract regression
//
// These assertions protect the `{type: "rpc_response"|"event", ...}` wire
// format that real runners use. They talk to hub.sendRpc directly (not
// through HTTP) so the 30s POST /api/rpc timeout doesn't stretch test time.
//
// If anyone either:
//   1. removes the type-dispatch branch from deviceHub.onMessage, or
//   2. forgets to wrap an outgoing frame in the runner,
// these tests must fail — that's the whole point of locking the contract.
// ---------------------------------------------------------------------------

describe("deviceHub wrapper contract", () => {
  it("wrapped rpc_response from runner correlates and resolves", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const runner = attachFakeRunner({
      hub,
      deviceId: "dev-wrap-ok",
      userId: "user-wrap",
      handler: (req) => ({ v: 1, id: req.id, ok: true, result: { hello: "world" } })
    });

    try {
      const result = await hub.sendRpc(
        "dev-wrap-ok",
        { v: 1, id: "req-wrap-1", op: "get_state", payload: {} },
        { timeoutMs: 500 }
      );
      assert.ok(result.ok, "wrapped rpc_response should correlate and resolve");
      assert.deepStrictEqual(
        (result as Extract<RpcResponse, { ok: true }>).result,
        { hello: "world" }
      );
    } finally {
      runner.close();
    }
  });

  it("bare (un-wrapped) rpc_response is dropped and sendRpc times out", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    // Attach a runner with NO handler — we'll inject a bare response manually.
    const runner = attachFakeRunner({
      hub,
      deviceId: "dev-wrap-bad",
      userId: "user-wrap"
    });

    try {
      const pending = hub.sendRpc(
        "dev-wrap-bad",
        { v: 1, id: "req-wrap-2", op: "get_state", payload: {} },
        { timeoutMs: 40 }
      );

      // Drive a schema-valid RpcResponse without the `{type: ...}` wrapper.
      // The hub must drop it because contract-violating frames are rejected.
      runner.sendBareRpcResponse({
        v: 1,
        id: "req-wrap-2",
        ok: true,
        result: { should: "be-dropped" }
      });

      const result = await pending;
      assert.ok(!result.ok, "bare rpc_response must not correlate");
      assert.strictEqual(
        (result as Extract<RpcResponse, { ok: false }>).error.code,
        "timeout"
      );
    } finally {
      runner.close();
    }
  });
});
