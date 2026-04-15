import * as assert from "node:assert/strict";
import test from "node:test";
import { NaverSearchProvider } from "../core/webSearch/naverProvider";
import { BraveSearchProvider } from "../core/webSearch/braveProvider";
import { WebSearchError, type WebSearchProvider, type WebSearchResult } from "../core/webSearch/provider";

// --- NaverSearchProvider stub (인터페이스 구조 검증) ---
test("NaverSearchProvider implements WebSearchProvider interface", () => {
  const provider = new NaverSearchProvider("id", "secret");
  assert.strictEqual(provider.id, "naver");
  assert.strictEqual(typeof provider.search, "function");
});

test("BraveSearchProvider implements WebSearchProvider interface", () => {
  const provider = new BraveSearchProvider("key");
  assert.strictEqual(provider.id, "brave");
  assert.strictEqual(typeof provider.search, "function");
});

test("WebSearchError has correct reason field", () => {
  const err = new WebSearchError("unauthorized", "test");
  assert.strictEqual(err.reason, "unauthorized");
  assert.ok(err instanceof Error);
  assert.strictEqual(err.name, "WebSearchError");
});

// --- Naver응답 파싱 검증 (mock fetch) ---
test("NaverSearchProvider parses news response and decodes HTML entities", async () => {
  const mockItems = [
    {
      title: "테스트 &amp; 기업 <b>성장</b>",
      link: "https://news.example.com/1",
      originallink: "https://news.example.com/1",
      description: "테스트 기업 &lt;연매출&gt; 2000억 달성",
      pubDate: "Mon, 15 Apr 2026 10:00:00 +0900"
    }
  ];

  const mockFetch = async (url: string, options: RequestInit): Promise<Response> => {
    assert.ok(url.includes("news.json"), "should call news endpoint first");
    const headers = options?.headers as Record<string, string> | undefined;
    assert.ok(headers?.["X-Naver-Client-Id"], "should include client id header");
    return new Response(JSON.stringify({ items: mockItems }), { status: 200 });
  };

  // NaverSearchProvider를 mockFetch로 테스트하기 위해 내부 fetch 교체
  const originalFetch = global.fetch;
  global.fetch = mockFetch as unknown as typeof fetch;

  try {
    const provider = new NaverSearchProvider("test-id", "test-secret");
    const results = await provider.search({ companyName: "테스트기업" });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, "테스트 & 기업 성장");
    assert.strictEqual(results[0].url, "https://news.example.com/1");
    assert.ok(results[0].snippet.includes("<연매출>"), "should decode &lt;&gt;");
    assert.ok(results[0].publishedAt, "should parse pubDate");
  } finally {
    global.fetch = originalFetch;
  }
});

// --- recency 필터 검증 ---
test("webSource recency filter removes old results", async () => {
  const { fetchWebSource } = await import("../core/companyContext/webSource");

  const oldDate = new Date();
  oldDate.setMonth(oldDate.getMonth() - 12);

  const recentDate = new Date();
  recentDate.setMonth(recentDate.getMonth() - 3);

  const mockProvider: WebSearchProvider = {
    id: "naver",
    async search(): Promise<readonly WebSearchResult[]> {
      return [
        {
          title: "오래된 뉴스",
          url: "https://old.example.com/news",
          snippet: "오래된 내용",
          publishedAt: oldDate.toISOString(),
          source: "news"
        },
        {
          title: "최근 뉴스",
          url: "https://recent.example.com/news",
          snippet: "최근 내용",
          publishedAt: recentDate.toISOString(),
          source: "news"
        }
      ];
    }
  };

  const result = await fetchWebSource(
    { companyName: "테스트기업" },
    mockProvider,
    7
  );

  // 9개월 cutoff → 12개월짜리는 제거, 3개월짜리는 유지
  assert.strictEqual(result.entries.length, 1);
  assert.strictEqual(result.entries[0].title, "최근 뉴스");
});

// --- dedupe 검증 ---
test("webSource deduplicates results by URL origin+path", async () => {
  const { fetchWebSource } = await import("../core/companyContext/webSource");

  const mockProvider: WebSearchProvider = {
    id: "naver",
    async search(): Promise<readonly WebSearchResult[]> {
      return [
        {
          title: "뉴스 A",
          url: "https://news.example.com/article/1?ref=home",
          snippet: "내용 A",
          source: "news"
        },
        {
          title: "뉴스 A 중복",
          url: "https://news.example.com/article/1?ref=search",
          snippet: "내용 A 중복",
          source: "news"
        },
        {
          title: "뉴스 B",
          url: "https://news.example.com/article/2",
          snippet: "내용 B",
          source: "news"
        }
      ];
    }
  };

  const result = await fetchWebSource(
    { companyName: "테스트기업" },
    mockProvider,
    7
  );

  // 중복 URL 1개 제거
  assert.strictEqual(result.entries.length, 2);
});

// --- provider 없을 때 빈 결과 반환 ---
test("webSource returns empty result when provider is undefined", async () => {
  const { fetchWebSource } = await import("../core/companyContext/webSource");

  const result = await fetchWebSource(
    { companyName: "테스트기업" },
    undefined,
    7
  );

  assert.strictEqual(result.entries.length, 0);
  assert.ok(result.notes.some((n) => n.includes("provider not configured")));
});

// --- provider 오류 시 빈 결과 + notes ---
test("webSource returns empty result with error note when provider throws", async () => {
  const { fetchWebSource } = await import("../core/companyContext/webSource");

  const failingProvider: WebSearchProvider = {
    id: "naver",
    async search(): Promise<readonly WebSearchResult[]> {
      throw new WebSearchError("networkError", "connection refused");
    }
  };

  const result = await fetchWebSource(
    { companyName: "테스트기업" },
    failingProvider,
    7
  );

  assert.strictEqual(result.entries.length, 0);
  assert.ok(result.notes.some((n) => n.includes("connection refused")));
});
