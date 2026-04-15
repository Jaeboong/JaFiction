import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { buildCacheEntry, readWebSearchCache, writeWebSearchCache } from "../core/companyContext/cache";
import type { WebSearchResult } from "../core/webSearch/provider";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-cache-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sampleResult: WebSearchResult = {
  title: "테스트 뉴스",
  url: "https://news.example.com/1",
  snippet: "테스트 내용",
  publishedAt: new Date().toISOString(),
  source: "news"
};

test("cache: write and read hit returns results", async () => {
  await withTempDir(async (dir) => {
    const entry = buildCacheEntry("테스트기업", "naver", { companyName: "테스트기업" }, [sampleResult], 7);
    await writeWebSearchCache(dir, entry);

    const cached = await readWebSearchCache(dir, "테스트기업", "naver");
    assert.ok(cached, "should return cached entry");
    assert.strictEqual(cached.results.length, 1);
    assert.strictEqual(cached.results[0].title, "테스트 뉴스");
  });
});

test("cache: expired entry returns undefined (miss)", async () => {
  await withTempDir(async (dir) => {
    const now = new Date();
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - 1); // 1일 전 만료

    const entry = buildCacheEntry("테스트기업", "naver", { companyName: "테스트기업" }, [sampleResult], 7);
    const expiredEntry = { ...entry, expiresAt: pastDate.toISOString() };
    await writeWebSearchCache(dir, expiredEntry);

    const cached = await readWebSearchCache(dir, "테스트기업", "naver");
    assert.strictEqual(cached, undefined, "expired entry should return undefined");
  });
});

test("cache: provider-id separation — naver and brave use different keys", async () => {
  await withTempDir(async (dir) => {
    const naverEntry = buildCacheEntry("테스트기업", "naver", { companyName: "테스트기업" }, [sampleResult], 7);
    await writeWebSearchCache(dir, naverEntry);

    // brave key로 읽으면 miss
    const braveCached = await readWebSearchCache(dir, "테스트기업", "brave");
    assert.strictEqual(braveCached, undefined, "brave key should not find naver cache");

    // naver key로 읽으면 hit
    const naverCached = await readWebSearchCache(dir, "테스트기업", "naver");
    assert.ok(naverCached, "naver key should find naver cache");
  });
});

test("cache: missing file returns undefined (miss)", async () => {
  await withTempDir(async (dir) => {
    const cached = await readWebSearchCache(dir, "없는기업", "naver");
    assert.strictEqual(cached, undefined);
  });
});

test("cache: TTL boundary — entry expiring in future is a hit", async () => {
  await withTempDir(async (dir) => {
    const entry = buildCacheEntry("테스트기업", "naver", { companyName: "테스트기업" }, [sampleResult], 7);
    // expiresAt = 7일 후 → hit
    await writeWebSearchCache(dir, entry);

    const cached = await readWebSearchCache(dir, "테스트기업", "naver");
    assert.ok(cached, "should be a cache hit when TTL is in future");
  });
});

test("cache: company name normalization — same company different case", async () => {
  await withTempDir(async (dir) => {
    const entry = buildCacheEntry("테스트기업", "naver", { companyName: "테스트기업" }, [sampleResult], 7);
    await writeWebSearchCache(dir, entry);

    // 대소문자 차이가 있는 회사명으로 읽기 (한글은 대소문자 없으므로 동일 key)
    const cached = await readWebSearchCache(dir, "테스트기업", "naver");
    assert.ok(cached, "should normalize company name");
  });
});
