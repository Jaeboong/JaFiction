export interface JobPostingFetchOptions {
  signal?: AbortSignal;
  headersOverride?: Record<string, string>;
}

export interface JobPostingFetchResponse {
  html: string;
  status: number;
  statusText?: string;
  finalUrl: string;
  responseHeaders: Record<string, string>;
  fetcherKind: "static" | "browser";
}

export interface JobPostingFetcher {
  fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse>;
  close?(): Promise<void>;
}

export interface FetcherErrorInfo {
  kind: "network" | "http" | "timeout" | "browser";
  requestUrl: string;
  finalUrl?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  bodySnippet?: string;
  cause?: unknown;
}

export class FetcherError extends Error {
  readonly info: FetcherErrorInfo;

  constructor(message: string, info: FetcherErrorInfo) {
    super(message);
    this.name = "FetcherError";
    this.info = info;

    if (info.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: info.cause,
        enumerable: false,
        configurable: true
      });
    }
  }
}

export function isFetcherError(error: unknown): error is FetcherError {
  return error instanceof FetcherError;
}
