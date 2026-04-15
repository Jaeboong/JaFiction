import { WebSearchError, WebSearchProvider, WebSearchQuery, WebSearchResult } from "./provider";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const FETCH_TIMEOUT_MS = 10_000;

type BraveFreshness = "pw" | "pm" | "py";

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
  page_age?: string;
  meta_url?: { netloc?: string };
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
  news?: { results?: BraveWebResult[] };
}

function recencyMonthsToFreshness(months: number): BraveFreshness {
  if (months <= 3) return "pw";
  if (months <= 6) return "pm";
  return "py";
}

async function searchBrave(
  query: string,
  apiKey: string,
  count: number,
  freshness: BraveFreshness
): Promise<BraveWebResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    freshness
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      throw new WebSearchError("unauthorized", `Brave API auth failed: ${response.status}`);
    }
    if (response.status === 429) {
      throw new WebSearchError("quotaExceeded", "Brave API quota exceeded");
    }
    if (!response.ok) {
      throw new WebSearchError("networkError", `Brave API error: ${response.status}`);
    }

    const data = await response.json() as BraveSearchResponse;
    const news = data.news?.results ?? [];
    const web = data.web?.results ?? [];
    return [...news, ...web];
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof WebSearchError) throw error;
    throw new WebSearchError("networkError", error instanceof Error ? error.message : String(error));
  }
}

export class BraveSearchProvider implements WebSearchProvider {
  readonly id = "brave" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: WebSearchQuery): Promise<readonly WebSearchResult[]> {
    const searchQuery = [query.companyName, query.roleName].filter(Boolean).join(" ");
    const freshness = recencyMonthsToFreshness(query.recencyMonths ?? 9);
    const count = query.maxResults ?? 10;

    const items = await searchBrave(searchQuery, this.apiKey, count, freshness);

    return items.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description ?? "",
      publishedAt: item.page_age ? parseBraveDate(item.page_age) : undefined,
      source: "web" as const,
      providerRaw: item
    }));
  }
}

function parseBraveDate(pageAge: string): string | undefined {
  try {
    return new Date(pageAge).toISOString();
  } catch {
    return undefined;
  }
}

export function createBraveSearchProvider(apiKey: string | undefined): BraveSearchProvider | undefined {
  if (!apiKey?.trim()) return undefined;
  return new BraveSearchProvider(apiKey.trim());
}
