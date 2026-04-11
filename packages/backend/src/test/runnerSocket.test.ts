/**
 * runnerSocket.test.ts
 *
 * Tests the /runner/ws WebSocket auth handshake.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { registerRunnerSocket } from "../ws/runnerSocket";
import type { RunnerSocketDeviceStore } from "../ws/runnerSocket";
import { createDeviceHub } from "../ws/deviceHub";
import { makeFakePubSubRedis } from "./fakes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface DeviceEntry {
  id: string;
  userIds: readonly string[];
  tokenHash: string;
  revoked: boolean;
  lastSeen: Date | null;
}

function makeInMemoryRunnerSocketStore(): RunnerSocketDeviceStore & {
  devices: Map<string, DeviceEntry>;
  insertDevice(id: string, userIds: readonly string[], token: string): void;
  revokeDevice(id: string): void;
} {
  const devices = new Map<string, DeviceEntry>();

  return {
    devices,

    insertDevice(id: string, userIds: readonly string[], token: string) {
      devices.set(id, { id, userIds, tokenHash: hashToken(token), revoked: false, lastSeen: null });
    },

    revokeDevice(id: string) {
      const d = devices.get(id);
      if (d) d.revoked = true;
    },

    async findByTokenHash(tokenHash: string) {
      for (const d of devices.values()) {
        if (d.tokenHash === tokenHash && !d.revoked) {
          return { id: d.id, userIds: d.userIds };
        }
      }
      return undefined;
    },

    async touchLastSeen(deviceId: string) {
      const d = devices.get(deviceId);
      if (d) d.lastSeen = new Date();
    }
  };
}

async function buildTestApp(deviceStore: RunnerSocketDeviceStore) {
  const redis = makeFakePubSubRedis();
  const hub = createDeviceHub({ redis });
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  await registerRunnerSocket(app, { deviceStore, hub });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as import("net").AddressInfo).port;
  return { app, hub, port };
}

// Helper to open a WS and exchange frames.
async function withWs(
  url: string,
  fn: (ws: import("ws").WebSocket) => Promise<void>
): Promise<void> {
  const { WebSocket } = await import("ws");
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  try {
    await fn(ws);
  } finally {
    ws.close();
  }
}

function nextMessage(ws: import("ws").WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(String(data)));
    ws.once("error", reject);
  });
}

function nextClose(ws: import("ws").WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runnerSocket — /runner/ws auth handshake", () => {
  it("bad auth token → auth_err + close", async () => {
    const store = makeInMemoryRunnerSocketStore();
    const { app, port } = await buildTestApp(store);
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      ws.send(JSON.stringify({ type: "auth", deviceToken: "bad-token" }));
      const msg = JSON.parse(await nextMessage(ws));
      assert.strictEqual(msg.type, "auth_err");
      assert.ok(typeof msg.reason === "string");
      await nextClose(ws);
    } finally {
      await app.close();
    }
  });

  it("revoked device → auth_err", async () => {
    const store = makeInMemoryRunnerSocketStore();
    store.insertDevice("dev-1", ["user-1"], "good-token");
    store.revokeDevice("dev-1");
    const { app, port } = await buildTestApp(store);
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      ws.send(JSON.stringify({ type: "auth", deviceToken: "good-token" }));
      const msg = JSON.parse(await nextMessage(ws));
      assert.strictEqual(msg.type, "auth_err");
      await nextClose(ws);
    } finally {
      await app.close();
    }
  });

  it("good auth → auth_ok + device attached to hub", async () => {
    const store = makeInMemoryRunnerSocketStore();
    store.insertDevice("dev-1", ["user-1", "user-2"], "valid-token");
    const { app, hub, port } = await buildTestApp(store);
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      ws.send(JSON.stringify({ type: "auth", deviceToken: "valid-token" }));
      const msg = JSON.parse(await nextMessage(ws));
      assert.strictEqual(msg.type, "auth_ok");
      assert.ok(hub.isConnected("dev-1"), "device should be in hub after auth");
      assert.deepStrictEqual(hub.getUserIdsForDevice("dev-1"), ["user-1", "user-2"]);

      ws.close();
      // Wait for the close to propagate.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assert.ok(!hub.isConnected("dev-1"), "device should be removed from hub on close");
    } finally {
      await app.close();
    }
  });

  it("good auth → last_seen_at updated (best-effort)", async () => {
    const store = makeInMemoryRunnerSocketStore();
    store.insertDevice("dev-1", ["user-1"], "valid-token");
    assert.strictEqual(store.devices.get("dev-1")?.lastSeen, null);
    const { app, port } = await buildTestApp(store);
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      ws.send(JSON.stringify({ type: "auth", deviceToken: "valid-token" }));
      await nextMessage(ws); // auth_ok
      // Give the best-effort update time to run.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assert.notStrictEqual(store.devices.get("dev-1")?.lastSeen, null);
      ws.close();
    } finally {
      await app.close();
    }
  });
});
