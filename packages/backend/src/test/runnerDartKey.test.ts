/**
 * runnerDartKey.test.ts
 *
 * GET /api/runner/dart-key — runner deviceToken 인증 후 DART_API_KEY 반환
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import Fastify from "fastify";
import { registerRunnerDartKey } from "../routes/runnerDartKey";
import type { RunnerDartKeyDeviceStore } from "../routes/runnerDartKey";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeStore(validToken?: string): RunnerDartKeyDeviceStore {
  const tokenHash = validToken ? hashToken(validToken) : undefined;
  return {
    async findDeviceIdByTokenHash(hash: string) {
      if (tokenHash && hash === tokenHash) return "device-id-1";
      return undefined;
    },
  };
}

async function buildApp(store: RunnerDartKeyDeviceStore, dartApiKey = "test-dart-key-abc") {
  const app = Fastify({ logger: false });
  registerRunnerDartKey(app, {
    deviceStore: store,
    env: { DART_API_KEY: dartApiKey },
  });
  await app.ready();
  return app;
}

async function get(
  app: Awaited<ReturnType<typeof buildApp>>,
  authHeader?: string
): Promise<{ status: number; body: unknown }> {
  const res = await app.inject({
    method: "GET",
    url: "/api/runner/dart-key",
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  return { status: res.statusCode, body: res.json() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/runner/dart-key", () => {
  it("Authorization 헤더 없으면 401", async () => {
    const app = await buildApp(makeStore("some-token"));
    try {
      const { status } = await get(app);
      assert.strictEqual(status, 401);
    } finally {
      await app.close();
    }
  });

  it("Bearer 형식 아닌 헤더면 401", async () => {
    const app = await buildApp(makeStore("some-token"));
    try {
      const { status } = await get(app, "Token bad-format");
      assert.strictEqual(status, 401);
    } finally {
      await app.close();
    }
  });

  it("유효하지 않은 deviceToken → 401", async () => {
    const app = await buildApp(makeStore("real-token"));
    try {
      const { status } = await get(app, "Bearer wrong-token");
      assert.strictEqual(status, 401);
    } finally {
      await app.close();
    }
  });

  it("유효한 deviceToken → 200 + key 반환", async () => {
    const validToken = "valid-device-token-xyz";
    const app = await buildApp(makeStore(validToken), "my-dart-api-key");
    try {
      const { status, body } = await get(app, `Bearer ${validToken}`);
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(body, { key: "my-dart-api-key" });
    } finally {
      await app.close();
    }
  });

  it("DB에 device 없으면 401 (폐기 또는 미등록)", async () => {
    const app = await buildApp(makeStore());
    try {
      const { status } = await get(app, "Bearer any-token");
      assert.strictEqual(status, 401);
    } finally {
      await app.close();
    }
  });
});
