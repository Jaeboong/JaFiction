import type { SiteAdapter, SiteAdapterMatch } from "./types";

const registeredAdapters: SiteAdapter[] = [];

export function registerSiteAdapter(adapter: SiteAdapter): void {
  registeredAdapters.push(adapter);
}

export function findMatchingAdapter(url: string): { adapter: SiteAdapter; match: SiteAdapterMatch } | undefined {
  for (const adapter of registeredAdapters) {
    const match = adapter.match(url);
    if (match) {
      return { adapter, match };
    }
  }

  return undefined;
}

export function resetAdaptersForTesting(): void {
  registeredAdapters.length = 0;
}
