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
  makeInMemorySessionStore,
  makeWsPair
} from "./fakes";
import type { UserRow } from "../auth/session";
import { SESSION_COOKIE } from "../auth/session";
import type { RpcResponse, RpcRequest } from "@jafiction/shared";
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

    // Attach a fake runner.
    const { client, server } = makeWsPair();
    hub.attach("dev-1", userId, server as unknown as import("ws").WebSocket);

    // Fake runner: respond automatically to any rpc_request.
    client.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame["type"] === "rpc_request") {
        const id = frame["id"] as string;
        const response: RpcResponse = { v: 1, id, ok: true, result: { status: "idle" } };
        client.send(JSON.stringify(response));
      }
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
      client.close();
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

    const { client, server } = makeWsPair();
    hub.attach("dev-1", userId, server as unknown as import("ws").WebSocket);

    client.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame["type"] === "rpc_request") {
        const id = frame["id"] as string;
        const response: RpcResponse = { v: 1, id, ok: false, error: { code: "not_found", message: "project missing" } };
        client.send(JSON.stringify(response));
      }
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
      client.close();
      await app.close();
    }
  });
});
