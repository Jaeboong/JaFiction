import * as crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import type { Env } from "../env";

export const SESSION_COOKIE = "jf_sid";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function hashRaw(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateRaw(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly cookie_hash: string;
  readonly expires_at: Date;
}

export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly google_sub: string;
}

export interface SessionWithUser {
  readonly session: SessionRow;
  readonly user: UserRow;
}

// ---------------------------------------------------------------------------
// Interfaces for injectable DB operations (used in tests)
// ---------------------------------------------------------------------------
export interface SessionStore {
  createSession(userId: string): Promise<{ raw: string }>;
  verifySession(raw: string): Promise<SessionWithUser | null>;
  destroySession(raw: string): Promise<void>;
}

export function createSessionStore(db: Db, env: Pick<Env, "NODE_ENV">): SessionStore {
  return {
    async createSession(userId: string) {
      const raw = generateRaw();
      const cookieHash = hashRaw(raw);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await db.insert(sessions).values({
        user_id: userId,
        cookie_hash: cookieHash,
        expires_at: expiresAt,
      });

      return { raw };
    },

    async verifySession(raw: string) {
      const cookieHash = hashRaw(raw);
      const now = new Date();

      const rows = await db
        .select({
          session: sessions,
          user: users,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.user_id, users.id))
        .where(
          and(
            eq(sessions.cookie_hash, cookieHash),
            gt(sessions.expires_at, now)
          )
        )
        .limit(1);

      if (rows.length === 0) return null;

      const row = rows[0];

      // Update last_seen_at
      await db
        .update(sessions)
        .set({ last_seen_at: now })
        .where(eq(sessions.cookie_hash, cookieHash));

      return {
        session: row.session as SessionRow,
        user: row.user as UserRow,
      };
    },

    async destroySession(raw: string) {
      const cookieHash = hashRaw(raw);
      await db.delete(sessions).where(eq(sessions.cookie_hash, cookieHash));
    },
  };
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
export function setSessionCookie(
  reply: FastifyReply,
  raw: string,
  env: Pick<Env, "NODE_ENV">
): void {
  reply.setCookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// requireSession hook
// ---------------------------------------------------------------------------
export interface AuthenticatedRequest extends FastifyRequest {
  sessionData: SessionWithUser;
}

export function makeRequireSession(store: SessionStore) {
  return async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const result = await store.verifySession(raw);
    if (!result) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    (request as AuthenticatedRequest).sessionData = result;
  };
}
