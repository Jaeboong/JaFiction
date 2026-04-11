/**
 * deviceHub.ts
 *
 * Tracks live outbound WebSocket connections from runners.
 * Keyed by deviceId → { ws, userIds, pending RPC map }.
 *
 * Responsibilities:
 *  - attach / detach runner connections
 *  - correlate RPC request/response by id
 *  - publish runner events to Redis for browser fan-out
 */

import * as crypto from "node:crypto";
import type WebSocket from "ws";
import { RpcResponseSchema, EventEnvelopeSchema } from "@jasojeon/shared";
import type { RpcRequest, RpcResponse, EventEnvelope } from "@jasojeon/shared";

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------
export interface DeviceHubLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const noopLogger: DeviceHubLogger = {
  info: () => { /* no-op */ },
  warn: () => { /* no-op */ },
  error: () => { /* no-op */ }
};

// ---------------------------------------------------------------------------
// Minimal Redis pub/sub surface we need
// ---------------------------------------------------------------------------
export interface PubSubRedis {
  publish(channel: string, message: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Pending RPC correlation entry
// ---------------------------------------------------------------------------
interface PendingRpc {
  readonly resolve: (response: RpcResponse) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Per-device connection entry
// ---------------------------------------------------------------------------
interface DeviceEntry {
  readonly ws: WebSocket;
  readonly userIds: readonly string[];
  readonly pending: Map<string, PendingRpc>;
}

// ---------------------------------------------------------------------------
// DeviceHub public interface
// ---------------------------------------------------------------------------
export interface DeviceHub {
  attach(deviceId: string, userIds: readonly string[], ws: WebSocket): void;
  detach(deviceId: string): void;
  isConnected(deviceId: string): boolean;
  getUserIdsForDevice(deviceId: string): readonly string[] | undefined;
  sendRpc(deviceId: string, req: RpcRequest, opts?: { timeoutMs?: number }): Promise<RpcResponse>;
  handleRunnerEvent(userIds: readonly string[], envelope: EventEnvelope): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createDeviceHub(deps: {
  readonly logger?: DeviceHubLogger;
  readonly redis: PubSubRedis;
}): DeviceHub {
  const log = deps.logger ?? noopLogger;
  const devices = new Map<string, DeviceEntry>();

  function rejectAll(entry: DeviceEntry, reason: Error): void {
    for (const [id, pending] of entry.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      entry.pending.delete(id);
    }
  }

  function onMessage(deviceId: string, entry: DeviceEntry, raw: Buffer | string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      log.warn("[deviceHub] non-JSON frame from runner", { deviceId });
      return;
    }

    // Runners wrap every outbound frame with a `type` discriminator
    // ({type: "rpc_response", ...} or {type: "event", ...}). Dispatch strictly
    // by that wrapper — bare frames are rejected so a regression in the
    // runner's wire format cannot silently slip past the hub (the Phase 10
    // schema-strict bug that this contract locks in).
    const typed = frame as { type?: unknown };
    const frameType = typeof typed.type === "string" ? typed.type : undefined;

    if (frameType === "rpc_response") {
      const { type: _t, ...rest } = typed as Record<string, unknown>;
      const rpcResult = RpcResponseSchema.safeParse(rest);
      if (rpcResult.success) {
        const response = rpcResult.data;
        const pending = entry.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          entry.pending.delete(response.id);
          pending.resolve(response);
        } else {
          log.warn("[deviceHub] received rpc_response for unknown id", { id: response.id, deviceId });
        }
        return;
      }
      log.warn("[deviceHub] rpc_response failed schema validation", { deviceId });
      return;
    }

    if (frameType === "event") {
      const { type: _t, ...rest } = typed as Record<string, unknown>;
      const evResult = EventEnvelopeSchema.safeParse(rest);
      if (evResult.success) {
        hub.handleRunnerEvent(entry.userIds, evResult.data);
        return;
      }
      log.warn("[deviceHub] event failed schema validation", { deviceId });
      return;
    }

    log.warn("[deviceHub] frame missing {type} wrapper — dropped", { deviceId, frameType });
  }

  const hub: DeviceHub = {
    attach(deviceId: string, userIds: readonly string[], ws: WebSocket): void {
      // Detach any stale connection under this deviceId.
      if (devices.has(deviceId)) {
        hub.detach(deviceId);
      }

      const entry: DeviceEntry = {
        ws,
        userIds: [...new Set(userIds)],
        pending: new Map()
      };
      devices.set(deviceId, entry);

      ws.on("message", (raw) => {
        onMessage(deviceId, entry, raw as Buffer | string);
      });

      ws.on("close", () => {
        if (devices.get(deviceId) === entry) {
          devices.delete(deviceId);
          rejectAll(entry, new Error("runner_disconnected"));
          log.info("[deviceHub] runner disconnected", { deviceId });
        }
      });

      ws.on("error", (err) => {
        log.error("[deviceHub] runner ws error", { deviceId, message: err.message });
      });

      log.info("[deviceHub] runner attached", { deviceId, userIds: entry.userIds });
    },

    detach(deviceId: string): void {
      const entry = devices.get(deviceId);
      if (!entry) return;
      devices.delete(deviceId);
      rejectAll(entry, new Error("runner_disconnected"));
      log.info("[deviceHub] runner detached", { deviceId });
    },

    isConnected(deviceId: string): boolean {
      return devices.has(deviceId);
    },

    getUserIdsForDevice(deviceId: string): readonly string[] | undefined {
      return devices.get(deviceId)?.userIds;
    },

    async sendRpc(
      deviceId: string,
      req: RpcRequest,
      opts?: { timeoutMs?: number }
    ): Promise<RpcResponse> {
      const entry = devices.get(deviceId);
      if (!entry) {
        return { v: 1, id: req.id, ok: false, error: { code: "device_offline", message: "Runner is not connected" } };
      }

      const timeoutMs = opts?.timeoutMs ?? 30_000;

      return new Promise<RpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          entry.pending.delete(req.id);
          resolve({ v: 1, id: req.id, ok: false, error: { code: "timeout", message: "Runner did not respond in time" } });
        }, timeoutMs);

        entry.pending.set(req.id, { resolve, reject, timer });

        try {
          entry.ws.send(JSON.stringify({ type: "rpc_request", ...req }));
        } catch (err) {
          clearTimeout(timer);
          entry.pending.delete(req.id);
          const message = err instanceof Error ? err.message : String(err);
          resolve({ v: 1, id: req.id, ok: false, error: { code: "send_failed", message } });
        }
      });
    },

    handleRunnerEvent(userIds: readonly string[], envelope: EventEnvelope): void {
      const message = JSON.stringify(envelope);
      for (const userId of new Set(userIds)) {
        const channel = `user:${userId}:events`;
        // Best-effort publish — do not block; log failures.
        deps.redis.publish(channel, message).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("[deviceHub] redis publish failed", { channel, message: msg });
        });
      }
    }
  };

  // Unique RPC id generator (separate from browser-supplied ids — see comment below).
  // Design choice: pass-through browser id. The browser-supplied `req.id` is forwarded
  // directly to the runner. This is safe for MVP (single device per user, no cross-tenant
  // id collisions). Future concern: if a user runs multiple browser tabs that both issue
  // RPC with the same id at the same time, the correlation map would collide. Mitigate in
  // a later phase by prefixing with a per-request backend nonce.
  void crypto; // referenced for documentation above; not used in passthrough path

  return hub;
}
