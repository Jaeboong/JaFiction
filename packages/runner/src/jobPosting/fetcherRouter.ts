import { FetcherError, StaticFetcher, type JobPostingFetcher, type JobPostingFetchOptions, type JobPostingFetchResponse } from "@jasojeon/shared";
import { PuppeteerFetcher } from "./puppeteerFetcher";

export const SPA_HOSTS = ["jumpit.saramin.co.kr"] as const;

export interface FetcherRouterLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface FetcherRouterConfig {
  puppeteerEnabled: boolean;
  spaHosts?: readonly string[];
  staticFetcher?: JobPostingFetcher;
  puppeteerFetcher?: JobPostingFetcher;
  logger?: FetcherRouterLogger;
}

export function resolveSpaHosts(extraEnv?: string): readonly string[] {
  const envHosts = (extraEnv ?? process.env["JASOJEON_SPA_HOSTS"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set<string>([...SPA_HOSTS, ...envHosts]));
}

export function createFetcherRouter(config: FetcherRouterConfig): JobPostingFetcher {
  const spaHosts = (config.spaHosts ?? resolveSpaHosts()).map((host) => host.toLowerCase());
  const staticFetcher = config.staticFetcher ?? new StaticFetcher();
  let puppeteerFetcher: JobPostingFetcher | null = config.puppeteerEnabled
    ? (config.puppeteerFetcher ?? new PuppeteerFetcher())
    : null;
  const logger = config.logger ?? console;

  return {
    async fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse> {
      if (!isSpaHost(url, spaHosts)) {
        return staticFetcher.fetch(url, options);
      }

      if (!puppeteerFetcher) {
        logger.warn("[fetcherRouter] SPA host requested but PUPPETEER_ENABLED=false; falling back to static", { url });
        return staticFetcher.fetch(url, options);
      }

      try {
        return await puppeteerFetcher.fetch(url, options);
      } catch (error) {
        logger.warn("[fetcherRouter] Puppeteer fetch failed; falling back to static", {
          url,
          reason: error instanceof FetcherError ? error.info.kind : "unknown"
        });
        return staticFetcher.fetch(url, options);
      }
    },
    async close(): Promise<void> {
      const activeFetcher = puppeteerFetcher;
      puppeteerFetcher = null;
      if (activeFetcher?.close) {
        await activeFetcher.close();
      }
    }
  };
}

function isSpaHost(url: string, spaHosts: readonly string[]): boolean {
  try {
    return spaHosts.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
