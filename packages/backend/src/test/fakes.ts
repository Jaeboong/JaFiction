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
  readonly label: string;
  readonly hostname: string | null;
  readonly os: string | null;
  readonly runner_version: string | null;
  readonly workspace_root: string | null;
  readonly token_hash: string;
  revoked_at: Date | null;
  readonly created_at: Date;
  last_seen_at: Date | null;
}

function membershipKey(deviceId: string, userId: string): string {
  return `${deviceId}:${userId}`;
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

    // Minimal SCAN implementation: pattern matching with glob-style * only.
    // Cast as unknown to avoid ioredis overload signature mismatch in tests.
    scan: (async (cursor: unknown, _matchOpt: unknown, pattern: unknown, _countOpt: unknown, _count: unknown) => {
      const pat = String(pattern);
      const prefix = pat.endsWith("*") ? pat.slice(0, -1) : pat;
      const matched: string[] = [];
      for (const key of store.keys()) {
        if (!isExpired(key) && key.startsWith(prefix)) {
          matched.push(key);
        }
      }
      // Single-batch: always return cursor "0" (scan complete).
      return ["0", matched] as [string, string[]];
    }) as unknown as Redis["scan"],

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
// FakeRedis pub/sub extension
// ---------------------------------------------------------------------------

/**
 * FakePubSubRedis combines the base FakeRedis KV operations with
 * in-memory pub/sub for testing. It intentionally does NOT extend the
 * ioredis `Redis` type to avoid type conflicts with ioredis's complex
 * `subscribe` overload signatures.
 *
 * Cast to `Redis` where the full ioredis type is required (e.g. healthz check).
 */
export interface FakePubSubRedis {
  // KV operations from base FakeRedis
  ping(): Promise<string>;
  connect(): Promise<void>;
  quit(): Promise<string>;
  disconnect(): void;
  set(...args: unknown[]): Promise<"OK">;
  get(key: unknown): Promise<string | null>;
  del(...keys: unknown[]): Promise<number>;
  incr(key: unknown): Promise<number>;
  expire(key: unknown, seconds: unknown): Promise<number>;
  scan(cursor: unknown, matchOpt: unknown, pattern: unknown, countOpt: unknown, count: unknown): Promise<[string, string[]]>;
  advanceTime(ms: number): void;
  // Pub/sub
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string, handler: (message: string) => void): Promise<void>;
}

