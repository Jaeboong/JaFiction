/**
 * deviceHub.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDeviceHub } from "../ws/deviceHub";
import { makeFakePubSubRedis, makeWsPair } from "./fakes";
import type { RpcResponse, EventEnvelope } from "@jasojeon/shared";
import { wrapEvent, wrapRpcResponse } from "@jasojeon/shared";

function makeHub() {
  const redis = makeFakePubSubRedis();
  const hub = createDeviceHub({ redis });
  return { hub, redis };
}

describe("DeviceHub", () => {
  // -------------------------------------------------------------------------
  // attach / isConnected
  // -------------------------------------------------------------------------
  it("reports connected after attach", () => {
    const { hub } = makeHub();
    const { server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);
    assert.ok(hub.isConnected("dev-1"));
    assert.ok(!hub.isConnected("dev-2"));
  });

  it("reports disconnected after detach", () => {
    const { hub } = makeHub();
    const { server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);
    hub.detach("dev-1");
    assert.ok(!hub.isConnected("dev-1"));
  });

  it("reports disconnected when ws closes", () => {
    const { hub } = makeHub();
    const { client, server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);
    client.close(); // triggers peer's close event
    assert.ok(!hub.isConnected("dev-1"));
  });

  it("getUserIdsForDevice returns undefined when not connected", () => {
    const { hub } = makeHub();
    assert.strictEqual(hub.getUserIdsForDevice("dev-999"), undefined);
  });

  it("getUserIdsForDevice returns user ids when connected", () => {
    const { hub } = makeHub();
    const { server } = makeWsPair();
    hub.attach("dev-1", ["user-42", "user-99"], server as unknown as import("ws").WebSocket);
    assert.deepStrictEqual(hub.getUserIdsForDevice("dev-1"), ["user-42", "user-99"]);
  });

  // -------------------------------------------------------------------------
  // sendRpc round-trip
  // -------------------------------------------------------------------------
  it("sendRpc resolves when runner sends matching response", async () => {
    const { hub } = makeHub();
    const { client, server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);

    const req = { v: 1 as const, id: "req-1", op: "get_state" as const, payload: {} };
    const rpcPromise = hub.sendRpc("dev-1", req, { timeoutMs: 2000 });

    // Simulate runner sending a response back on the server side (server.send -> client message).
    // Actually, hub attaches to `server`, so hub's message listener is on `server`.
    // The runner would send frames *to* the server via the client socket.
    // In our WsPair: client.send -> server receives message; server.send -> client receives message.
    // Hub attaches to `server`: hub listens on server's "message" events.
    // So to simulate runner sending data TO the hub, we use client.send(data) which
    // delivers as a message event on server (the hub side).
    const response: RpcResponse = { v: 1, id: "req-1", ok: true, result: { foo: "bar" } };
    client.send(JSON.stringify(wrapRpcResponse(response)));

    const result = await rpcPromise;
    assert.ok(result.ok);
    assert.deepStrictEqual((result as Extract<RpcResponse, { ok: true }>).result, { foo: "bar" });
  });

  it("sendRpc correlates by id — two concurrent requests in reverse order", async () => {
    const { hub } = makeHub();
    const { client, server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);

    const req1 = { v: 1 as const, id: "req-A", op: "get_state" as const, payload: {} };
    const req2 = { v: 1 as const, id: "req-B", op: "get_state" as const, payload: {} };

    const p1 = hub.sendRpc("dev-1", req1, { timeoutMs: 2000 });
    const p2 = hub.sendRpc("dev-1", req2, { timeoutMs: 2000 });

    // Send responses in reverse order.
    const resp2: RpcResponse = { v: 1, id: "req-B", ok: true, result: { x: 2 } };
    const resp1: RpcResponse = { v: 1, id: "req-A", ok: true, result: { x: 1 } };
    client.send(JSON.stringify(wrapRpcResponse(resp2)));
    client.send(JSON.stringify(wrapRpcResponse(resp1)));

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.ok(r1.ok);
    assert.ok(r2.ok);
    assert.deepStrictEqual((r1 as Extract<RpcResponse, { ok: true }>).result, { x: 1 });
    assert.deepStrictEqual((r2 as Extract<RpcResponse, { ok: true }>).result, { x: 2 });
  });

  it("sendRpc rejects pending when runner disconnects", async () => {
    const { hub } = makeHub();
    const { client, server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);

    const req = { v: 1 as const, id: "req-X", op: "get_state" as const, payload: {} };
    const rpcPromise = hub.sendRpc("dev-1", req, { timeoutMs: 5000 });

    // Simulate runner disconnecting (client close -> server gets close event).
    client.close();

    // The promise should resolve with an error response (reject via Error, not resolve).
    // DeviceHub rejectAll calls pending.reject(new Error("runner_disconnected")).
    // The returned promise from sendRpc wraps reject in a new Promise — it throws.
    // Actually looking at the implementation: rejectAll calls pending.reject(reason).
    // The new Promise in sendRpc has `reject` as the error handler.
    // So rpcPromise should be rejected.
    await assert.rejects(rpcPromise, /runner_disconnected/);
  });

  it("sendRpc resolves with timeout error after timeoutMs", async () => {
    const { hub } = makeHub();
    const { server } = makeWsPair();
    hub.attach("dev-1", ["user-1"], server as unknown as import("ws").WebSocket);

    const req = { v: 1 as const, id: "req-T", op: "get_state" as const, payload: {} };
    // Very short timeout.
    const result = await hub.sendRpc("dev-1", req, { timeoutMs: 5 });

    assert.ok(!result.ok);
    assert.strictEqual((result as Extract<RpcResponse, { ok: false }>).error.code, "timeout");
  });

  it("sendRpc returns device_offline when not connected", async () => {
    const { hub } = makeHub();
    const req = { v: 1 as const, id: "req-Z", op: "get_state" as const, payload: {} };
    const result = await hub.sendRpc("dev-999", req);
    assert.ok(!result.ok);
    assert.strictEqual((result as Extract<RpcResponse, { ok: false }>).error.code, "device_offline");
  });

  // -------------------------------------------------------------------------
  // handleRunnerEvent → Redis publish
  // -------------------------------------------------------------------------
  it("handleRunnerEvent publishes to each authorized user channel", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await redis.subscribe("user:user-1:events", (msg) => receivedA.push(msg));
    await redis.subscribe("user:user-2:events", (msg) => receivedB.push(msg));

    // handleRunnerEvent does not validate the envelope — it just publishes JSON.
    // The envelope was already validated by deviceHub.onMessage before arriving here.
    const envelope = {
      v: 1,
      event: "run_finished",
      payload: { runId: "run-99", status: "completed" }
    };
    hub.handleRunnerEvent(["user-1", "user-2"], envelope as unknown as EventEnvelope);

    // publish is synchronous in fake (delivers in same tick).
    assert.strictEqual(receivedA.length, 1);
    assert.strictEqual(receivedB.length, 1);
    assert.deepStrictEqual(JSON.parse(receivedA[0]), envelope);
    assert.deepStrictEqual(JSON.parse(receivedB[0]), envelope);
  });

  it("event frame from runner triggers handleRunnerEvent → Redis publish", async () => {
    const redis = makeFakePubSubRedis();
    const hub = createDeviceHub({ redis });
    const { client, server } = makeWsPair();
    hub.attach("dev-1", ["user-1", "user-2"], server as unknown as import("ws").WebSocket);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await redis.subscribe("user:user-1:events", (msg) => receivedA.push(msg));
    await redis.subscribe("user:user-2:events", (msg) => receivedB.push(msg));

    // Use a valid EventEnvelope that passes schema validation.
    const validRunEvent = {
      timestamp: new Date().toISOString(),
      type: "run-started" as const
    };
    const envelope: EventEnvelope = {
      v: 1,
      event: "run_event",
      payload: { runId: "run-1", event: validRunEvent as unknown as import("@jasojeon/shared").RunEvent }
    };
    client.send(JSON.stringify(wrapEvent(envelope)));

    assert.strictEqual(receivedA.length, 1);
    assert.strictEqual(receivedB.length, 1);
    const parsed = JSON.parse(receivedA[0]);
    assert.strictEqual(parsed.event, "run_event");
    assert.strictEqual(parsed.payload.runId, "run-1");
  });
});
