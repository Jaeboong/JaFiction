/**
 * deviceHub.ts
 *
 * Tracks live outbound WebSocket connections from runners.
 * Keyed by deviceId → { ws, userId, pending RPC map }.
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
  readonly userId: string;
  readonly pending: Map<string, PendingRpc>;
}

// ---------------------------------------------------------------------------
// DeviceHub public interface
// ---------------------------------------------------------------------------
export interface DeviceHub {
  attach(deviceId: string, userId: string, ws: WebSocket): void;
  detach(deviceId: string): void;
  isConnected(deviceId: string): boolean;
  getUserIdForDevice(deviceId: string): string | undefined;
  sendRpc(deviceId: string, req: RpcRequest, opts?: { timeoutMs?: number }): Promise<RpcResponse>;
  handleRunnerEvent(userId: string, envelope: EventEnvelope): void;
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

    // Try RpcResponse first
    const rpcResult = RpcResponseSchema.safeParse(frame);
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

    // Try EventEnvelope
    const evResult = EventEnvelopeSchema.safeParse(frame);
    if (evResult.success) {
      hub.handleRunnerEvent(entry.userId, evResult.data);
      return;
    }

    log.warn("[deviceHub] unrecognised frame from runner", { deviceId });
  }

  const hub: DeviceHub = {
    attach(deviceId: string, userId: string, ws: WebSocket): void {
      // Detach any stale connection under this deviceId.
      if (devices.has(deviceId)) {
        hub.detach(deviceId);
      }

      const entry: DeviceEntry = {
        ws,
        userId,
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

      log.info("[deviceHub] runner attached", { deviceId, userId });
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

    getUserIdForDevice(deviceId: string): string | undefined {
      return devices.get(deviceId)?.userId;
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

    handleRunnerEvent(userId: string, envelope: EventEnvelope): void {
      const channel = `user:${userId}:events`;
      const message = JSON.stringify(envelope);
      // Best-effort publish — do not block; log failures.
      deps.redis.publish(channel, message).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("[deviceHub] redis publish failed", { channel, message: msg });
      });
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
