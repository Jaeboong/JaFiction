/**
 * fakeRunner.ts
 *
 * Shared test helper that attaches an in-memory "runner" to a DeviceHub and
 * answers incoming `rpc_request` frames using the real wire format helpers
 * from `@jasojeon/shared` (`wrapRpcResponse`, `wrapEvent`).
 *
 * Why this exists: before Phase 11.0 each test file inlined its own fake that
 * sent a bare `RpcResponse` (no `{type: "rpc_response"}` wrapper). That shape
 * was accidentally accepted by deviceHub's legacy fallback, masking the
 * Phase 10 schema-strict regression where the real runner's wrapper dispatch
 * broke. Routing every test through this helper keeps the runner's wire
 * format and the hub's dispatch contract locked together.
 */

import type WebSocket from "ws";
import {
  RpcRequestSchema,
  wrapEvent,
  wrapRpcResponse
} from "@jasojeon/shared";
import type {
  EventEnvelope,
  RpcRequest,
  RpcResponse
} from "@jasojeon/shared";
import type { DeviceHub } from "../../ws/deviceHub";
import { makeWsPair, type FakeWebSocket } from "../fakes";

export type FakeRunnerHandler = (
  req: RpcRequest
) => RpcResponse | Promise<RpcResponse>;

export interface FakeRunnerHandle {
  readonly client: FakeWebSocket;
  readonly server: FakeWebSocket;
  /** Push an event envelope from runner → hub using the real wrapper. */
  sendEvent(envelope: EventEnvelope): void;
  /**
   * Escape hatch for regression tests: send a bare (un-wrapped) RpcResponse.
   * Real runners never do this — it exists only to assert that the hub
   * rejects contract-violating frames.
   */
  sendBareRpcResponse(response: RpcResponse): void;
  close(): void;
}

export interface AttachFakeRunnerOptions {
  readonly hub: DeviceHub;
  readonly deviceId: string;
  readonly userIds: readonly string[];
  /**
   * If provided, every valid `rpc_request` frame is passed to this handler
   * and its return value is wrapped and sent back. If omitted, requests are
   * ignored (useful for tests that only care about routing / timeouts).
   */
  readonly handler?: FakeRunnerHandler;
}

export function attachFakeRunner(opts: AttachFakeRunnerOptions): FakeRunnerHandle {
  const { client, server } = makeWsPair();
  opts.hub.attach(opts.deviceId, opts.userIds, server as unknown as WebSocket);

  client.on("message", (data: Buffer) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (frame["type"] !== "rpc_request") return;
    if (!opts.handler) return;

    const { type: _t, ...rest } = frame;
    const parsed = RpcRequestSchema.safeParse(rest);
    if (!parsed.success) return;

    Promise.resolve(opts.handler(parsed.data))
      .then((response) => {
        client.send(JSON.stringify(wrapRpcResponse(response)));
      })
      .catch(() => {
        // Swallow handler errors — tests that care about error paths should
        // return an error RpcResponse explicitly from the handler.
      });
  });

  return {
    client,
    server,
    sendEvent(envelope) {
      client.send(JSON.stringify(wrapEvent(envelope)));
    },
    sendBareRpcResponse(response) {
      client.send(JSON.stringify(response));
    },
    close() {
      client.close();
    }
  };
}
