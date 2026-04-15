export interface WebSearchQuery {
  companyName: string;
  roleName?: string;
  keywords?: readonly string[];
  maxResults?: number;
  recencyMonths?: number;
  locale?: "ko" | "en";
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: "news" | "web";
  providerRaw?: unknown;
}

export interface WebSearchProvider {
  readonly id: "naver" | "brave";
  search(query: WebSearchQuery): Promise<readonly WebSearchResult[]>;
}

export class WebSearchError extends Error {
  constructor(
    public readonly reason: "unauthorized" | "quotaExceeded" | "networkError" | "notImplemented",
    message: string
  ) {
    super(message);
    this.name = "WebSearchError";
  }
}
