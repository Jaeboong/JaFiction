/**
 * Device routes — Stage 11.9
 *
 * POST /auth/device-claim         (unauthenticated — runner registers pending claim)
 * GET  /auth/device-claim/:id     (unauthenticated — runner polls for approval)
 * POST /api/device-claim/approve  (session required — web UI approves on Connect)
 * GET  /api/devices               (session required)
 * POST /api/devices/:id/revoke    (session required)
 *
 * Redis key layout:
 *   claim:<claimId>      — JSON ClaimEntry, TTL 600s
 *   claim-rate:<ip>      — rate limit counter, TTL 60s, max 10 per minute per IP
 */

import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { device_users, devices } from "../db/schema";
import type { SessionStore } from "../auth/session";
import { makeRequireSession } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type Redis from "ioredis";
import type { Env } from "../env";
import type { DeviceHub } from "../ws/deviceHub";

const CLAIM_TTL_SECONDS = 600;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;
// Cap long-poll response time. The backend returns pending if still waiting
// so the runner re-polls; avoids fighting Fastify's idle-timeout defaults.
const POLL_TICK_MS = 500;
const POLL_MAX_MS = 25_000;

// ---------------------------------------------------------------------------
// DeviceRecord — shape returned to callers (never exposes token_hash)
// ---------------------------------------------------------------------------
export interface DeviceRecord {
  readonly id: string;
  readonly label: string;
  readonly hostname: string | null;
  readonly os: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date | null;
  readonly revokedAt: Date | null;
}

// ---------------------------------------------------------------------------
// DeviceStore interface — abstracted so tests can inject fakes without Drizzle
// ---------------------------------------------------------------------------
export interface DeviceStore {
  insertDevice(opts: {
    id: string;
    userId: string;
    label: string;
    hostname?: string;
    os?: string;
    runnerVersion?: string;
    workspaceRoot?: string;
    tokenHash: string;
  }): Promise<void>;
  authorizeExistingDevice(deviceId: string, userId: string): Promise<boolean>;
  findDeviceIdByTokenHash(tokenHash: string): Promise<string | undefined>;
  listDevices(userId: string): Promise<readonly DeviceRecord[]>;
  revokeDevice(id: string, userId: string): Promise<"revoked" | "forbidden">;
}

// ---------------------------------------------------------------------------
// DrizzleDeviceStore — production implementation using the Drizzle Db
// ---------------------------------------------------------------------------
export function createDrizzleDeviceStore(db: Db): DeviceStore {
  return {
    async insertDevice({ id, userId, label, hostname, os, runnerVersion, workspaceRoot, tokenHash }) {
      await db.transaction(async (tx) => {
        await tx.insert(devices).values({
          id,
          label,
          hostname: hostname ?? null,
          os: os ?? null,
          runner_version: runnerVersion ?? null,
          workspace_root: workspaceRoot ?? null,
          token_hash: tokenHash,
        });
        await tx.insert(device_users).values({
          device_id: id,
          user_id: userId,
        });
      });
    },

    async authorizeExistingDevice(deviceId, userId) {
      const rows = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), isNull(devices.revoked_at)))
        .limit(1);
      if (rows.length === 0) return false;
      await db
        .insert(device_users)
        .values({
          device_id: deviceId,
          user_id: userId,
        })
        .onConflictDoNothing();
      return true;
    },

    async findDeviceIdByTokenHash(tokenHash) {
      const rows = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.token_hash, tokenHash), isNull(devices.revoked_at)))
        .limit(1);
      return rows[0]?.id;
    },

    async listDevices(userId: string) {
      const rows = await db
        .select({
          id: devices.id,
          label: devices.label,
          hostname: devices.hostname,
          os: devices.os,
          created_at: devices.created_at,
          last_seen_at: devices.last_seen_at,
          revoked_at: devices.revoked_at,
        })
        .from(devices)
        .innerJoin(device_users, eq(device_users.device_id, devices.id))
        .where(and(eq(device_users.user_id, userId), isNull(devices.revoked_at)));

      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        hostname: r.hostname,
        os: r.os,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        revokedAt: r.revoked_at,
      }));
    },

    async revokeDevice(id: string, userId: string) {
      const membership = await db
        .select({ deviceId: device_users.device_id })
        .from(device_users)
        .where(and(eq(device_users.device_id, id), eq(device_users.user_id, userId)))
        .limit(1);

      if (membership.length === 0) {
        return "forbidden";
      }

      await db
        .update(devices)
        .set({ revoked_at: new Date() })
        .where(eq(devices.id, id));
      return "revoked";
    },
  };
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// ClaimEntry — stored as JSON in Redis under claim:<claimId>
// ---------------------------------------------------------------------------

