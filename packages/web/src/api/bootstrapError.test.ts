/**
 * bootstrapError.test.ts — Stage 11.5
 *
 * Pins the RunnerBootstrapError discriminated union and the hosted bootstrap
 * path that maps HTTP 401 / device_offline / network failures / other onto
 * the four reason codes. App.tsx branches on `.reason`, so any drift here
 * silently downgrades the UX back to the monolithic loading card bug.
 */
import { describe, it, beforeEach, afterEach, vi, type Mock } from "vitest";
import { strict as assert } from "node:assert";
import { RunnerBootstrapError, RunnerClient } from "./client";

describe("RunnerBootstrapError", () => {
  it("carries the reason on the instance and is catchable via instanceof", () => {
    const err = new RunnerBootstrapError("auth_required", "nope");
    assert.equal(err.reason, "auth_required");
    assert.equal(err.name, "RunnerBootstrapError");
    assert.ok(err instanceof RunnerBootstrapError);
    assert.ok(err instanceof Error);
  });

  it("supports all four discriminated reasons", () => {
    const reasons = ["auth_required", "device_offline", "network_error", "unknown"] as const;
    for (const reason of reasons) {
      const err = new RunnerBootstrapError(reason, `msg ${reason}`);
      assert.equal(err.reason, reason);
    }
  });
});

describe("RunnerClient.bootstrap hosted error classification", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps HTTP 401 to reason 'auth_required'", async () => {
    const fetchMock: Mock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => RunnerClient.bootstrap("http://hosted.test"),
      (error: unknown) =>
        error instanceof RunnerBootstrapError && error.reason === "auth_required"
    );
  });

  it("maps envelope {ok:false, error.code:'device_offline'} to reason 'device_offline'", async () => {
    const fetchMock: Mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            v: 1,
            id: "x",
            ok: false,
            error: { code: "device_offline", message: "no runner" }
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => RunnerClient.bootstrap("http://hosted.test"),
      (error: unknown) =>
        error instanceof RunnerBootstrapError && error.reason === "device_offline"
    );
  });

  it("maps a fetch TypeError (network / CORS) to reason 'network_error'", async () => {
    const fetchMock: Mock = vi.fn(async () => {
      throw new TypeError("failed to fetch");
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => RunnerClient.bootstrap("http://hosted.test"),
      (error: unknown) =>
        error instanceof RunnerBootstrapError && error.reason === "network_error"
    );
  });

  it("maps other RPC envelope errors to reason 'unknown'", async () => {
    const fetchMock: Mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            v: 1,
            id: "x",
            ok: false,
            error: { code: "internal_error", message: "boom" }
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => RunnerClient.bootstrap("http://hosted.test"),
      (error: unknown) =>
        error instanceof RunnerBootstrapError && error.reason === "unknown"
    );
  });

  it("returns the SidebarState on a successful hosted envelope", async () => {
    const fetchMock: Mock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            v: 1,
            id: "x",
            ok: true,
            result: { workspaceOpened: true, projects: [] }
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const session = await RunnerClient.bootstrap("http://hosted.test");
    assert.equal(session.storageRoot, "");
    assert.ok(session.state);
    const url = String(fetchMock.mock.calls[0]![0]);
    assert.match(url, /\/api\/rpc$/);
  });
});
