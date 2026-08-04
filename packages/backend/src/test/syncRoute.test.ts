import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import Fastify from "fastify";
import { registerSync, type SyncStore } from "../routes/sync";
import { TEST_ENV } from "./testApp";
import type { SyncSet } from "@jasojeon/shared";
import type { Env } from "../env";

const encryptionEnv: Env = {
  ...TEST_ENV,
  SYNC_ENCRYPTION_KEY: "b".repeat(64)
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

class FakeSyncStore implements SyncStore {
  readonly validTokenHash: string;
  stored: SyncSet = { documents: [], projects: [] };
  clearedUserId: string | undefined;

  constructor(token: string) {
    this.validTokenHash = hashToken(token);
  }

  async findUserIdByDeviceTokenHash(tokenHash: string): Promise<string | undefined> {
    return tokenHash === this.validTokenHash ? "user-1" : undefined;
  }

  async mergeUserSyncSet(_userId: string, incoming: SyncSet, _env: Pick<Env, "SYNC_ENCRYPTION_KEY">): Promise<SyncSet> {
    this.stored = incoming;
    return incoming;
  }

  async clearUserSyncSet(userId: string): Promise<void> {
    this.clearedUserId = userId;
    this.stored = { documents: [], projects: [] };
  }
}

describe("sync route", () => {
  it("returns 503 when sync encryption is not configured", async () => {
    const app = Fastify({ logger: false });
    const store = new FakeSyncStore("token-1");
    await registerSync(app, {
      syncStore: store,
      env: { ...TEST_ENV, SYNC_ENCRYPTION_KEY: undefined }
    });
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/sync",
        headers: { Authorization: "Bearer token-1" },
        payload: { documents: [], projects: [] }
      });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { error: "sync_disabled" });
    } finally {
      await app.close();
    }
  });

  it("does not log synced document title or decoded content", async () => {
    const lines: string[] = [];
    const stream = {
      write(line: string) {
        lines.push(line);
      }
    };
    const app = Fastify({ logger: { level: "info", stream } });
    const store = new FakeSyncStore("token-2");
    await registerSync(app, { syncStore: store, env: encryptionEnv });
    await app.ready();

    const titleSentinel = "SYNC_TITLE_SENTINEL_6ef77448";
    const contentSentinel = "SYNC_CONTENT_SENTINEL_32d72bb2";
    const content = Buffer.from(contentSentinel, "utf8");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/sync",
        headers: { Authorization: "Bearer token-2" },
        payload: {
          documents: [{
            scope: "profile",
            contentSha256: crypto.createHash("sha256").update(content).digest("hex"),
            title: titleSentinel,
            sourceType: "text",
            pinnedByDefault: false,
            createdAt: "2026-05-27T00:00:00.000Z",
            contentBase64: content.toString("base64")
          }],
          projects: []
        }
      });

      assert.equal(response.statusCode, 200);
      const rawLog = lines.join("\n");
      assert.ok(!rawLog.includes(titleSentinel), rawLog);
      assert.ok(!rawLog.includes(contentSentinel), rawLog);
    } finally {
      await app.close();
    }
  });

  it("deletes the authenticated user's sync rows", async () => {
    const app = Fastify({ logger: false });
    const store = new FakeSyncStore("token-3");
    await registerSync(app, { syncStore: store, env: encryptionEnv });
    await app.ready();
    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/sync",
        headers: { Authorization: "Bearer token-3" }
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { ok: true });
      assert.equal(store.clearedUserId, "user-1");
    } finally {
      await app.close();
    }
  });
});
