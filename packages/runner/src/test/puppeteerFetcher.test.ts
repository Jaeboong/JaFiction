import * as assert from "node:assert/strict";
import test from "node:test";
import { isFetcherError } from "@jasojeon/shared";
import { PuppeteerFetcher, type PuppeteerLike } from "../jobPosting/puppeteerFetcher";

function createStubPuppeteer(overrides: Partial<{
  gotoImpl: (url: string) => unknown;
  contentImpl: () => string;
  statusImpl: () => number;
  throwOnLaunch: boolean;
}> = {}) {
  const closed: string[] = [];
  const calls = {
    launch: 0,
    newPage: 0,
    goto: 0,
    content: 0
  };

  const stub: PuppeteerLike = {
    launch: async () => {
      calls.launch += 1;
      if (overrides.throwOnLaunch) {
        throw new Error("launch failed");
      }

      return {
        newPage: async () => {
          calls.newPage += 1;
          return {
            setUserAgent: async () => undefined,
            setExtraHTTPHeaders: async () => undefined,
            goto: async (url: string) => {
              calls.goto += 1;
              if (overrides.gotoImpl) {
                return overrides.gotoImpl(url) as never;
              }

              return {
                status: () => overrides.statusImpl?.() ?? 200,
                statusText: () => "OK",
                headers: () => ({ "content-type": "text/html" }),
                url: () => url
              };
            },
            content: async () => {
              calls.content += 1;
              return overrides.contentImpl?.() ?? "<html>ok</html>";
            },
            url: () => "https://jumpit.saramin.co.kr/position/123",
            close: async () => {
              closed.push("page");
            }
          };
        },
        close: async () => {
          closed.push("browser");
        }
      };
    }
  };

  return { stub, closed, calls };
}

test("PuppeteerFetcher reuses a lazily launched browser across fetch calls", async () => {
  const { stub, calls } = createStubPuppeteer();
  const fetcher = new PuppeteerFetcher({ puppeteerModule: stub });

  await fetcher.fetch("https://jumpit.saramin.co.kr/a");
  await fetcher.fetch("https://jumpit.saramin.co.kr/b");

  assert.equal(calls.launch, 1);
  assert.equal(calls.newPage, 2);
  await fetcher.close();
});

test("PuppeteerFetcher returns html, status, and finalUrl on success", async () => {
  const { stub } = createStubPuppeteer({
    contentImpl: () => "<html>hello</html>"
  });
  const fetcher = new PuppeteerFetcher({ puppeteerModule: stub });

  const result = await fetcher.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(result.status, 200);
  assert.equal(result.fetcherKind, "browser");
  assert.match(result.html, /hello/);
  assert.match(result.finalUrl, /jumpit\.saramin\.co\.kr/);
  await fetcher.close();
});

test("PuppeteerFetcher throws http FetcherError on non-2xx response", async () => {
  const { stub } = createStubPuppeteer({
    statusImpl: () => 500
  });
  const fetcher = new PuppeteerFetcher({ puppeteerModule: stub });

  await assert.rejects(() => fetcher.fetch("https://jumpit.saramin.co.kr/position/2"), (error: unknown) => {
    assert.ok(isFetcherError(error));
    assert.equal((error as Error & { info: { kind: string; status?: number } }).info.kind, "http");
    assert.equal((error as Error & { info: { kind: string; status?: number } }).info.status, 500);
    return true;
  });
  await fetcher.close();
});

test("PuppeteerFetcher wraps goto failures as browser FetcherError", async () => {
  const { stub } = createStubPuppeteer({
    gotoImpl: () => {
      throw new Error("timeout");
    }
  });
  const fetcher = new PuppeteerFetcher({ puppeteerModule: stub });

  await assert.rejects(() => fetcher.fetch("https://jumpit.saramin.co.kr/position/3"), (error: unknown) => {
    assert.ok(isFetcherError(error));
    assert.equal((error as Error & { info: { kind: string } }).info.kind, "browser");
    return true;
  });
  await fetcher.close();
});

test("PuppeteerFetcher close is idempotent and allows relaunch", async () => {
  const { stub, calls } = createStubPuppeteer();
  const fetcher = new PuppeteerFetcher({ puppeteerModule: stub });

  await fetcher.fetch("https://jumpit.saramin.co.kr/a");
  await fetcher.close();
  await fetcher.close();
  await fetcher.fetch("https://jumpit.saramin.co.kr/b");

  assert.equal(calls.launch, 2);
  await fetcher.close();
});