export function makeFakePubSubRedis(opts: { failPing?: boolean } = {}): FakePubSubRedis {
  const base = makeFakeRedis(opts);
  const channelHandlers = new Map<string, Set<(message: string) => void>>();

  return {
    ping: () => base.ping!() as Promise<string>,
    connect: () => base.connect!() as unknown as Promise<void>,
    quit: () => base.quit!() as unknown as Promise<string>,
    disconnect: () => base.disconnect!(),
    set: (...args: unknown[]) => (base as unknown as { set(...a: unknown[]): Promise<"OK"> }).set(...args),
    get: (key: unknown) => (base as unknown as { get(k: unknown): Promise<string | null> }).get(key),
    del: (...keys: unknown[]) => (base as unknown as { del(...k: unknown[]): Promise<number> }).del(...keys),
    incr: (key: unknown) => (base as unknown as { incr(k: unknown): Promise<number> }).incr(key),
    expire: (key: unknown, seconds: unknown) => (base as unknown as { expire(k: unknown, s: unknown): Promise<number> }).expire(key, seconds),
    scan: (cursor: unknown, matchOpt: unknown, pattern: unknown, countOpt: unknown, count: unknown) =>
      (base as unknown as { scan(c: unknown, m: unknown, p: unknown, co: unknown, cn: unknown): Promise<[string, string[]]> }).scan(cursor, matchOpt, pattern, countOpt, count),
    advanceTime: (ms: number) => base.advanceTime(ms),

    async publish(channel: string, message: string): Promise<number> {
      const handlers = channelHandlers.get(channel);
      if (!handlers || handlers.size === 0) return 0;
      let count = 0;
      for (const handler of handlers) {
        handler(message);
        count++;
      }
      return count;
    },

    async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
      const existing = channelHandlers.get(channel) ?? new Set();
      existing.add(handler);
      channelHandlers.set(channel, existing);
    },

    async unsubscribe(channel: string, handler: (message: string) => void): Promise<void> {
      const handlers = channelHandlers.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) channelHandlers.delete(channel);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// FakeWebSocket pair — in-memory WS-like duplex for deviceHub tests
// ---------------------------------------------------------------------------
import { EventEmitter } from "node:events";

export interface FakeWebSocket extends EventEmitter {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  /** Internal: inject a message frame as if received from the remote side. */
  _inject(data: string): void;
}

export const WS_OPEN = 1;
export const WS_CLOSED = 3;

/**
 * Create a connected pair of fake WebSocket objects.
 * Data sent on `client` appears as a message event on `server` and vice versa.
 */
export function makeWsPair(): { client: FakeWebSocket; server: FakeWebSocket } {
  class FakeWs extends EventEmitter implements FakeWebSocket {
    private _state: number = WS_OPEN;
    private _peer: FakeWs | undefined;

    get readyState(): number {
      return this._state;
    }

    _setPeer(peer: FakeWs): void {
      this._peer = peer;
    }

    send(data: string): void {
      if (this._state !== WS_OPEN) {
        throw new Error("WebSocket is not open");
      }
      // Deliver to peer's message listeners synchronously (test-friendly).
      this._peer?.emit("message", Buffer.from(data));
    }

    close(): void {
      if (this._state === WS_CLOSED) return;
      this._state = WS_CLOSED;
      this.emit("close", 1000, Buffer.from(""));
      this._peer?._handlePeerClose();
    }

    _handlePeerClose(): void {
      if (this._state === WS_CLOSED) return;
      this._state = WS_CLOSED;
      this.emit("close", 1000, Buffer.from(""));
    }

    _inject(data: string): void {
      this.emit("message", Buffer.from(data));
    }
  }

  const client = new FakeWs();
  const server = new FakeWs();
  client._setPeer(server);
  server._setPeer(client);

  return { client, server };
}

// ---------------------------------------------------------------------------
// InMemoryDeviceStore — implements DeviceStore from routes/pairing.ts
// ---------------------------------------------------------------------------
import type { DeviceStore } from "../routes/pairing";

export function makeInMemoryDeviceStore(): DeviceStore & {
  rows: Map<string, DeviceRow>;
  memberships: Set<string>;
} {
  const rows = new Map<string, DeviceRow>();
  const memberships = new Set<string>();

  return {
    rows,
    memberships,

    async insertDevice({ id, userId, label, hostname, os, runnerVersion, workspaceRoot, tokenHash }) {
      const row: DeviceRow = {
        id,
        label,
        hostname: hostname ?? null,
        os: os ?? null,
        runner_version: runnerVersion ?? null,
        workspace_root: workspaceRoot ?? null,
        token_hash: tokenHash,
        revoked_at: null,
        created_at: new Date(),
        last_seen_at: null,
      };
      rows.set(row.id, row);
      memberships.add(membershipKey(id, userId));
    },

    async authorizeExistingDevice(deviceId: string, userId: string) {
      const row = rows.get(deviceId);
      if (!row || row.revoked_at !== null) return false;
      memberships.add(membershipKey(deviceId, userId));
      return true;
    },

    async findDeviceIdByTokenHash(tokenHash: string) {
      for (const row of rows.values()) {
        if (row.token_hash === tokenHash && row.revoked_at === null) {
          return row.id;
        }
      }
      return undefined;
    },

    async listDevices(userId: string) {
      return [...rows.values()]
        .filter((r) => r.revoked_at === null && memberships.has(membershipKey(r.id, userId)))
        .map((r) => ({
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
      const row = rows.get(id);
      if (!row || !memberships.has(membershipKey(id, userId))) return "forbidden";
      row.revoked_at = new Date();
      return "revoked";
    },
  };
}
