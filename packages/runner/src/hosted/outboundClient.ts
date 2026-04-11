/**
 * Outbound WebSocket client for hosted mode.
 *
 * When JAFICTION_MODE=hosted the runner does NOT open an inbound HTTP/WS server.
 * Instead this module opens a single outbound WSS connection to the backend,
 * authenticates with a device token, and multiplexes RPC responses + event
 * pushes over that single channel.
 *
 * Connection path: `${backendUrl}/runner/ws`
 * NOTE: Phase 4 backend will define the exact path. The `/runner/ws` suffix
 * used here is a placeholder agreed between Phase 2 and Phase 4 authors.
 *
 * Transport wire format overview
 * ─────────────────────────────
 *  Client → Server (after auth):
 *    { type: "rpc_response",  id, v, ok, result? }   — response to an RPC request
 *    { type: "rpc_response",  id, v, ok, error? }    — error response to an RPC request
 *    { type: "event",         v, event, payload }     — pushed event envelope
 *    { type: "ping",          ts }                    — application-level heartbeat
 *
 *  Server → Client:
 *    { type: "auth_ok" }                              — auth accepted
 *    { type: "auth_err", reason? }                    — auth rejected
 *    { type: "rpc_request",   v, id, op, payload }    — incoming RPC call
 *    { type: "pong",          ts }                    — heartbeat reply
 */

import { WebSocket } from "ws";
import {
  EventEnvelope,
  EventEnvelopeSchema,
  RpcRequest,
  RpcRequestSchema,
  RpcResponse
} from "@jafiction/shared";
import type { RunnerContext } from "../runnerContext";

// ---------------------------------------------------------------------------
// Logger interface — mirrors what the runner needs without importing a lib.
// ---------------------------------------------------------------------------
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const noopLogger: Logger = {
  info: () => { /* noop */ },
  warn: () => { /* noop */ },
  error: () => { /* noop */ }
};

// ---------------------------------------------------------------------------
// Reconnect configuration (injectable so tests can compress time).
// ---------------------------------------------------------------------------
export interface ReconnectConfig {
  /** Initial delay in ms before the first reconnect attempt. Default: 1000 */
  initialDelayMs?: number;
  /** Maximum delay cap in ms. Default: 60_000 */
  maxDelayMs?: number;
  /** Maximum number of consecutive auth failures before giving up. Default: 3 */
  maxAuthFailures?: number;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------
export interface OutboundClientOptions {
  backendUrl: string;
  deviceToken: string;
  runnerContext: RunnerContext;
  /** Called for each incoming RPC request. If undefined, responds with not_wired. */
  onRpc?: (req: RpcRequest) => Promise<RpcResponse>;
  logger?: Logger;
  /** Reconnect tuning — primarily for tests. */
  reconnect?: ReconnectConfig;
  /**
   * Heartbeat configuration for tests — allows compressing the 30s/60s timings.
   * intervalMs: how often to send a ping (default 30_000).
   * timeoutMs: how long to wait for pong before closing (default 60_000).
   */
  heartbeat?: {
    intervalMs?: number;
    timeoutMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Public handle returned by startHostedOutboundClient
// ---------------------------------------------------------------------------
export interface OutboundClientHandle {
  close(): Promise<void>;
  isConnected(): boolean;
  sendEvent(envelope: EventEnvelope): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
export function startHostedOutboundClient(options: OutboundClientOptions): OutboundClientHandle {
  const log = options.logger ?? noopLogger;
  const reconnectCfg = options.reconnect ?? {};
  const initialDelayMs = Math.max(1, reconnectCfg.initialDelayMs ?? 1_000);
  const maxDelayMs = Math.max(initialDelayMs, reconnectCfg.maxDelayMs ?? 60_000);
  const maxAuthFailures = Math.max(1, reconnectCfg.maxAuthFailures ?? 3);
  const heartbeatIntervalMs = options.heartbeat?.intervalMs ?? 30_000;
  const heartbeatTimeoutMs = options.heartbeat?.timeoutMs ?? 60_000;

  // Mutable state managed by the loop.
  let ws: WebSocket | undefined;
  let connected = false;
  let closed = false;          // set by close() to signal permanent stop
  let authFailureCount = 0;
  let attemptCount = 0;
  let currentDelayMs = initialDelayMs;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveClose: (() => void) | undefined;
  const closePromise = new Promise<void>((resolve) => { resolveClose = resolve; });

  // Exponential backoff with jitter.
  function nextDelayMs(): number {
    const jitter = Math.random() * 0.3 * currentDelayMs;
    const delay = Math.min(currentDelayMs + jitter, maxDelayMs);
    currentDelayMs = Math.min(currentDelayMs * 2, maxDelayMs);
    return Math.round(delay);
  }

  function resetBackoff(): void {
    currentDelayMs = initialDelayMs;
  }

  function clearHeartbeat(): void {
    if (heartbeatInterval !== undefined) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = undefined;
    }
    if (heartbeatTimeout !== undefined) {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = undefined;
    }
  }

  function startHeartbeat(socket: WebSocket): void {
    clearHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        clearHeartbeat();
        return;
      }
      const ts = Date.now();
      socket.send(JSON.stringify({ type: "ping", ts }));
      // Expect a pong within heartbeatTimeoutMs.
      heartbeatTimeout = setTimeout(() => {
        log.warn("[outboundClient] heartbeat timeout — closing socket");
        socket.terminate();
      }, heartbeatTimeoutMs);
    }, heartbeatIntervalMs);
  }

