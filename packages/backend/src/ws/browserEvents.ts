/**
 * browserEvents.ts
 *
 * Fastify WebSocket plugin — `GET /ws/events`
 *
 * Session-cookie-authenticated. On connect, subscribes to Redis channel
 * `user:{userId}:events` and forwards every published message to the browser
 * WebSocket as JSON.
 *
 * @fastify/websocket note: the preHandler hook runs BEFORE the WebSocket
 * upgrade, so `makeRequireSession` works here as a preHandler just like on
 * regular HTTP routes. The handler receives a SocketStream whose underlying
 * WebSocket is at `connection.socket`.
 */

import type { FastifyInstance } from "fastify";
import type { SocketStream } from "@fastify/websocket";
import type { SessionStore } from "../auth/session";
import { makeRequireSession, SESSION_COOKIE } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";

// ---------------------------------------------------------------------------
// Heartbeat constants
// ---------------------------------------------------------------------------
const WS_HEARTBEAT_INTERVAL_MS = 25_000;
const WS_HEARTBEAT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Minimal Redis subscribe surface
// ---------------------------------------------------------------------------
export interface SubscribeRedis {
  /** Subscribe to a channel. Each incoming message calls handler. */
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  /** Unsubscribe from a channel. */
  unsubscribe(channel: string, handler: (message: string) => void): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin deps
// ---------------------------------------------------------------------------
export interface BrowserEventsDeps {
  readonly store: SessionStore;
  readonly redis: SubscribeRedis;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export interface BrowserEventsOptions {
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export async function registerBrowserEvents(
  app: FastifyInstance,
  deps: BrowserEventsDeps,
  options: BrowserEventsOptions = {}
): Promise<void> {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? WS_HEARTBEAT_TIMEOUT_MS;

  const requireSession = makeRequireSession(deps.store);

  app.get(
    "/ws/events",
    // preHandler runs before the WS upgrade — session cookie is still in the HTTP request.
    { websocket: true, preHandler: requireSession },
    (connection: SocketStream, request) => {
      const ws = connection.socket;
      const { user } = (request as unknown as AuthenticatedRequest).sessionData;
      const channel = `user:${user.id}:events`;

      // -----------------------------------------------------------------------
      // Heartbeat — ping every interval, terminate if pong not received in time
      // -----------------------------------------------------------------------
      let lastPong = Date.now();

      ws.on("pong", () => {
        lastPong = Date.now();
      });

      const heartbeat = setInterval(() => {
        if (Date.now() - lastPong > heartbeatTimeoutMs) {
          app.log.warn({ userId: user.id }, "[browserEvents] dead socket detected — terminating");
          ws.terminate();
          return;
        }
        ws.ping();
      }, heartbeatIntervalMs);

      // -----------------------------------------------------------------------
      // Redis subscription
      // -----------------------------------------------------------------------
      function onMessage(message: string): void {
        try {
          ws.send(message);
        } catch {
          // best-effort — socket may have closed
        }
      }

      // Subscribe to this user's Redis event channel.
      deps.redis.subscribe(channel, onMessage).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "subscribe error";
        app.log.error({ err }, "[browserEvents] redis subscribe failed");
        ws.send(JSON.stringify({ type: "error", message: msg }));
        ws.close();
      });

      ws.on("close", () => {
        clearInterval(heartbeat);
        deps.redis.unsubscribe(channel, onMessage).catch(() => { /* best-effort */ });
      });

      ws.on("error", (err) => {
        app.log.error({ err }, "[browserEvents] socket error");
        clearInterval(heartbeat);
        deps.redis.unsubscribe(channel, onMessage).catch(() => { /* best-effort */ });
      });
    }
  );
}

// Re-export cookie name for tests
export { SESSION_COOKIE };
