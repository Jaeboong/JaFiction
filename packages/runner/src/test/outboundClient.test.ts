/**
 * outboundClient.test.ts
 *
 * Uses a local WebSocketServer as a fake backend to exercise all the
 * transport scenarios required by Phase 2.
 *
 * Heartbeat / reconnect timings are compressed via the options knobs so the
 * suite completes in seconds, not minutes.
 */

import * as assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocketServer, WebSocket } from "ws";
import type { EventEnvelope, RpcRequest, RpcResponse } from "@jafiction/shared";
import { EventEnvelopeSchema, RpcRequestSchema, RpcResponseSchema } from "@jafiction/shared";
import { startHostedOutboundClient } from "../hosted/outboundClient";
import type { RunnerContext } from "../runnerContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a local WS server and return its URL. */
async function startFakeBackend(): Promise<{ wss: WebSocketServer; url: string }> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const { port } = wss.address() as AddressInfo;
  return { wss, url: `ws://127.0.0.1:${port}` };
}

/**
 * Wait for the next client connection on the fake backend.
 * Returns the server-side socket AND a promise for the first message,
 * both registered atomically so no frames are missed.
 */
function nextConnectionWithFirstFrame(
  wss: WebSocketServer
): Promise<{ ws: WebSocket; firstFrame: Promise<Record<string, unknown>> }> {
  return new Promise((resolve) => {
    wss.once("connection", (ws) => {
      // Register the message listener immediately (no await gap).
      const firstFrame = new Promise<Record<string, unknown>>((msgResolve, msgReject) => {
        ws.once("message", (raw) => {
          try {
            msgResolve(JSON.parse(String(raw)) as Record<string, unknown>);
          } catch (err) {
            msgReject(err);
          }
        });
      });
      resolve({ ws, firstFrame });
    });
  });
}

/** Wait for the next client connection on the fake backend. */
function nextConnection(wss: WebSocketServer): Promise<WebSocket> {
  return nextConnectionWithFirstFrame(wss).then(({ ws }) => ws);
}

/** Collect the next text frame from a WebSocket as a parsed object. */
function nextFrame(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(String(raw)) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Minimal stub RunnerContext — only used as a pass-through in Phase 2. */
const stubCtx = {} as RunnerContext;

/** Compressed reconnect settings so tests don't wait for real backoff. */
const fastReconnect = { initialDelayMs: 10, maxDelayMs: 50, maxAuthFailures: 3 };

// ---------------------------------------------------------------------------
// 1. Happy path: client connects, auth handshake succeeds.
// ---------------------------------------------------------------------------
test("outboundClient: happy path — auth_ok makes isConnected() true", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-good",
    runnerContext: stubCtx,
    reconnect: fastReconnect
  });

  t.after(() => client.close());

  const { ws: serverWs, firstFrame: authFramePromise } = await nextConnectionWithFirstFrame(wss);
  const authFrame = await authFramePromise;

  assert.equal(authFrame["type"], "auth");
  assert.equal(authFrame["deviceToken"], "tok-good");

  serverWs.send(JSON.stringify({ type: "auth_ok" }));

  // Poll until connected (give it up to 1s).
  await waitFor(() => client.isConnected(), 1_000);
  assert.ok(client.isConnected());
});

// ---------------------------------------------------------------------------
// 2. Auth failure: 3 × auth_err → client gives up.
// ---------------------------------------------------------------------------
test("outboundClient: auth_err x3 → client gives up, isConnected() false", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-bad",
    runnerContext: stubCtx,
    reconnect: fastReconnect
  });

  // Reject three consecutive auth attempts.
  for (let i = 0; i < 3; i++) {
    const { ws: serverWs, firstFrame: authFramePromise } = await nextConnectionWithFirstFrame(wss);
    await authFramePromise; // discard auth frame
    serverWs.send(JSON.stringify({ type: "auth_err", reason: "invalid_token" }));
  }

  // Client should give up; close() resolves cleanly.
  await client.close();
  assert.ok(!client.isConnected());
});

// ---------------------------------------------------------------------------
// 3. Reconnect: server drops connection, comes back, client re-auths.
// ---------------------------------------------------------------------------
test("outboundClient: reconnects and re-auths after server drops connection", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-reconnect",
    runnerContext: stubCtx,
    reconnect: fastReconnect
  });
  t.after(() => client.close());

  // First connection — auth OK.
  // Use atomic connection+frame helper to avoid missing the auth frame.
  const { ws: first, firstFrame: firstAuthFramePromise } = await nextConnectionWithFirstFrame(wss);
  const firstAuthFrame = await firstAuthFramePromise;
  assert.equal(firstAuthFrame["type"], "auth");
  first.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);
  assert.ok(client.isConnected());

  // Register the listener for the second connection BEFORE terminating the first,
  // since reconnect (10ms backoff) can fire before the waitFor poll interval (20ms).
  // Also register the message listener atomically with the connection listener.
  const secondConnectionPromise = nextConnectionWithFirstFrame(wss);

  // Forcibly close the server-side socket.
  first.terminate();

  // Client disconnects momentarily.
  await waitFor(() => !client.isConnected(), 500);

  // Second connection — auth OK again.
  const { ws: second, firstFrame: secondAuthFramePromise } = await secondConnectionPromise;
  const secondAuthFrame = await secondAuthFramePromise;
  assert.equal(secondAuthFrame["type"], "auth");
  second.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);
  assert.ok(client.isConnected());
});

