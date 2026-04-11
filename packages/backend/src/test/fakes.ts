/**
 * In-memory fakes for db, pool, redis, and session store.
 * These let tests run without a live Postgres or Redis.
 */
import type { Pool, PoolClient } from "pg";
import type Redis from "ioredis";
import type { SessionStore, SessionWithUser, UserRow } from "../auth/session";
import { generateRaw, hashRaw } from "../auth/session";

// ---------------------------------------------------------------------------
// DeviceRow — mirrors the DB schema shape used in tests
// ---------------------------------------------------------------------------
export interface DeviceRow {
  readonly id: string;
  readonly user_id: string;
  readonly label: string;
  readonly workspace_root: string;
  readonly token_hash: string;
  revoked_at: Date | null;
  readonly created_at: Date;
  last_seen_at: Date | null;
}

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
// FakeRedis — minimal Redis interface with TTL and pairing support
// ---------------------------------------------------------------------------
export interface FakeRedis extends Redis {
  /** Advance the fake clock by `ms` milliseconds to simulate time passing. */
  advanceTime(ms: number): void;
}

export function makeFakeRedis(opts: { failPing?: boolean } = {}): FakeRedis {
  const store = new Map<string, string>();
  const expiry = new Map<string, number>(); // key -> absolute epoch ms
  let now = Date.now();

  function isExpired(key: string): boolean {
    const exp = expiry.get(key);
    return exp !== undefined && now >= exp;
  }

  function getIfLive(key: string): string | null {
    if (!store.has(key) || isExpired(key)) {
      store.delete(key);
      expiry.delete(key);
      return null;
    }
    return store.get(key) ?? null;
  }

  const fake: Partial<Redis> & { advanceTime(ms: number): void } = {
    ping: async () => {
      if (opts.failPing) throw new Error("redis connection refused");
      return "PONG";
    },
    connect: async () => undefined,
    quit: async () => "OK",
    disconnect: () => undefined,

    // set(key, value) or set(key, value, "EX", seconds)
    set: async (...args: unknown[]) => {
      const key = args[0] as string;
      const value = args[1] as string;
      store.set(key, value);
      // Check for EX option
      const exIdx = (args as string[]).indexOf("EX");
      if (exIdx !== -1 && args[exIdx + 1] !== undefined) {
        const seconds = Number(args[exIdx + 1]);
        expiry.set(key, now + seconds * 1000);
      }
      return "OK" as const;
    },

    get: async (key: unknown) => {
      return getIfLive(key as string);
    },

    del: async (...keys: unknown[]) => {
      let count = 0;
      for (const k of keys.flat()) {
        if (store.has(k as string)) {
          store.delete(k as string);
          expiry.delete(k as string);
          count++;
        }
      }
      return count;
    },

    incr: async (key: unknown) => {
      const k = key as string;
      const current = getIfLive(k);
      const next = current === null ? 1 : parseInt(current, 10) + 1;
      store.set(k, String(next));
      return next;
    },

    expire: async (key: unknown, seconds: unknown) => {
      const k = key as string;
      if (!store.has(k) || isExpired(k)) return 0;
      expiry.set(k, now + Number(seconds) * 1000);
      return 1;
    },

    advanceTime(ms: number): void {
      now += ms;
    },
  };

  return fake as unknown as FakeRedis;
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

// ---------------------------------------------------------------------------
// InMemoryDeviceStore — implements DeviceStore from routes/pairing.ts
// ---------------------------------------------------------------------------
import type { DeviceStore } from "../routes/pairing";

export function makeInMemoryDeviceStore(): DeviceStore & { rows: Map<string, DeviceRow> } {
  const rows = new Map<string, DeviceRow>();

  return {
    rows,

    async insertDevice({ id, userId, label, workspaceRoot, tokenHash }) {
      const row: DeviceRow = {
        id,
        user_id: userId,
        label,
        workspace_root: workspaceRoot,
        token_hash: tokenHash,
        revoked_at: null,
        created_at: new Date(),
        last_seen_at: null,
      };
      rows.set(row.id, row);
    },

    async listDevices(userId: string) {
      return [...rows.values()]
        .filter((r) => r.user_id === userId)
        .map((r) => ({
          id: r.id,
          label: r.label,
          workspaceRoot: r.workspace_root,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          revokedAt: r.revoked_at,
        }));
    },

    async revokeDevice(id: string, userId: string) {
      const row = rows.get(id);
      if (!row || row.user_id !== userId) return false;
      row.revoked_at = new Date();
      return true;
    },
  };
}
