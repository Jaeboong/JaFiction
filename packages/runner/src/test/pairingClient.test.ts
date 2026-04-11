/**
 * pairingClient.test.ts — Phase 5
 *
 * Tests claimPairingCode via dependency-injected fetch mocks.
 */
import * as assert from "node:assert/strict";
import test from "node:test";
import { claimPairingCode } from "../hosted/pairingClient";

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function makeOkFetch(body: unknown): typeof globalThis.fetch {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as Response;
}

function makeErrorFetch(status: number, body: unknown): typeof globalThis.fetch {
  return async () =>
    ({
      ok: false,
      status,
      json: async () => body,
    }) as Response;
}

function makeNetworkErrorFetch(): typeof globalThis.fetch {
  return async () => {
    throw new Error("ECONNREFUSED");
  };
}

function makeInvalidJsonFetch(): typeof globalThis.fetch {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: valid response body is parsed and returned", async () => {
  const mockBody = {
    token: "a".repeat(64),
    deviceId: "device-uuid-123",
    userId: "user-uuid-456",
  };
  const result = await claimPairingCode(
    { backendUrl: "http://localhost:3099", code: "ABCD1234" },
    { fetch: makeOkFetch(mockBody) }
  );
  assert.equal(result.token, mockBody.token);
  assert.equal(result.deviceId, mockBody.deviceId);
  assert.equal(result.userId, mockBody.userId);
});

test("error path: 400 response throws with error code", async () => {
  await assert.rejects(
    async () => {
      await claimPairingCode(
        { backendUrl: "http://localhost:3099", code: "BADCODE1" },
        { fetch: makeErrorFetch(400, { error: "invalid_code" }) }
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("invalid_code"),
        `Expected 'invalid_code' in error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test("error path: 429 response throws with rate_limited code", async () => {
  await assert.rejects(
    async () => {
      await claimPairingCode(
        { backendUrl: "http://localhost:3099", code: "RATECODE" },
        { fetch: makeErrorFetch(429, { error: "rate_limited" }) }
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("429"));
      return true;
    }
  );
});

test("error path: network failure throws with connection message", async () => {
  await assert.rejects(
    async () => {
      await claimPairingCode(
        { backendUrl: "http://localhost:3099", code: "NETFAIL1" },
        { fetch: makeNetworkErrorFetch() }
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("ECONNREFUSED") || err.message.includes("failed"),
        `Expected connection error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test("error path: invalid JSON shape throws zod parse error", async () => {
  const badBody = { wrong: "shape" }; // missing token, deviceId, userId
  await assert.rejects(
    async () => {
      await claimPairingCode(
        { backendUrl: "http://localhost:3099", code: "SHAPEBAD" },
        { fetch: makeOkFetch(badBody) }
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("unexpected shape") || err.message.includes("Required"),
        `Expected schema error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test("error path: JSON parse error on ok response throws", async () => {
  await assert.rejects(
    async () => {
      await claimPairingCode(
        { backendUrl: "http://localhost:3099", code: "JSONERR1" },
        { fetch: makeInvalidJsonFetch() }
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.toLowerCase().includes("json"),
        `Expected JSON error message, got: ${err.message}`
      );
      return true;
    }
  );
});

test("fetch defaults to global fetch when not injected", async () => {
  // We can't call this without a real server, so we just verify that
  // omitting the deps parameter doesn't throw a TypeError about missing fetch.
  // We expect a network error (ECONNREFUSED), not a TypeError.
  await assert.rejects(
    async () => {
      // Port 1 is always closed — will fail with ECONNREFUSED
      await claimPairingCode({ backendUrl: "http://127.0.0.1:1", code: "NOFETCH1" });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // Should NOT be "fetch is not defined"
      assert.ok(
        !err.message.includes("fetch is not defined"),
        "Should use global fetch, not throw about missing fetch"
      );
      return true;
    }
  );
});
