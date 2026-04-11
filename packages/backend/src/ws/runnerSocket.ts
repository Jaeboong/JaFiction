/**
 * runnerSocket.ts
 *
 * Fastify WebSocket plugin — `GET /runner/ws`
 *
 * Protocol:
 *  1. Client (runner) connects.
 *  2. Client sends: { type: "auth", deviceToken: "..." }
 *  3. Backend hashes token, looks up devices table. On match: reply auth_ok + attach to hub.
 *  4. On failure: reply auth_err + close.
 *
 * @fastify/websocket exposes a SocketStream (Duplex) as the first argument.
 * The underlying WebSocket is at `connection.socket`.
 */

import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SocketStream } from "@fastify/websocket";
import { eq, and, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { device_users, devices } from "../db/schema";
import type { DeviceHub } from "./deviceHub";

// ---------------------------------------------------------------------------
// Db subset we need — abstracted for testability
// ---------------------------------------------------------------------------
export interface RunnerSocketDeviceStore {
  /** Look up a non-revoked device by token hash. Returns undefined if not found. */
  findByTokenHash(tokenHash: string): Promise<{ id: string; userIds: readonly string[] } | undefined>;
  /** Best-effort update — do not await in critical path. */
  touchLastSeen(deviceId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Production implementation using Drizzle
// ---------------------------------------------------------------------------
export function createDrizzleRunnerSocketDeviceStore(db: Db): RunnerSocketDeviceStore {
  return {
    async findByTokenHash(tokenHash: string) {
      const rows = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.token_hash, tokenHash), isNull(devices.revoked_at)))
        .limit(1);
      if (rows.length === 0) return undefined;
      const userRows = await db
        .select({ userId: device_users.user_id })
        .from(device_users)
        .where(eq(device_users.device_id, rows[0].id));
      return { id: rows[0].id, userIds: userRows.map((row) => row.userId) };
    },

    async touchLastSeen(deviceId: string) {
      await db
        .update(devices)
        .set({ last_seen_at: new Date() })
        .where(eq(devices.id, deviceId));
    }
  };
}

// ---------------------------------------------------------------------------
// Plugin deps
// ---------------------------------------------------------------------------
export interface RunnerSocketDeps {
  readonly deviceStore: RunnerSocketDeviceStore;
  readonly hub: DeviceHub;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export async function registerRunnerSocket(
  app: FastifyInstance,
  deps: RunnerSocketDeps
): Promise<void> {
  app.get("/runner/ws", { websocket: true }, (connection: SocketStream, _request) => {
    const ws = connection.socket;
    let authed = false;

    function send(frame: unknown): void {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        // best-effort
      }
    }

    ws.on("message", (raw) => {
      if (authed) {
        // After auth, runner sends rpc_response or event frames.
        // DeviceHub's message handler (attached on attach()) takes over.
        // Nothing to do here.
        return;
      }

      let frame: unknown;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        send({ type: "auth_err", reason: "invalid_json" });
        ws.close();
        return;
      }

      if (
        typeof frame !== "object" ||
        frame === null ||
        (frame as Record<string, unknown>)["type"] !== "auth"
      ) {
        send({ type: "auth_err", reason: "expected_auth_frame" });
        ws.close();
        return;
      }

      const deviceToken = (frame as Record<string, unknown>)["deviceToken"];
      if (typeof deviceToken !== "string" || deviceToken.length === 0) {
        send({ type: "auth_err", reason: "missing_device_token" });
        ws.close();
        return;
      }

      const tokenHash = crypto.createHash("sha256").update(deviceToken).digest("hex");

      deps.deviceStore.findByTokenHash(tokenHash).then((device) => {
        if (!device) {
          send({ type: "auth_err", reason: "invalid_or_revoked_token" });
          ws.close();
          return;
        }

        authed = true;

        // Best-effort last_seen_at update — do not block auth response.
        deps.deviceStore.touchLastSeen(device.id).catch(() => { /* ignored */ });

        // Attach underlying WebSocket to hub — hub takes over message handling.
        deps.hub.attach(device.id, device.userIds, ws);

        send({ type: "auth_ok" });
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "internal error";
        app.log.error({ err }, "[runnerSocket] auth db error");
        send({ type: "auth_err", reason: msg });
        ws.close();
      });
    });

    ws.on("error", (err) => {
      app.log.error({ err }, "[runnerSocket] socket error");
    });
  });
}
