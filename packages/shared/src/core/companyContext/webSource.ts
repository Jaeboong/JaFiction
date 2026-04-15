import { WebSearchProvider, WebSearchQuery, WebSearchResult } from "../webSearch/provider";
import { nowIso } from "../utils";
import { WebSourcePayload, CompanyContextHints } from "./types";
import { buildCacheEntry, readWebSearchCache, writeWebSearchCache } from "./cache";

const MAX_SNIPPET_LENGTH = 400;
const MAX_RESULTS = 10;

export async function fetchWebSource(
  hints: CompanyContextHints,
  provider: WebSearchProvider | undefined,
  cacheTtlDays: number,
  storageRoot?: string
): Promise<WebSourcePayload> {
  const fetchedAt = nowIso();

  if (!provider) {
    return {
      fetchedAt,
      entries: [],
      snippets: [],
      notes: ["webSearch: provider not configured"]
    };
  }

  // 캐시 hit 확인
  if (storageRoot) {
    const cached = await readWebSearchCache(storageRoot, hints.companyName, provider.id);
    if (cached) {
      return normalizeResults(cached.results, provider.id, cached.fetchedAt, []);
    }
  }

  const query: WebSearchQuery = {
    companyName: hints.companyName,
    roleName: hints.roleName,
    keywords: hints.keywords,
    maxResults: MAX_RESULTS,
    recencyMonths: 9,
    locale: "ko"
  };

  try {
    const results = await provider.search(query);
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - (query.recencyMonths ?? 9));

    const filtered = results.filter((result) => {
      if (!result.publishedAt) return true;
      try {
        return new Date(result.publishedAt) >= cutoffDate;
      } catch {
        return true;
      }
    });

    const seen = new Set<string>();
    const deduped = filtered.filter((result) => {
      try {
        const key = new URL(result.url).origin + new URL(result.url).pathname;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      } catch {
        return true;
      }
    });

    const sliced = deduped.slice(0, MAX_RESULTS);

    // 결과 캐시 저장 (write-through, 성공한 경우만)
    if (storageRoot && sliced.length > 0) {
      const entry = buildCacheEntry(hints.companyName, provider.id, {
        companyName: query.companyName,
        roleName: query.roleName,
        keywords: query.keywords
      }, sliced, cacheTtlDays);
      await writeWebSearchCache(storageRoot, entry).catch(() => {
        // 캐시 쓰기 실패는 무시
      });
    }

    return normalizeResults(sliced, provider.id, fetchedAt, []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      providerId: provider.id,
      fetchedAt,
      entries: [],
      snippets: [],
      notes: [`webSearch: provider error: ${message}`]
    };
  }
}

function normalizeResults(
  results: readonly import("../webSearch/provider").WebSearchResult[],
  providerId: "naver" | "brave",
  fetchedAt: string,
  notes: readonly string[]
): WebSourcePayload {
  const entries = results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet.slice(0, MAX_SNIPPET_LENGTH),
    publishedAt: result.publishedAt,
    source: result.source
  }));

  const snippets = entries.map((entry, index) => ({
    sourceId: `web-search-${index}`,
    sourceKind: entry.source === "news" ? "webNews" as const : "webGeneral" as const,
    sectionLabel: "growth-direction" as const,
    text: `[${entry.title}] ${entry.snippet}`.slice(0, MAX_SNIPPET_LENGTH),
    confidence: "medium" as const,
    publishedAt: entry.publishedAt,
    sourceTier: "contextual" as const
  }));

  return { providerId, fetchedAt, entries, snippets, notes };
}