  function send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }

  async function handleRpcRequest(socket: WebSocket, req: RpcRequest): Promise<void> {
    if (options.onRpc) {
      try {
        const response = await options.onRpc(req);
        send(socket, { type: "rpc_response", ...response });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("[outboundClient] onRpc threw", { op: req.op, message });
        const response: RpcResponse = {
          v: 1,
          id: req.id,
          ok: false,
          error: { code: "handler_error", message }
        };
        send(socket, { type: "rpc_response", ...response });
      }
    } else {
      // Phase 3 has not wired a dispatcher yet.
      const response: RpcResponse = {
        v: 1,
        id: req.id,
        ok: false,
        error: { code: "not_wired", message: "RPC dispatcher not yet installed" }
      };
      send(socket, { type: "rpc_response", ...response });
    }
  }

  function connect(): void {
    if (closed) {
      resolveClose?.();
      return;
    }

    attemptCount += 1;
    const wsUrl = `${options.backendUrl}/runner/ws`;
    log.info("[outboundClient] connecting", { url: wsUrl, attempt: attemptCount });

    const socket = new WebSocket(wsUrl);
    ws = socket;

    // Track whether we've completed auth handshake on this connection.
    let authed = false;

    socket.on("open", () => {
      log.info("[outboundClient] socket open — sending auth");
      // Do NOT log the token itself.
      send(socket, { type: "auth", deviceToken: options.deviceToken });
    });

    socket.on("message", (raw) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        log.warn("[outboundClient] received non-JSON frame");
        return;
      }

      if (typeof frame !== "object" || frame === null) {
        return;
      }

      const f = frame as Record<string, unknown>;

      if (!authed) {
        if (f["type"] === "auth_ok") {
          authed = true;
          connected = true;
          authFailureCount = 0;
          resetBackoff();
          log.info("[outboundClient] auth OK");
          startHeartbeat(socket);
        } else if (f["type"] === "auth_err") {
          authFailureCount += 1;
          const reason = typeof f["reason"] === "string" ? f["reason"] : "unknown";
          log.error("[outboundClient] auth failed", { reason, authFailureCount, maxAuthFailures });
          socket.close();
          if (authFailureCount >= maxAuthFailures) {
            log.error("[outboundClient] max auth failures reached — giving up");
            closed = true;
            connected = false;
            resolveClose?.();
          }
        }
        return;
      }

      // Authed message handling.
      if (f["type"] === "pong") {
        // Cancel the pending heartbeat timeout.
        if (heartbeatTimeout !== undefined) {
          clearTimeout(heartbeatTimeout);
          heartbeatTimeout = undefined;
        }
        return;
      }

      if (f["type"] === "rpc_request") {
        const parsed = RpcRequestSchema.safeParse(f["payload"] !== undefined
          ? { v: f["v"], id: f["id"], op: f["op"], payload: f["payload"] }
          : f);
        if (!parsed.success) {
          log.warn("[outboundClient] invalid rpc_request frame", { error: parsed.error.message });
          // Respond with a parse error if we can extract an id.
          const id = typeof f["id"] === "string" ? f["id"] : undefined;
          if (id) {
            const response: RpcResponse = {
              v: 1,
              id,
              ok: false,
              error: { code: "invalid_request", message: "RPC request failed schema validation" }
            };
            send(socket, { type: "rpc_response", ...response });
          }
          return;
        }
        void handleRpcRequest(socket, parsed.data);
        return;
      }

      log.warn("[outboundClient] unrecognised frame type", { type: f["type"] });
    });

    socket.on("close", (code, reason) => {
      clearHeartbeat();
      connected = false;
      ws = undefined;
      const reasonStr = reason.toString();
      log.info("[outboundClient] socket closed", { code, reason: reasonStr });

      if (closed) {
        resolveClose?.();
        return;
      }

      const delay = nextDelayMs();
      log.info("[outboundClient] reconnecting", { delayMs: delay, attempt: attemptCount });
      setTimeout(() => connect(), delay);
    });

    socket.on("error", (err) => {
      log.error("[outboundClient] socket error", { message: err.message });
      // The close event will fire next and handle reconnection.
    });
  }

  // Start the connection loop.
  connect();

  return {
    close(): Promise<void> {
      if (closed) {
        return closePromise;
      }
      closed = true;
      connected = false;
      clearHeartbeat();
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      } else {
        resolveClose?.();
      }
      return closePromise;
    },

    isConnected(): boolean {
      return connected;
    },

    sendEvent(envelope: EventEnvelope): void {
      // Validate the envelope before sending — fail loudly on malformed data.
      EventEnvelopeSchema.parse(envelope);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log.warn("[outboundClient] sendEvent called but socket is not open — event dropped", {
          event: envelope.event
        });
        return;
      }
      send(ws, { type: "event", ...envelope });
    }
  };
}
