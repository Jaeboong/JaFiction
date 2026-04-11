/**
 * In-memory fakes for db, pool, redis, and session store.
 * These let tests run without a live Postgres or Redis.
 */
import type { Pool, PoolClient } from "pg";
import type Redis from "ioredis";
import type { SessionStore, SessionWithUser, UserRow } from "../auth/session";
import { generateRaw, hashRaw } from "../auth/session";

// ---------------------------------------------------------------------------
// FakePool — minimal Pool interface that just replies "ok" to SELECT 1
// ---------------------------------------------------------------------------
export function makeFakePool(opts: { failPing?: boolean } = {}): Pool {
  const fake = {
    connect: async () => {
      if (opts.failPing) throw new Error("pg connection refused");
      const client = {
        query: async () => ({ rows: [{ "?column?": 1 }] }),
        release: () => undefined,
      };
      return client as unknown as PoolClient;
    },
    end: async () => undefined,
  };
  return fake as unknown as Pool;
}

// ---------------------------------------------------------------------------
// FakeRedis — minimal Redis interface
// ---------------------------------------------------------------------------
export function makeFakeRedis(opts: { failPing?: boolean } = {}): Redis {
  const fake = {
    ping: async () => {
      if (opts.failPing) throw new Error("redis connection refused");
      return "PONG";
    },
    connect: async () => undefined,
    quit: async () => undefined,
    disconnect: () => undefined,
  };
  return fake as unknown as Redis;
}

// ---------------------------------------------------------------------------
// FakeDb — minimal drizzle-like Db (not used in tests; store is faked instead)
// ---------------------------------------------------------------------------
// We fake at the SessionStore level, so no FakeDb is needed.

// ---------------------------------------------------------------------------
// InMemorySessionStore
// ---------------------------------------------------------------------------
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly raw: string;
  readonly cookieHash: string;
  readonly expiresAt: Date;
}

export function makeInMemorySessionStore(
  userMap: Map<string, UserRow>
): SessionStore & { sessions: Map<string, SessionRecord> } {
  const sessionsByHash = new Map<string, SessionRecord>();

  return {
    sessions: sessionsByHash,

    async createSession(userId: string) {
      const raw = generateRaw();
      const cookieHash = hashRaw(raw);
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      sessionsByHash.set(cookieHash, {
        id: `sess-${Date.now()}`,
        userId,
        raw,
        cookieHash,
        expiresAt,
      });
      return { raw };
    },

    async verifySession(raw: string): Promise<SessionWithUser | null> {
      const cookieHash = hashRaw(raw);
      const record = sessionsByHash.get(cookieHash);
      if (!record || record.expiresAt < new Date()) return null;

      const user = userMap.get(record.userId);
      if (!user) return null;

      return {
        session: {
          id: record.id,
          user_id: record.userId,
          cookie_hash: record.cookieHash,
          expires_at: record.expiresAt,
        },
        user,
      };
    },

    async destroySession(raw: string): Promise<void> {
      const cookieHash = hashRaw(raw);
      sessionsByHash.delete(cookieHash);
    },
  };
}