interface ClaimEntry {
  readonly hostname: string;
  readonly os: string;
  readonly runnerVersion: string;
  readonly workspaceRoot?: string;
  readonly ip: string;
  readonly pollToken: string;
  readonly registeredAt: number; // epoch ms
  status: "pending" | "approved" | "authorized" | "rejected";
  token?: string;
  deviceId?: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

const RegisterClaimBodySchema = z.object({
  hostname: z.string().min(1).max(200),
  os: z.string().min(1).max(200),
  runnerVersion: z.string().min(1).max(100),
  workspaceRoot: z.string().max(500).optional(),
  deviceId: z.string().uuid().optional(),
});

const ApproveClaimBodySchema = z.object({
  claimId: z.string().min(1).optional(),
});

const ResolveDeviceBodySchema = z.object({
  deviceToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

function claimKey(claimId: string): string {
  return `claim:${claimId}`;
}

function rateKey(ip: string): string {
  return `claim-rate:${ip}`;
}

// ---------------------------------------------------------------------------
// PairingDeps
// ---------------------------------------------------------------------------

export interface PairingDeps {
  readonly deviceStore: DeviceStore;
  readonly redis: Redis;
  readonly store: SessionStore;
  readonly env: Pick<Env, "NODE_ENV">;
  /** Optional — when provided, auto-connect already-connected runners to new sessions. */
  readonly hub?: DeviceHub;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerPairing(
  app: FastifyInstance,
  deps: PairingDeps
): Promise<void> {
  const requireSession = makeRequireSession(deps.store);

  // -------------------------------------------------------------------------
  // POST /auth/device-claim  (unauthenticated — runner registers a pending claim)
  // -------------------------------------------------------------------------
  app.post("/auth/device-claim", async (request, reply) => {
    const parsed = RegisterClaimBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    // Trust Fastify's request.ip which respects X-Forwarded-For when
    // trustProxy is enabled (set in prod behind nginx). In dev it's the
    // raw connecting address.
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";

    // Rate limit: max 10 per minute per IP
    const rateK = rateKey(ip);
    const countRaw = await deps.redis.get(rateK);
    const count = countRaw === null ? 0 : parseInt(countRaw, 10);

    if (count >= RATE_LIMIT_MAX) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    if (count === 0) {
      await deps.redis.set(rateK, "1", "EX", RATE_LIMIT_WINDOW_SECONDS);
    } else {
      await deps.redis.incr(rateK);
    }

    const claimId = crypto.randomUUID();
    const pollToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString();

    const entry: ClaimEntry = {
      hostname: parsed.data.hostname,
      os: parsed.data.os,
      runnerVersion: parsed.data.runnerVersion,
      workspaceRoot: parsed.data.workspaceRoot,
      deviceId: parsed.data.deviceId,
      ip,
      pollToken,
      registeredAt: Date.now(),
      status: "pending",
    };

    await deps.redis.set(claimKey(claimId), JSON.stringify(entry), "EX", CLAIM_TTL_SECONDS);

    return reply.code(200).send({ claimId, pollToken, expiresAt });
  });

  // -------------------------------------------------------------------------
  // GET /auth/device-claim/:claimId  (unauthenticated — runner polls for result)
  // -------------------------------------------------------------------------
  app.get("/auth/device-claim/:claimId", async (request, reply) => {
    const { claimId } = request.params as { claimId: string };
    const { pollToken } = request.query as { pollToken?: string };

    if (!pollToken) {
      return reply.code(400).send({ error: "missing_poll_token" });
    }

    // Long-poll: check periodically up to POLL_MAX_MS, then return pending.
    const deadline = Date.now() + POLL_MAX_MS;

    while (true) {
      const raw = await deps.redis.get(claimKey(claimId));

      if (raw === null) {
        return reply.code(200).send({ status: "expired" });
      }

      const entry = JSON.parse(raw) as ClaimEntry;

      if (entry.pollToken !== pollToken) {
        return reply.code(401).send({ error: "invalid_poll_token" });
      }

      if (entry.status === "approved") {
        // Consume the claim — delete the Redis key so second poll returns expired.
        await deps.redis.del(claimKey(claimId));
        return reply.code(200).send({
          status: "approved",
          token: entry.token,
          deviceId: entry.deviceId,
          userId: entry.userId,
        });
      }

      if (entry.status === "authorized") {
        await deps.redis.del(claimKey(claimId));
        return reply.code(200).send({
          status: "authorized",
          deviceId: entry.deviceId,
          userId: entry.userId,
        });
      }

      if (entry.status === "rejected") {
        return reply.code(200).send({ status: "rejected" });
      }

      // Still pending — wait a tick or return if deadline reached.
      if (Date.now() + POLL_TICK_MS > deadline) {
        return reply.code(200).send({ status: "pending" });
      }

      await new Promise<void>((resolve) => setTimeout(resolve, POLL_TICK_MS));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/device-claim/approve  (session required — web UI calls this)
  // -------------------------------------------------------------------------
  app.post(
    "/api/device-claim/approve",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as AuthenticatedRequest).sessionData;

      const parsed = ApproveClaimBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      const twoMinutesAgo = now - 2 * 60 * 1000;

      // If explicit claimId provided, look it up directly.
      if (parsed.data.claimId) {
        const raw = await deps.redis.get(claimKey(parsed.data.claimId));
        if (!raw) {
          return reply.code(200).send({ status: "no_claim" });
        }
        const entry = JSON.parse(raw) as ClaimEntry;
        if (entry.status !== "pending") {
          return reply.code(200).send({ status: "no_claim" });
        }
        return approveEntry(parsed.data.claimId, entry, user.id);
      }

      // Scan Redis for pending claims matching request.ip within the last 2 minutes.
      // We scan using a pattern. This works at test/dev scale; for prod scale
      // a secondary index would be better, but the claim volume is tiny.
      const keys = await scanClaimKeys(deps.redis);
      const matching: Array<{ claimId: string; entry: ClaimEntry }> = [];

      for (const key of keys) {
        const raw = await deps.redis.get(key);
        if (!raw) continue;
        const entry = JSON.parse(raw) as ClaimEntry;
        if (
          entry.status === "pending" &&
          entry.ip === ip &&
          entry.registeredAt >= twoMinutesAgo
        ) {
          const claimId = key.slice("claim:".length);
          matching.push({ claimId, entry });
        }
      }

      if (matching.length === 0) {
        // Fallback: if a runner is already connected via WebSocket (e.g. existing
        // device reconnected with stored token), auto-authorize the new session.
        // Gated to non-production to avoid unintended cross-user device sharing in prod.
        if (deps.hub && deps.env.NODE_ENV !== "production") {
          const connectedIds = deps.hub.getConnectedDeviceIds();
          if (connectedIds.length > 0) {
            const deviceId = connectedIds[0];
            try {
              const authorized = await deps.deviceStore.authorizeExistingDevice(deviceId, user.id);
              if (authorized) {
                request.log.info({ deviceId, userId: user.id }, "auto-connected new session to already-connected runner");
                return reply.code(200).send({ status: "authorized", deviceId });
              }
            } catch (err) {
              request.log.error({ err }, "auto-connect: authorizeExistingDevice failed");
            }
          }
        }
        return reply.code(200).send({ status: "no_claim" });
      }

      if (matching.length > 1) {
        return reply.code(200).send({
          status: "multiple_claims",
          claims: matching.map(({ claimId, entry }) => ({
            claimId,
            hostname: entry.hostname,
            os: entry.os,
          })),
        });
      }

      const { claimId, entry } = matching[0];
      return approveEntry(claimId, entry, user.id);

      async function approveEntry(
        id: string,
        entry: ClaimEntry,
        userId: string
      ) {
        if (entry.deviceId) {
          try {
            const authorized = await deps.deviceStore.authorizeExistingDevice(entry.deviceId, userId);
            if (!authorized) {
              request.log.error({ claimId: id, deviceId: entry.deviceId }, "existing device authorization failed");
              return reply.code(500).send({ error: "internal_error" });
            }
          } catch (err) {
            request.log.error({ err }, "device membership insert failed during auto-claim approval");
            return reply.code(500).send({ error: "internal_error" });
          }

          const updated: ClaimEntry = {
            ...entry,
            status: "authorized",
            deviceId: entry.deviceId,
            userId,
          };
          await deps.redis.set(claimKey(id), JSON.stringify(updated), "EX", CLAIM_TTL_SECONDS);

          return reply.code(200).send({ status: "authorized", deviceId: entry.deviceId });
        }

        const token = generateToken();
        const tokenHash = hashToken(token);
        const deviceId = crypto.randomUUID();
        const label = entry.hostname;

        try {
          await deps.deviceStore.insertDevice({
            id: deviceId,
            userId,
            label,
            hostname: entry.hostname,
            os: entry.os,
            runnerVersion: entry.runnerVersion,
            workspaceRoot: entry.workspaceRoot,
            tokenHash,
          });
        } catch (err) {
          request.log.error({ err }, "device insert failed during auto-claim approval");
          return reply.code(500).send({ error: "internal_error" });
        }

        // Update the Redis claim entry with approved status + token.
        // The runner's next poll will consume this and receive the token.
        const updated: ClaimEntry = { ...entry, status: "approved", token, deviceId, userId };
        await deps.redis.set(claimKey(id), JSON.stringify(updated), "EX", CLAIM_TTL_SECONDS);

        return reply.code(200).send({ status: "approved", deviceId, label });
      }
    }
  );

  app.post("/auth/device/resolve", async (request, reply) => {
    const parsed = ResolveDeviceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }

    const deviceId = await deps.deviceStore.findDeviceIdByTokenHash(
      hashToken(parsed.data.deviceToken)
    );

    if (!deviceId) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.code(200).send({ deviceId });
  });

  // -------------------------------------------------------------------------
  // GET /api/devices
  // -------------------------------------------------------------------------
  app.get(
    "/api/devices",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as AuthenticatedRequest).sessionData;

      const rows = await deps.deviceStore.listDevices(user.id);

      return reply.code(200).send({
        devices: rows.map((r) => ({
          id: r.id,
          label: r.label,
          hostname: r.hostname,
          os: r.os,
          createdAt: r.createdAt,
          lastSeenAt: r.lastSeenAt,
          revokedAt: r.revokedAt,
        })),
      });
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/devices/:id/revoke
  // -------------------------------------------------------------------------
  app.post(
    "/api/devices/:id/revoke",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as AuthenticatedRequest).sessionData;
      const { id } = request.params as { id: string };

      const result = await deps.deviceStore.revokeDevice(id, user.id);

      if (result === "forbidden") {
        return reply.code(403).send({ error: "forbidden" });
      }

      return reply.code(200).send({ ok: true });
    }
  );
}

// ---------------------------------------------------------------------------
// scanClaimKeys — SCAN Redis for all claim:<id> keys
// ---------------------------------------------------------------------------

async function scanClaimKeys(redis: Redis): Promise<readonly string[]> {
  const keys: string[] = [];
  // ioredis scan returns [cursor, keys]. We iterate until cursor is "0".
  let cursor = "0";
  do {
    const [nextCursor, batch] = await (redis as unknown as {
      scan(cursor: string, matchOption: string, pattern: string, countOption: string, count: number): Promise<[string, string[]]>;
    }).scan(cursor, "MATCH", "claim:*", "COUNT", 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
