import { FetcherError, type JobPostingFetcher, type JobPostingFetchOptions, type JobPostingFetchResponse } from "./types";

export const DEFAULT_STATIC_HEADERS: Record<string, string> = {
  "user-agent": "ForJob/0.1.1 (+https://github.com/Jaeboong/CoordinateAI)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
};

export interface StaticFetcherOptions {
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export class StaticFetcher implements JobPostingFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: StaticFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? DEFAULT_STATIC_HEADERS;
  }

  async fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse> {
    const headers = { ...this.headers, ...(options?.headersOverride ?? {}) };
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers, signal: options?.signal });
    } catch (cause) {
      throw new FetcherError("지원 공고 요청 중 네트워크 오류가 발생했습니다.", {
        kind: "network",
        requestUrl: url,
        cause
      });
    }

    const html = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (!response.ok) {
      throw new FetcherError(`지원 공고를 가져오지 못했습니다 (${response.status}).`, {
        kind: "http",
        requestUrl: url,
        finalUrl: response.url || url,
        status: response.status,
        statusText: response.statusText || undefined,
        responseHeaders,
        bodySnippet: summarizeBody(html)
      });
    }

    return {
      html,
      status: response.status,
      statusText: response.statusText || undefined,
      finalUrl: response.url || url,
      responseHeaders,
      fetcherKind: "static"
    };
  }
}

function summarizeBody(body: string, limit = 512): string | undefined {
  const normalized = body.replace(/\s+/g, " ").trim().slice(0, limit);
  return normalized || undefined;
}
