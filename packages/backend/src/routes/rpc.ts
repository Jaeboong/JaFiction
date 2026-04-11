/**
 * rpc.ts
 *
 * POST /api/rpc — session required
 *
 * Accepts an RpcRequest envelope, finds the user's active connected device,
 * forwards the request to the runner via DeviceHub, and returns the response.
 *
 * Id pass-through design: the browser-supplied req.id is forwarded directly to
 * the runner's pending-RPC map keyed by that id. This is safe for MVP (single
 * device per user). Future concern: concurrent browser tabs with the same RPC
 * id could collide in the per-device map. Mitigate later by prefixing with a
 * backend-generated nonce and stripping it before returning to the browser.
 */

import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { RpcRequestSchema } from "@jasojeon/shared";
import type { RpcResponse } from "@jasojeon/shared";
import type { Db } from "../db/client";
import { device_users, devices } from "../db/schema";
import type { SessionStore } from "../auth/session";
import { makeRequireSession } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type { DeviceHub } from "../ws/deviceHub";

// ---------------------------------------------------------------------------
// Device query abstraction (injectable for tests)
// ---------------------------------------------------------------------------
export interface RpcDeviceStore {
  /** Return all non-revoked device ids for a user. */
  listActiveDeviceIds(userId: string): Promise<readonly string[]>;
}

export function createDrizzleRpcDeviceStore(db: Db): RpcDeviceStore {
  return {
    async listActiveDeviceIds(userId: string) {
      const rows = await db
        .select({ id: devices.id })
        .from(devices)
        .innerJoin(device_users, eq(device_users.device_id, devices.id))
        .where(and(eq(device_users.user_id, userId), isNull(devices.revoked_at)));
      return rows.map((r) => r.id);
    }
  };
}

// ---------------------------------------------------------------------------
// Plugin deps
// ---------------------------------------------------------------------------
export interface RpcDeps {
  readonly store: SessionStore;
  readonly hub: DeviceHub;
  readonly deviceStore: RpcDeviceStore;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export async function registerRpc(
  app: FastifyInstance,
  deps: RpcDeps
): Promise<void> {
  const requireSession = makeRequireSession(deps.store);

  app.post(
    "/api/rpc",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as unknown as AuthenticatedRequest).sessionData;

      // Validate request body.
      const parsed = RpcRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      const req = parsed.data;

      // Find first active + connected device for this user.
      const deviceIds = await deps.deviceStore.listActiveDeviceIds(user.id);
      const deviceId = deviceIds.find((id) => deps.hub.isConnected(id));

      if (!deviceId) {
        const response: RpcResponse = {
          v: 1,
          id: req.id,
          ok: false,
          error: { code: "device_offline", message: "No active runner is connected for your account." }
        };
        return reply.code(200).send(response);
      }

      // notion_connect triggers a local browser OAuth flow on the runner —
      // allow up to 5 minutes for the user to authorize in the browser.
      const timeoutMs = req.op === "notion_connect" ? 5 * 60 * 1_000 : undefined;

      // Forward to runner and pipe back the response envelope.
      const response = await deps.hub.sendRpc(deviceId, req, { timeoutMs });
      return reply.code(200).send(response);
    }
  );
}