// ---------------------------------------------------------------------------
// 4. RPC echo (no handler) — server sends rpc_request → client responds not_wired.
// ---------------------------------------------------------------------------
test("outboundClient: rpc_request with no onRpc → not_wired response", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-rpc",
    runnerContext: stubCtx,
    reconnect: fastReconnect
    // onRpc: undefined (default)
  });
  t.after(() => client.close());

  const { ws: serverWs, firstFrame: authFramePromise4 } = await nextConnectionWithFirstFrame(wss);
  await authFramePromise4; // auth frame
  serverWs.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);

  // Send a valid RPC request.
  const rpcRequest = {
    type: "rpc_request",
    v: 1,
    id: "req-001",
    op: "get_state",
    payload: {}
  };
  serverWs.send(JSON.stringify(rpcRequest));

  const responseFrame = await nextFrame(serverWs);
  assert.equal(responseFrame["type"], "rpc_response");
  assert.equal(responseFrame["id"], "req-001");
  assert.equal(responseFrame["ok"], false);
  assert.equal((responseFrame["error"] as Record<string, string>)["code"], "not_wired");
});

// ---------------------------------------------------------------------------
// 5. RPC echo with handler — custom onRpc echoes back.
// ---------------------------------------------------------------------------
test("outboundClient: rpc_request with onRpc handler — response matches RpcResponseSchema", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-rpc-handler",
    runnerContext: stubCtx,
    reconnect: fastReconnect,
    onRpc: async (req: RpcRequest): Promise<RpcResponse> => {
      return { v: 1, id: req.id, ok: true, result: { echo: req.op } };
    }
  });
  t.after(() => client.close());

  const { ws: serverWs5, firstFrame: authFramePromise5 } = await nextConnectionWithFirstFrame(wss);
  await authFramePromise5; // auth frame
  serverWs5.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);

  const rpcRequest = {
    type: "rpc_request",
    v: 1,
    id: "req-002",
    op: "list_projects",
    payload: {}
  };
  serverWs5.send(JSON.stringify(rpcRequest));

  const responseFrame = await nextFrame(serverWs5);
  // Strip the "type" wrapper and validate against RpcResponseSchema.
  const { type: _type, ...rpcPart } = responseFrame;
  const parsed = RpcResponseSchema.safeParse(rpcPart);
  assert.ok(parsed.success, `RpcResponseSchema validation failed: ${!parsed.success ? parsed.error.message : ""}`);
  assert.equal(parsed.data.ok, true);
  if (parsed.data.ok) {
    assert.equal(parsed.data.result["echo"], "list_projects");
  }
});

// ---------------------------------------------------------------------------
// 6. Event send — sendEvent pushes a valid EventEnvelope to the server.
// ---------------------------------------------------------------------------
test("outboundClient: sendEvent transmits a valid state_snapshot envelope", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-event",
    runnerContext: stubCtx,
    reconnect: fastReconnect
  });
  t.after(() => client.close());

  const { ws: serverWs6, firstFrame: authFramePromise6 } = await nextConnectionWithFirstFrame(wss);
  await authFramePromise6; // auth frame
  serverWs6.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);

  // Use run_finished which has a simple, self-contained payload.
  const envelope: EventEnvelope = {
    v: 1,
    event: "run_finished",
    payload: {
      runId: "run-abc",
      status: "completed"
    }
  };

  client.sendEvent(envelope);

  const received = await nextFrame(serverWs6);
  assert.equal(received["type"], "event");

  // Validate that the forwarded payload matches EventEnvelopeSchema.
  const { type: _type, ...envPart } = received;
  const parsed = EventEnvelopeSchema.safeParse(envPart);
  assert.ok(parsed.success, `EventEnvelopeSchema validation failed: ${!parsed.success ? parsed.error.message : ""}`);
  assert.equal(parsed.data.event, "run_finished");
});

// ---------------------------------------------------------------------------
// 7. Heartbeat timeout: server stops responding to pings → client closes.
// ---------------------------------------------------------------------------
test("outboundClient: heartbeat timeout closes the socket", async (t) => {
  const { wss, url } = await startFakeBackend();
  t.after(async () => { wss.close(); });

  // Very short heartbeat: ping every 50ms, timeout after 80ms.
  const client = startHostedOutboundClient({
    backendUrl: url,
    deviceToken: "tok-hb",
    runnerContext: stubCtx,
    reconnect: { initialDelayMs: 10, maxDelayMs: 50, maxAuthFailures: 3 },
    heartbeat: { intervalMs: 50, timeoutMs: 80 }
  });
  t.after(() => client.close());

  const { ws: serverWs7, firstFrame: authFramePromise7 } = await nextConnectionWithFirstFrame(wss);
  await authFramePromise7; // auth frame
  serverWs7.send(JSON.stringify({ type: "auth_ok" }));
  await waitFor(() => client.isConnected(), 1_000);

  // Do NOT respond to any pings — just drain them silently.
  serverWs7.on("message", () => { /* intentionally ignore pings */ });

  // After heartbeat interval + timeout the client should disconnect.
  // Give it 300ms total (50ms interval + 80ms timeout + buffer).
  await waitFor(() => !client.isConnected(), 300);
  assert.ok(!client.isConnected());
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
}
