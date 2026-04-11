/**
 * sessionRouting.test.ts
 *
 * Phase 9 regression guard for `user → device → ws` mapping.
 *
 * If anything breaks how RPC requests route to the correct user's device,
 * or how runner events fan out only to their owning user's browser channel,
 * this test should fail loudly.
 *
 * Scenario:
 *  - User A (userA-1) and user B (userB-1) each register one device.
 *  - Both devices attach to the hub through separate fake WS pairs.
 *  - POST /api/rpc as user A → A's device receives, B's device does NOT.
 *  - A's device emits an event → publishes to user:A:events, NOT user:B:events.
 *  - A browser subscribed to user B's channel does NOT see user A's event.
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
  makeWsPair,
} from "./fakes";
import type { UserRow } from "../auth/session";
import { SESSION_COOKIE } from "../auth/session";
import type { RpcResponse, EventEnvelope } from "@jasojeon/shared";

function makeUser(id: string): UserRow {
  return { id, email: `${id}@test.com`, google_sub: `sub-${id}` };
}

/** Device store that maps each user to a distinct device id. */
function makePerUserDeviceStore(map: Record<string, readonly string[]>): RpcDeviceStore {
  return {
    async listActiveDeviceIds(userId: string) {
      return map[userId] ?? [];
    },
  };
}

describe("session routing regression — user → device → ws", () => {
  it("RPC from user A reaches A's device only; events fan out to A's channel only", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });

    const userAId = "userA-1";
    const userBId = "userB-1";
    const userMap = new Map<string, UserRow>([
      [userAId, makeUser(userAId)],
      [userBId, makeUser(userBId)],
    ]);
    const store = makeInMemorySessionStore(userMap);

    const sessionA = await store.createSession(userAId);
    const sessionB = await store.createSession(userBId);

    // Two distinct device ids, one per user.
    const deviceStore = makePerUserDeviceStore({
      [userAId]: ["dev-A"],
      [userBId]: ["dev-B"],
    });

    // Attach both fake runners to the hub.
    const pairA = makeWsPair();
    const pairB = makeWsPair();
    hub.attach("dev-A", userAId, pairA.server as unknown as import("ws").WebSocket);
    hub.attach("dev-B", userBId, pairB.server as unknown as import("ws").WebSocket);

    // Record which device(s) actually received an rpc_request frame.
    const receivedAt: string[] = [];

    pairA.client.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame["type"] === "rpc_request") {
        receivedAt.push("dev-A");
        const id = frame["id"] as string;
        const response: RpcResponse = { v: 1, id, ok: true, result: { status: "idle" } };
        pairA.client.send(JSON.stringify(response));
      }
    });
    pairB.client.on("message", (data: Buffer) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (frame["type"] === "rpc_request") {
        receivedAt.push("dev-B");
        const id = frame["id"] as string;
        const response: RpcResponse = { v: 1, id, ok: true, result: { status: "idle" } };
        pairB.client.send(JSON.stringify(response));
      }
    });

    // Build the POST /api/rpc app.
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: "test-secret-32-chars-minimum-!!!" });
    await registerRpc(app, { store, hub, deviceStore });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as import("net").AddressInfo).port;

    // Subscribe fake browser handlers to both user channels to verify fan-out.
    const eventsForA: string[] = [];
    const eventsForB: string[] = [];
    await redis.subscribe(`user:${userAId}:events`, (msg) => { eventsForA.push(msg); });
    await redis.subscribe(`user:${userBId}:events`, (msg) => { eventsForB.push(msg); });

    try {
      // 1. Post RPC as user A.
      const res = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${sessionA.raw}`,
        },
        body: JSON.stringify({ v: 1, id: "req-A-1", op: "get_state", payload: {} }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as RpcResponse;
      assert.ok(body.ok, "user A RPC should succeed");

      // Regression guard: frame reached ONLY dev-A.
      assert.deepEqual(receivedAt, ["dev-A"], "rpc_request must route only to user A's device");

      // 2. Inject an event from device A → hub publishes to user:A:events only.
      const envelope: EventEnvelope = {
        v: 1,
        event: "run_event",
        payload: { runId: "run-1", event: { timestamp: new Date().toISOString(), type: "run-started" } },
      };
      // Runner-side sends as { type: "event", ...envelope } — deviceHub's message
      // handler validates the envelope (ignoring `type`) via EventEnvelopeSchema.
      pairA.client.send(JSON.stringify(envelope));

      // Synchronous in fake pub/sub: publish happens inside the message handler.
      // Give the event a microtask tick just in case the handler awaits anything.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));

      assert.equal(eventsForA.length, 1, "event should publish to user A's channel");
      assert.equal(eventsForB.length, 0, "event must NOT leak to user B's channel");

      // Also verify session B cannot access user A's device when it posts RPC.
      // Use a dedicated store for B that knows only dev-B, and ensure no cross-over.
      receivedAt.length = 0;
      const resB = await fetch(`http://127.0.0.1:${port}/api/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE}=${sessionB.raw}`,
        },
        body: JSON.stringify({ v: 1, id: "req-B-1", op: "get_state", payload: {} }),
      });
      assert.equal(resB.status, 200);
      // dev-B handler in this test doesn't respond, so the sendRpc will time out
      // — but for regression-routing purposes we only care that the frame landed
      // on dev-B and NOT on dev-A.
      assert.deepEqual(receivedAt, ["dev-B"], "user B RPC must only touch device B");
    } finally {
      pairA.client.close();
      pairB.client.close();
      await app.close();
    }
  });
});
