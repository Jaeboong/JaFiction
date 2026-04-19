import * as assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STATIC_HEADERS,
  FetcherError,
  StaticFetcher,
  isFetcherError
} from "../index";

test("StaticFetcher returns html/status/finalUrl on 200 response", async () => {
  const fetcher = new StaticFetcher({
    fetchImpl: async (_url, _init) => new Response("<html>ok</html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });

  const result = await fetcher.fetch("https://example.com/a");
  assert.equal(result.status, 200);
  assert.equal(result.fetcherKind, "static");
  assert.match(result.html, /ok/);
  assert.equal(result.finalUrl, "https://example.com/a");
});

test("StaticFetcher throws FetcherError with network kind when fetch throws", async () => {
  const fetcher = new StaticFetcher({
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    }
  });

  await assert.rejects(() => fetcher.fetch("https://example.com/network"), (error: unknown) => {
    assert.ok(isFetcherError(error));
    assert.equal((error as FetcherError).info.kind, "network");
    return true;
  });
});

test("StaticFetcher throws FetcherError with http diagnostics on non-ok response", async () => {
  const fetcher = new StaticFetcher({
    fetchImpl: async () => new Response("<html>denied</html>", {
      status: 500,
      statusText: "Internal Server Error",
      headers: {
        "x-request-id": "req-1",
        "set-cookie": "session=secret"
      }
    })
  });

  await assert.rejects(() => fetcher.fetch("https://example.com/blocked"), (error: unknown) => {
    assert.ok(isFetcherError(error));
    const info = (error as FetcherError).info;
    assert.equal(info.kind, "http");
    assert.equal(info.status, 500);
    assert.equal(info.statusText, "Internal Server Error");
    assert.equal(info.responseHeaders?.["x-request-id"], "req-1");
    assert.equal(info.responseHeaders?.["set-cookie"], "session=secret");
    assert.match(info.bodySnippet ?? "", /denied/);
    return true;
  });
});

test("StaticFetcher default headers keep ForJob user-agent contract", async () => {
  let observedHeaders: Record<string, string> | undefined;
  const fetcher = new StaticFetcher({
    fetchImpl: async (_url, init) => {
      observedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    }
  });

  await fetcher.fetch("https://example.com/headers");
  assert.match(
    observedHeaders?.["user-agent"] ?? "",
    /^ForJob\/0\.1\.\d+ \(\+https:\/\/github\.com\/Jaeboong\/CoordinateAI\)$/
  );
  assert.equal(
    observedHeaders?.["accept-language"],
    DEFAULT_STATIC_HEADERS["accept-language"]
  );
});

test("StaticFetcher merges per-call headersOverride", async () => {
  let observedHeaders: Record<string, string> | undefined;
  const fetcher = new StaticFetcher({
    fetchImpl: async (_url, init) => {
      observedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    }
  });

  await fetcher.fetch("https://example.com/override", {
    headersOverride: {
      "x-test": "1"
    }
  });

  assert.equal(observedHeaders?.["x-test"], "1");
  assert.match(observedHeaders?.["user-agent"] ?? "", /ForJob/);
});
