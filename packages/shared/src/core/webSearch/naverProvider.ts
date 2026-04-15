import { WebSearchError, WebSearchProvider, WebSearchQuery, WebSearchResult } from "./provider";

const NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json";
const NAVER_WEB_URL = "https://openapi.naver.com/v1/search/webkr.json";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_DISPLAY = 20;

interface NaverSearchItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  originallink?: string;
}

interface NaverSearchResponse {
  items?: NaverSearchItem[];
  lastBuildDate?: string;
  total?: number;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<\/?b>/gi, "");
}

async function searchWithRetry(
  url: string,
  query: string,
  clientId: string,
  clientSecret: string
): Promise<NaverSearchItem[]> {
  const params = new URLSearchParams({
    query,
    display: String(MAX_DISPLAY),
    sort: "date"
  });

  const fetchUrl = `${url}?${params.toString()}`;
  const headers = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret
  };

  let lastError: unknown;
  const delays = [500, 1500];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(fetchUrl, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.status === 401 || response.status === 403) {
        throw new WebSearchError("unauthorized", `Naver API auth failed: ${response.status}`);
      }
      if (response.status === 429) {
        throw new WebSearchError("quotaExceeded", "Naver API quota exceeded");
      }
      if (response.status >= 500 && attempt < delays.length) {
        lastError = new Error(`Naver API server error: ${response.status}`);
        continue;
      }
      if (!response.ok) {
        throw new WebSearchError("networkError", `Naver API error: ${response.status}`);
      }

      const data = await response.json() as NaverSearchResponse;
      return data.items ?? [];
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof WebSearchError) throw error;
      lastError = error;
      if (attempt >= delays.length) break;
    }
  }

  throw new WebSearchError("networkError", lastError instanceof Error ? lastError.message : String(lastError));
}

export class NaverSearchProvider implements WebSearchProvider {
  readonly id = "naver" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  async search(query: WebSearchQuery): Promise<readonly WebSearchResult[]> {
    const searchQuery = [query.companyName, query.roleName].filter(Boolean).join(" ");

    let items = await searchWithRetry(NAVER_NEWS_URL, searchQuery, this.clientId, this.clientSecret);

    // 뉴스 결과가 없으면 웹 검색으로 fallback
    if (items.length === 0) {
      items = await searchWithRetry(NAVER_WEB_URL, searchQuery, this.clientId, this.clientSecret);
    }

    const results: WebSearchResult[] = items.map((item) => ({
      title: decodeHtmlEntities(item.title),
      url: item.originallink ?? item.link,
      snippet: decodeHtmlEntities(item.description),
      publishedAt: item.pubDate ? parseNaverDate(item.pubDate) : undefined,
      source: "news" as const,
      providerRaw: item
    }));

    return results;
  }
}

function parseNaverDate(pubDate: string): string | undefined {
  try {
    return new Date(pubDate).toISOString();
  } catch {
    return undefined;
  }
}

export function createNaverSearchProvider(
  clientId: string | undefined,
  clientSecret: string | undefined
): NaverSearchProvider | undefined {
  if (!clientId?.trim() || !clientSecret?.trim()) {
    return undefined;
  }
  return new NaverSearchProvider(clientId.trim(), clientSecret.trim());
}
