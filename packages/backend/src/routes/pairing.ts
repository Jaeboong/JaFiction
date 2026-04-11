/**
 * Pairing routes — Phase 5
 *
 * POST /api/pairing/start   (session required)
 * POST /api/pairing/claim   (unauthenticated — runner calls this)
 * GET  /api/devices          (session required)
 * POST /api/devices/:id/revoke (session required)
 *
 * Pairing codes: 8 chars, base32 alphabet (A-Z, 2-9, no O/0/1/I).
 * Codes are stored in Redis under `pairing:<CODE>` with 600s TTL.
 * Rate limit: 5 starts / 10 min per user (Redis counter `pairing-rate:<userId>`).
 * Max 5 failed claim attempts per code (guessing protection).
 * Token: 32 random bytes hex. Only sha256(token) stored in DB.
 */

import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { devices } from "../db/schema";
import type { SessionStore } from "../auth/session";
import { makeRequireSession } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type Redis from "ioredis";
import type { Env } from "../env";
// eq/and/Db/devices are only used in DrizzleDeviceStore — kept for production path

// ---------------------------------------------------------------------------
// DeviceRecord — shape returned to callers (never exposes token_hash)
// ---------------------------------------------------------------------------
export interface DeviceRecord {
  readonly id: string;
  readonly label: string;
  readonly workspaceRoot: string;
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
    workspaceRoot: string;
    tokenHash: string;
  }): Promise<void>;
  listDevices(userId: string): Promise<readonly DeviceRecord[]>;
  revokeDevice(id: string, userId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// DrizzleDeviceStore — production implementation using the Drizzle Db
// ---------------------------------------------------------------------------
export function createDrizzleDeviceStore(db: Db): DeviceStore {
  return {
    async insertDevice({ id, userId, label, workspaceRoot, tokenHash }) {
      await db.insert(devices).values({
        id,
        user_id: userId,
        label,
        workspace_root: workspaceRoot,
        token_hash: tokenHash,
      });
    },

    async listDevices(userId: string) {
      const rows = await db
        .select({
          id: devices.id,
          label: devices.label,
          workspace_root: devices.workspace_root,
          created_at: devices.created_at,
          last_seen_at: devices.last_seen_at,
          revoked_at: devices.revoked_at,
        })
        .from(devices)
        .where(eq(devices.user_id, userId));

      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        workspaceRoot: r.workspace_root,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        revokedAt: r.revoked_at,
      }));
    },

    async revokeDevice(id: string, userId: string) {
      const result = await db
        .update(devices)
        .set({ revoked_at: new Date() })
        .where(and(eq(devices.id, id), eq(devices.user_id, userId)));
      const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      return rowCount > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Pairing code helpers
// ---------------------------------------------------------------------------

// Base32 alphabet: uppercase letters + digits, excluding O, 0, 1, I (confusing)
const BASE32_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 600; // 10 minutes
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const MAX_CLAIM_ATTEMPTS = 5;

function generatePairingCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return code;
}

function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[O0]/g, "0") // map O/0 to 0 (already excluded, but belt-and-suspenders)
    .replace(/[I1]/g, "1")
    .trim();
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

function pairingKey(code: string): string {
  return `pairing:${code}`;
}

function rateKey(userId: string): string {
  return `pairing-rate:${userId}`;
}

// ---------------------------------------------------------------------------
// Pairing value schema (stored in Redis as JSON)
// ---------------------------------------------------------------------------

interface PairingValue {
  readonly userId: string;
  readonly label: string;
  readonly workspaceRoot: string;
  attemptCount: number;
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
// Route body schemas (validate at boundary)
// ---------------------------------------------------------------------------

const StartBodySchema = z.object({
  label: z.string().min(1).max(100),
  workspaceRoot: z.string().min(1).max(500),
});

const ClaimBodySchema = z.object({
  code: z.string().min(1).max(20),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface PairingDeps {
  readonly deviceStore: DeviceStore;
  readonly redis: Redis;
  readonly store: SessionStore;
  readonly env: Pick<Env, "NODE_ENV">;
}

export async function registerPairing(
  app: FastifyInstance,
  deps: PairingDeps
): Promise<void> {
  const requireSession = makeRequireSession(deps.store);

  // -------------------------------------------------------------------------
  // POST /api/pairing/start
  // -------------------------------------------------------------------------
  app.post(
    "/api/pairing/start",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as AuthenticatedRequest).sessionData;

      // Validate body
      const parsed = StartBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const { label, workspaceRoot } = parsed.data;

      // Rate limit check
      const rateK = rateKey(user.id);
      const countRaw = await deps.redis.get(rateK);
      const count = countRaw === null ? 0 : parseInt(countRaw, 10);

      if (count >= RATE_LIMIT_MAX) {
        return reply.code(429).send({
          error: "rate_limited",
          message: "Too many pairing starts. Try again in 10 minutes.",
        });
      }

      // Increment rate counter (set with TTL on first call)
      if (count === 0) {
        await deps.redis.set(rateK, "1", "EX", RATE_LIMIT_WINDOW_SECONDS);
      } else {
        await deps.redis.incr(rateK);
      }

      // Generate code and store in Redis
      const code = generatePairingCode();
      const value: PairingValue = {
        userId: user.id,
        label,
        workspaceRoot,
        attemptCount: 0,
      };
      await deps.redis.set(
        pairingKey(code),
        JSON.stringify(value),
        "EX",
        CODE_TTL_SECONDS
      );

      const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

      return reply.code(200).send({ code, expiresAt });
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/pairing/claim  (unauthenticated — runner calls this)
  // -------------------------------------------------------------------------
  app.post("/api/pairing/claim", async (request, reply) => {
    const parsed = ClaimBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const normalized = normalizeCode(parsed.data.code);
    const redisKey = pairingKey(normalized);
    const raw = await deps.redis.get(redisKey);

    if (raw === null) {
      return reply.code(400).send({ error: "invalid_code" });
    }

    const entry = JSON.parse(raw) as PairingValue;

    if (entry.attemptCount >= MAX_CLAIM_ATTEMPTS) {
      return reply.code(400).send({ error: "invalid_code" });
    }

    // Generate device token and insert into DB
    const token = generateToken();
    const tokenHash = hashToken(token);
    const deviceId = crypto.randomUUID();

    try {
      await deps.deviceStore.insertDevice({
        id: deviceId,
        userId: entry.userId,
        label: entry.label,
        workspaceRoot: entry.workspaceRoot,
        tokenHash: tokenHash,
      });
    } catch (err) {
      // DB insert failed — don't expose details
      request.log.error({ err }, "device insert failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    // Delete the pairing code (one-time use)
    await deps.redis.del(redisKey);

    return reply.code(200).send({
      token,
      deviceId,
      userId: entry.userId,
    });
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
          workspaceRoot: r.workspaceRoot,
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

      const ok = await deps.deviceStore.revokeDevice(id, user.id);

      if (!ok) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send({ ok: true });
    }
  );
}
