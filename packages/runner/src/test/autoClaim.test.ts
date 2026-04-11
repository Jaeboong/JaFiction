/**
 * autoClaim.test.ts — Stage 11.9
 *
 * Tests autoClaimDevice via dependency-injected fetch mocks.
 */
import * as assert from "node:assert/strict";
import test from "node:test";
import { autoClaimDevice, AutoClaimError } from "../hosted/pairingClient";

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit };

function makeMockFetch(
  responses: Array<{ ok: boolean; status: number; body: unknown }>
): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    const resp = responses[index] ?? responses[responses.length - 1];
    index++;
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
    } as Response;
  };

  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function makeNetworkErrorFetch(): typeof globalThis.fetch {
  return async () => {
    throw new Error("ECONNREFUSED");
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: register → pending poll → approved poll returns token", async () => {
  const registerBody = {
    claimId: "claim-uuid-1234",
    pollToken: "poll-token-abcd",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const pendingBody = { status: "pending" };
  const approvedBody = {
    status: "approved",
    token: "a".repeat(64),
    deviceId: "device-uuid-1",
    userId: "user-uuid-2",
  };

  const { fetch: mockFetch } = makeMockFetch([
    { ok: true, status: 200, body: registerBody },
    { ok: true, status: 200, body: pendingBody },
    { ok: true, status: 200, body: approvedBody },
  ]);

  const result = await autoClaimDevice(
    { backendUrl: "http://localhost:4000" },
    { fetch: mockFetch }
  );

  assert.equal(result.token, "a".repeat(64));
  assert.equal(result.deviceId, "device-uuid-1");
  assert.equal(result.userId, "user-uuid-2");
});

test("rejected status throws AutoClaimError with reason='rejected'", async () => {
  const { fetch: mockFetch } = makeMockFetch([
    { ok: true, status: 200, body: { claimId: "cid", pollToken: "ptok", expiresAt: new Date(Date.now() + 600_000).toISOString() } },
    { ok: true, status: 200, body: { status: "rejected" } },
  ]);

  await assert.rejects(
    async () => autoClaimDevice({ backendUrl: "http://localhost:4000" }, { fetch: mockFetch }),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError);
      assert.equal(err.reason, "rejected");
      return true;
    }
  );
});

test("expired status throws AutoClaimError with reason='expired'", async () => {
  const { fetch: mockFetch } = makeMockFetch([
    { ok: true, status: 200, body: { claimId: "cid", pollToken: "ptok", expiresAt: new Date(Date.now() + 600_000).toISOString() } },
    { ok: true, status: 200, body: { status: "expired" } },
  ]);

  await assert.rejects(
    async () => autoClaimDevice({ backendUrl: "http://localhost:4000" }, { fetch: mockFetch }),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError);
      assert.equal(err.reason, "expired");
      return true;
    }
  );
});

test("network error on register throws AutoClaimError with reason='network_error'", async () => {
  await assert.rejects(
    async () =>
      autoClaimDevice(
        { backendUrl: "http://localhost:4000" },
        { fetch: makeNetworkErrorFetch() }
      ),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError);
      assert.equal(err.reason, "network_error");
      return true;
    }
  );
});

test("3 consecutive network errors on poll throws AutoClaimError", async () => {
  let callIndex = 0;
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    callIndex++;
    if (callIndex === 1) {
      // Registration succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          claimId: "cid",
          pollToken: "ptok",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      } as Response;
    }
    // All polls throw network error
    throw new Error(`ECONNREFUSED polling ${url}`);
  };

  await assert.rejects(
    async () =>
      autoClaimDevice({ backendUrl: "http://localhost:4000" }, { fetch: fetch as typeof globalThis.fetch }),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError);
      assert.equal(err.reason, "network_error");
      assert.ok(err.message.includes("3 network errors") || err.message.includes("network errors"), err.message);
      return true;
    }
  );
});

test("non-200 registration response throws AutoClaimError", async () => {
  const { fetch: mockFetch } = makeMockFetch([
    { ok: false, status: 429, body: { error: "rate_limited" } },
  ]);

  await assert.rejects(
    async () => autoClaimDevice({ backendUrl: "http://localhost:4000" }, { fetch: mockFetch }),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError);
      assert.equal(err.reason, "network_error");
      return true;
    }
  );
});

test("abort signal aborts the claim", async () => {
  const controller = new AbortController();

  let callIndex = 0;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    callIndex++;
    if (callIndex === 1) {
      // Registration succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          claimId: "cid",
          pollToken: "ptok",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
      } as Response;
    }
    // Abort before second call
    controller.abort();
    if (init?.signal?.aborted) throw new Error("aborted");
    return { ok: true, status: 200, json: async () => ({ status: "pending" }) } as Response;
  };

  await assert.rejects(
    async () =>
      autoClaimDevice(
        { backendUrl: "http://localhost:4000", abortSignal: controller.signal },
        { fetch: fetch as typeof globalThis.fetch }
      ),
    (err: unknown) => {
      assert.ok(err instanceof AutoClaimError || err instanceof Error);
      return true;
    }
  );
});
