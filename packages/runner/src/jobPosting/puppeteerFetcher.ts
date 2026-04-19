import {
  FetcherError,
  type JobPostingFetcher,
  type JobPostingFetchOptions,
  type JobPostingFetchResponse
} from "@jasojeon/shared";

export interface PuppeteerLike {
  launch(options?: { headless?: "new" | boolean; args?: string[] }): Promise<BrowserLike>;
}

export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<ResponseLike | null>;
  content(): Promise<string>;
  url(): string;
  setUserAgent(userAgent: string): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  close(): Promise<void>;
}

export interface ResponseLike {
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
  url(): string;
}

export interface PuppeteerFetcherOptions {
  puppeteerModule?: PuppeteerLike;
  timeoutMs?: number;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  launchArgs?: string[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_EXTRA_HEADERS = {
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
};
const DEFAULT_LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"];

export class PuppeteerFetcher implements JobPostingFetcher {
  private browser: BrowserLike | null = null;
  private launching: Promise<BrowserLike> | null = null;
  private readonly puppeteerModule: PuppeteerLike;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly launchArgs: string[];

  constructor(options: PuppeteerFetcherOptions = {}) {
    this.puppeteerModule = options.puppeteerModule ?? loadPuppeteerModule();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.extraHeaders = options.extraHeaders ?? DEFAULT_EXTRA_HEADERS;
    this.launchArgs = options.launchArgs ?? DEFAULT_LAUNCH_ARGS;
  }

  async fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse> {
    let page: PageLike | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setExtraHTTPHeaders({
        ...this.extraHeaders,
        ...(options?.headersOverride ?? {})
      });

      const response = await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.timeoutMs
      });
      if (!response) {
        throw new FetcherError("Puppeteer page.goto returned null.", {
          kind: "browser",
          requestUrl: url
        });
      }

      const html = await page.content();
      const finalUrl = page.url() || response.url() || url;
      const status = response.status();
      const statusText = response.statusText() || undefined;
      const responseHeaders = response.headers();
      if (status < 200 || status >= 400) {
        throw new FetcherError(`Puppeteer 지원 공고 응답 비정상 (${status}).`, {
          kind: "http",
          requestUrl: url,
          finalUrl,
          status,
          statusText,
          responseHeaders,
          bodySnippet: summarizeBody(html)
        });
      }

      return {
        html,
        status,
        statusText,
        finalUrl,
        responseHeaders,
        fetcherKind: "browser"
      };
    } catch (error) {
      if (error instanceof FetcherError) {
        throw error;
      }
      throw new FetcherError("Puppeteer fetch 실패.", {
        kind: "browser",
        requestUrl: url,
        cause: error
      });
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
    }
  }

  async close(): Promise<void> {
    const activeBrowser = this.browser;
    const activeLaunch = this.launching;
    this.browser = null;
    this.launching = null;

    if (activeBrowser) {
      await activeBrowser.close().catch(() => undefined);
      return;
    }

    if (activeLaunch) {
      const launchedBrowser = await activeLaunch.catch(() => null);
      if (launchedBrowser) {
        await launchedBrowser.close().catch(() => undefined);
      }
    }
  }

  private async getBrowser(): Promise<BrowserLike> {
    if (this.browser) {
      return this.browser;
    }
    if (this.launching) {
      return this.launching;
    }

    this.launching = this.puppeteerModule.launch({
      headless: "new",
      args: this.launchArgs
    }).then((browser) => {
      this.browser = browser;
      this.launching = null;
      return browser;
    }).catch((error) => {
      this.launching = null;
      throw error;
    });

    return this.launching;
  }
}

function loadPuppeteerModule(): PuppeteerLike {
  return require("puppeteer") as PuppeteerLike;
}

function summarizeBody(body: string, limit = 512): string | undefined {
  const normalized = body.replace(/\s+/g, " ").trim().slice(0, limit);
  return normalized || undefined;
}
