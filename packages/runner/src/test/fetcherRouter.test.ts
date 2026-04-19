import * as assert from "node:assert/strict";
import test from "node:test";
import { FetcherError, type JobPostingFetcher } from "@jasojeon/shared";
import { SPA_HOSTS, createFetcherRouter, resolveSpaHosts } from "../jobPosting/fetcherRouter";

function createStubFetcher(
  label: "static" | "browser",
  impl?: (url: string) => Promise<unknown> | unknown
): JobPostingFetcher {
  return {
    async fetch(url: string) {
      const result = impl ? await impl(url) : undefined;
      if (result instanceof Error) {
        throw result;
      }

      return {
        html: `<${label}>`,
        status: 200,
        statusText: "OK",
        finalUrl: url,
        responseHeaders: {},
        fetcherKind: label
      };
    },
    async close() {
      return undefined;
    }
  };
}

test("fetcher router sends non-SPA hosts to StaticFetcher", async () => {
  const router = createFetcherRouter({
    puppeteerEnabled: true,
    staticFetcher: createStubFetcher("static"),
    puppeteerFetcher: createStubFetcher("browser")
  });

  const result = await router.fetch("https://www.wanted.co.kr/wd/1");
  assert.equal(result.fetcherKind, "static");
});

test("fetcher router sends SPA hosts to PuppeteerFetcher when enabled", async () => {
  const router = createFetcherRouter({
    puppeteerEnabled: true,
    staticFetcher: createStubFetcher("static"),
    puppeteerFetcher: createStubFetcher("browser")
  });

  const result = await router.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(result.fetcherKind, "browser");
});

test("fetcher router falls back to static when SPA host is requested but puppeteer is disabled", async () => {
  const warnings: string[] = [];
  const router = createFetcherRouter({
    puppeteerEnabled: false,
    staticFetcher: createStubFetcher("static"),
    logger: {
      warn(message: string) {
        warnings.push(message);
      }
    }
  });

  const result = await router.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(result.fetcherKind, "static");
  assert.ok(warnings.some((message) => /falling back to static/.test(message)));
});

test("fetcher router falls back to static when puppeteer fetch throws", async () => {
  const warnings: string[] = [];
  const router = createFetcherRouter({
    puppeteerEnabled: true,
    staticFetcher: createStubFetcher("static"),
    puppeteerFetcher: createStubFetcher(
      "browser",
      () => new FetcherError("boom", { kind: "browser", requestUrl: "https://jumpit.saramin.co.kr/position/1" })
    ),
    logger: {
      warn(message: string) {
        warnings.push(message);
      }
    }
  });

  const result = await router.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(result.fetcherKind, "static");
  assert.ok(warnings.some((message) => /Puppeteer fetch failed/.test(message)));
});

test("resolveSpaHosts unions env hosts without duplicates", () => {
  const hosts = resolveSpaHosts("foo.com, bar.com , jumpit.saramin.co.kr");
  assert.ok(hosts.includes("jumpit.saramin.co.kr"));
  assert.ok(hosts.includes("foo.com"));
  assert.ok(hosts.includes("bar.com"));
  assert.equal(new Set(hosts).size, hosts.length);
});

test("SPA_HOSTS contains jumpit", () => {
  assert.ok(SPA_HOSTS.includes("jumpit.saramin.co.kr"));
});
