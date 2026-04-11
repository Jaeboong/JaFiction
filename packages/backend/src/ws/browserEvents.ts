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
// Registration
// ---------------------------------------------------------------------------
export async function registerBrowserEvents(
  app: FastifyInstance,
  deps: BrowserEventsDeps
): Promise<void> {
  const requireSession = makeRequireSession(deps.store);

  app.get(
    "/ws/events",
    // preHandler runs before the WS upgrade — session cookie is still in the HTTP request.
    { websocket: true, preHandler: requireSession },
    (connection: SocketStream, request) => {
      const ws = connection.socket;
      const { user } = (request as unknown as AuthenticatedRequest).sessionData;
      const channel = `user:${user.id}:events`;

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
        deps.redis.unsubscribe(channel, onMessage).catch(() => { /* best-effort */ });
      });

      ws.on("error", (err) => {
        app.log.error({ err }, "[browserEvents] socket error");
        deps.redis.unsubscribe(channel, onMessage).catch(() => { /* best-effort */ });
      });
    }
  );
}

// Re-export cookie name for tests
export { SESSION_COOKIE };
