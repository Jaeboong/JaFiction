# P2 Chunk 0.5 — Puppeteer Fetcher 인프라 상세 구현 Plan

**Status:** confirmed (2026-04-19)
**Parent plan:** `docs/plans/2026-04-19-posting-parser-p2-major-adapters.md` §5 Chunk 0.5
**Branch:** `feat/p2-posting-parser-adapters` (HEAD 기준)
**Scope:** 단일 커밋 타겟 — JobPostingFetcher 인터페이스 + StaticFetcher (shared) + PuppeteerFetcher + fetcherRouter (runner).

> **테스트 프레임워크 보정 (중요)**: 실제 레포는 Vitest 가 아니라 `node:test` + `node:assert/strict` + tsc 선컴파일 방식이다 (`packages/{shared,runner}/package.json` 의 `test` 스크립트가 `tsc -p tsconfig.json && node --test dist/test/*.test.js`). `vi.mock("puppeteer", ...)` 등 Vitest 전용 API 사용 금지. Puppeteer mock 전략은 **DI (constructor-injected puppeteer module)** 로 확정. `require.cache` 조작 금지.

---

## 0. 배경·범위 요약

- P2 master plan §5 Chunk 0.5 의 구체화. **단일 커밋** 대상.
- 목적: `fetchAndExtractJobPosting` 의 raw `fetch()` 호출을 `JobPostingFetcher` 인터페이스 뒤로 숨기고, runner 쪽에서 SPA 호스트에 한해 Puppeteer 기반 fetcher 를 주입한다.
- 비범위: jobplanet/rememberapp/saramin 어댑터 구현, SPA 인터랙션 (login/form), macOS/Linux 실동작 확인, RunnerConfig 구조 개편.

---

## 1. 결정 포인트 (모두 확정)

| # | 결정 | 근거 (3줄) |
|---|---|---|
| D1 | Puppeteer 라이프사이클 | **인스턴스 단위 lazy singleton browser.** `fetch()` 첫 호출 시 `puppeteer.launch()` 실행 후 `browser` 필드에 보관, 이후 재사용. `close()` 명시 호출 시만 종료. 150MB Chromium 재부팅 비용 크고 SPA 공고 여러 건 연속 호출 기대. |
| D2 | Puppeteer 실패 → static fallback 위치 | **router 레이어에서 try/catch.** `PuppeteerFetcher.fetch()` 는 순수 throw. `createFetcherRouter` 가 반환하는 `JobPostingFetcher.fetch()` 내부에서 Puppeteer 실패 catch → static 재시도 + warning 로그. PuppeteerFetcher 가 static instance 를 들고 있으면 shared/runner 경계 혼탁. |
| D3 | 에러 타입 | **Fetcher 레이어는 중립 `FetcherError` 만 throw, `jobPosting.ts` 가 JobPostingFetchError 로 변환.** 기존 `jobPosting.test.ts:122-185` 가 `failureKind`/`status`/`responseHeaders`/`bodySnippet`/`requestHeaders` regex 를 검증하므로 **JobPostingFetchError 시그니처·메시지 포맷 완전 유지**. shared 패키지가 Puppeteer 관련 에러 이름을 모르게 한다. |
| D4 | 기존 `fetchImpl: typeof fetch` shim 유지 | **오버로드 2개 제공.** `(request, fetchImpl?: typeof fetch)` 및 `(request, fetcher?: JobPostingFetcher)` 분기 (런타임 duck-typing: `typeof arg === "function"` → fetchImpl). 기존 5개 테스트 파일 무수정. 마이그레이션은 Chunk 5/6 에서 점진. |
| D5 | SPA 호스트 설정 위치 | **`fetcherRouter.ts` 내부 상수 `SPA_HOSTS = ["jumpit.saramin.co.kr"]`.** env var `JASOJEON_SPA_HOSTS` (comma-separated) 가 정의되어 있으면 **덮어쓰지 않고 union**. Chunk 5/6 에서 RunnerConfig 로 승격. |
| D6 | Puppeteer 의존성 위치 | **`packages/runner/package.json` `dependencies` 에 `"puppeteer": "^22.15.0"`.** (사용자 2026-04-19 승인). `optionalDependencies` 아님 — 설치 실패 시 명시 에러. shared/package.json 은 건드리지 않음. |

---

## 2. 신규 파일 설계

### 2.1 `packages/shared/src/core/jobPosting/fetcher/types.ts`

```ts
// shared — interface 전용. puppeteer import 절대 금지.

export interface JobPostingFetchOptions {
  signal?: AbortSignal;
  // 호출자별로 user-agent 등 override 하고 싶을 때 사용 (Chunk 5+ 확장 여지).
  headersOverride?: Record<string, string>;
}

export interface JobPostingFetchResponse {
  html: string;
  status: number;
  statusText?: string;
  finalUrl: string;
  /** 보안 헤더 redact 하기 전 원본. JobPostingFetchError 로 변환 시 sanitize. */
  responseHeaders: Record<string, string>;
  /** 어느 fetcher 가 처리했는지 진단용. router fallback 로깅에 사용. */
  fetcherKind: "static" | "puppeteer";
}

export interface JobPostingFetcher {
  fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse>;
  /** 런타임 리소스 해제 (Puppeteer browser 등). StaticFetcher 는 no-op. */
  close?(): Promise<void>;
}

/** 중립 에러. jobPosting.ts 가 JobPostingFetchError 로 변환. */
export interface FetcherErrorInfo {
  kind: "network" | "http" | "timeout" | "puppeteer";
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
      Object.defineProperty(this, "cause", { value: info.cause, enumerable: false, configurable: true });
    }
  }
}

export function isFetcherError(err: unknown): err is FetcherError {
  return err instanceof FetcherError;
}
```

### 2.2 `packages/shared/src/core/jobPosting/fetcher/staticFetcher.ts`

```ts
import type { JobPostingFetcher, JobPostingFetchOptions, JobPostingFetchResponse } from "./types";
import { FetcherError } from "./types";

export const DEFAULT_STATIC_HEADERS: Record<string, string> = {
  // 바이트-단위 동일해야 함. jobPosting.ts:221-225 와 일치.
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
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

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

function summarizeBody(body: string, limit = 512): string {
  return body.replace(/\s+/g, " ").trim().slice(0, limit);
}
```

### 2.3 `packages/runner/src/jobPosting/puppeteerFetcher.ts`

```ts
import type {
  JobPostingFetcher,
  JobPostingFetchOptions,
  JobPostingFetchResponse
} from "@jasojeon/shared";
import { FetcherError } from "@jasojeon/shared";

/** puppeteer 모듈 최소 타입. 실제 import 는 런타임에만. */
export interface PuppeteerLike {
  launch(opts?: { headless?: "new" | boolean; args?: string[] }): Promise<BrowserLike>;
}
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
export interface PageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<ResponseLike | null>;
  content(): Promise<string>;
  url(): string;
  setUserAgent(ua: string): Promise<void>;
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
  /** 테스트에서 DI. 기본은 require("puppeteer"). */
  puppeteerModule?: PuppeteerLike;
  timeoutMs?: number;  // default 15000
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  launchArgs?: string[]; // default ["--no-sandbox","--disable-dev-shm-usage"]
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class PuppeteerFetcher implements JobPostingFetcher {
  private browser: BrowserLike | null = null;
  private launching: Promise<BrowserLike> | null = null;
  private readonly puppeteerModule: PuppeteerLike;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly launchArgs: string[];

  constructor(options: PuppeteerFetcherOptions = {}) {
    this.puppeteerModule = options.puppeteerModule ?? (require("puppeteer") as PuppeteerLike);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.extraHeaders = options.extraHeaders ?? { "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" };
    this.launchArgs = options.launchArgs ?? ["--no-sandbox", "--disable-dev-shm-usage"];
  }

  private async getBrowser(): Promise<BrowserLike> {
    if (this.browser) return this.browser;
    if (this.launching) return this.launching;
    this.launching = this.puppeteerModule.launch({ headless: "new", args: this.launchArgs })
      .then((b) => { this.browser = b; this.launching = null; return b; })
      .catch((err) => { this.launching = null; throw err; });
    return this.launching;
  }

  async fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse> {
    let page: PageLike | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      await page.setUserAgent(this.userAgent);
      await page.setExtraHTTPHeaders({ ...this.extraHeaders, ...(options?.headersOverride ?? {}) });
      const response = await page.goto(url, { waitUntil: "networkidle2", timeout: this.timeoutMs });
      if (!response) {
        throw new FetcherError("Puppeteer page.goto returned null (redirect loop or blocked).", {
          kind: "puppeteer",
          requestUrl: url
        });
      }
      const html = await page.content();
      const finalUrl = page.url() || response.url() || url;
      const status = response.status();
      const statusText = response.statusText();
      const responseHeaders = response.headers();
      if (status < 200 || status >= 400) {
        throw new FetcherError(`Puppeteer 지원 공고 응답 비정상 (${status}).`, {
          kind: "http",
          requestUrl: url,
          finalUrl,
          status,
          statusText: statusText || undefined,
          responseHeaders,
          bodySnippet: html.replace(/\s+/g, " ").trim().slice(0, 512)
        });
      }
      return {
        html, status, statusText: statusText || undefined, finalUrl, responseHeaders,
        fetcherKind: "puppeteer"
      };
    } catch (err) {
      if (err instanceof FetcherError) throw err;
      throw new FetcherError("Puppeteer fetch 실패.", {
        kind: "puppeteer",
        requestUrl: url,
        cause: err
      });
    } finally {
      if (page) { await page.close().catch(() => {}); }
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    this.launching = null;
    if (b) await b.close().catch(() => {});
  }
}
```

### 2.4 `packages/runner/src/jobPosting/fetcherRouter.ts`

```ts
import type { JobPostingFetcher, JobPostingFetchOptions, JobPostingFetchResponse } from "@jasojeon/shared";
import { StaticFetcher, FetcherError } from "@jasojeon/shared";
import { PuppeteerFetcher } from "./puppeteerFetcher";

export const SPA_HOSTS = ["jumpit.saramin.co.kr"] as const;

export interface FetcherRouterConfig {
  puppeteerEnabled: boolean;
  spaHosts?: readonly string[];
  /** 테스트 DI */
  staticFetcher?: JobPostingFetcher;
  puppeteerFetcher?: JobPostingFetcher;
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export function resolveSpaHosts(extraEnv?: string): readonly string[] {
  const envList = (extraEnv ?? process.env.JASOJEON_SPA_HOSTS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set<string>([...SPA_HOSTS, ...envList]));
}

export function createFetcherRouter(config: FetcherRouterConfig): JobPostingFetcher {
  const spaHosts = config.spaHosts ?? resolveSpaHosts();
  const staticFetcher = config.staticFetcher ?? new StaticFetcher();
  let puppeteer: JobPostingFetcher | null =
    config.puppeteerEnabled ? (config.puppeteerFetcher ?? new PuppeteerFetcher()) : null;
  const logger = config.logger ?? console;

  function isSpaHost(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return spaHosts.includes(host);
    } catch { return false; }
  }

  return {
    async fetch(url: string, options?: JobPostingFetchOptions): Promise<JobPostingFetchResponse> {
      const spa = isSpaHost(url);
      if (spa && !puppeteer) {
        logger.warn("[fetcherRouter] SPA host requested but PUPPETEER_ENABLED=false; falling back to static", { url });
        return staticFetcher.fetch(url, options);
      }
      if (spa && puppeteer) {
        try {
          return await puppeteer.fetch(url, options);
        } catch (err) {
          logger.warn("[fetcherRouter] Puppeteer fetch failed; falling back to static", {
            url,
            reason: err instanceof FetcherError ? err.info.kind : "unknown"
          });
          return staticFetcher.fetch(url, options);
        }
      }
      return staticFetcher.fetch(url, options);
    },
    async close(): Promise<void> {
      const target = puppeteer;
      puppeteer = null;
      if (target?.close) await target.close();
    }
  };
}
```

---

## 3. 수정 파일 설계

### 3.1 `packages/shared/src/core/jobPosting.ts`

**변경 지점**: 200-258행.

```ts
import { StaticFetcher } from "./jobPosting/fetcher/staticFetcher";
import type { JobPostingFetcher } from "./jobPosting/fetcher/types";
import { FetcherError, isFetcherError } from "./jobPosting/fetcher/types";

// D4: 오버로드 + duck-typing
export async function fetchAndExtractJobPosting(
  request: JobPostingExtractionRequest,
  fetcherOrFetchImpl?: JobPostingFetcher | typeof fetch
): Promise<JobPostingExtractionResult> {
  const manualText = request.jobPostingText?.trim();
  if (manualText) { /* ...기존 코드 동일... */ }

  const jobPostingUrl = request.jobPostingUrl?.trim();
  if (!jobPostingUrl) throw new Error("지원 공고 URL 또는 수동 입력 텍스트가 필요합니다.");
  if (!/^https?:\/\//i.test(jobPostingUrl))
    throw new Error("지원 공고 URL은 http 또는 https로 시작해야 합니다.");

  const fetcher: JobPostingFetcher = resolveFetcher(fetcherOrFetchImpl);
  const requestHeaders = {
    "user-agent": "ForJob/0.1.1 (+https://github.com/Jaeboong/CoordinateAI)",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  let fetchResult;
  try {
    fetchResult = await fetcher.fetch(jobPostingUrl);
  } catch (err) {
    if (isFetcherError(err)) throw convertFetcherError(err, jobPostingUrl, requestHeaders);
    throw err;
  }

  const { html, finalUrl } = fetchResult;
  // 기존 embeddedSource / jsonLdFields / adapterLookup / ... 흐름 그대로
  // response.url 대신 fetchResult.finalUrl, response.text() 대신 fetchResult.html 사용.
  // (기존 229-258행 대체)
  // ...
}

function resolveFetcher(arg?: JobPostingFetcher | typeof fetch): JobPostingFetcher {
  if (!arg) return new StaticFetcher();
  if (typeof arg === "function") return new StaticFetcher({ fetchImpl: arg });
  return arg;
}

function convertFetcherError(
  err: FetcherError,
  requestUrl: string,
  requestHeaders: Record<string, string>
): JobPostingFetchError {
  const info = err.info;
  if (info.kind === "network" || info.kind === "puppeteer" || info.kind === "timeout") {
    return new JobPostingFetchError("지원 공고 요청 중 네트워크 오류가 발생했습니다.", {
      occurredAt: nowIso(),
      failureKind: "network",
      requestUrl,
      requestHeaders: sanitizeHeaders(requestHeaders)
    }, { cause: info.cause ?? err });
  }
  // kind === "http"
  return new JobPostingFetchError(err.message, {
    occurredAt: nowIso(),
    failureKind: "http",
    requestUrl,
    finalUrl: info.finalUrl || requestUrl,
    status: info.status,
    statusText: info.statusText,
    requestHeaders: sanitizeHeaders(requestHeaders),
    responseHeaders: info.responseHeaders ? sanitizeHeaders(info.responseHeaders) : undefined,
    bodySnippet: info.bodySnippet
  });
}
```

**중요한 제약 (regression 방지)**:
- 네트워크 에러 메시지 `"지원 공고 요청 중 네트워크 오류가 발생했습니다."` 완전 유지 (test L181)
- HTTP 에러 메시지에 `"(500)"` 같은 status 포함 유지 (test L154 `assert.match(error.message, /500/)`)
- `requestHeaders["user-agent"]` regex `/^ForJob\/0\.1\.\d+ \(\+https:\/\/github\.com\/Jaeboong\/CoordinateAI\)$/` 만족 (test L178). **StaticFetcher 의 헤더는 jobPosting.ts 의 requestHeaders 와 바이트-단위 동일**해야 함.
- `responseHeaders["set-cookie"]` 가 `[redacted]` 로 나와야 함 (test L152) → sanitizeHeaders 기존 로직 재사용.

### 3.2 `packages/shared/src/index.ts`

아래 export 추가 (이미 있는 export 섹션에 끼워넣기):

```ts
export { StaticFetcher, DEFAULT_STATIC_HEADERS } from "./core/jobPosting/fetcher/staticFetcher";
export { FetcherError, isFetcherError } from "./core/jobPosting/fetcher/types";
export type {
  JobPostingFetcher,
  JobPostingFetchOptions,
  JobPostingFetchResponse,
  FetcherErrorInfo
} from "./core/jobPosting/fetcher/types";
```

### 3.3 `packages/runner/src/runnerContext.ts` (또는 동급)

- `RunnerContext` 타입에 `jobPostingFetcher: JobPostingFetcher` 필드 추가
- `createRunnerContext(...)` 에서 1회 `createFetcherRouter({ puppeteerEnabled: process.env.PUPPETEER_ENABLED === "true" })` 생성 + 주입
- 프로세스 종료 훅 (SIGTERM 등) 에서 `ctx.jobPostingFetcher.close?.()` 호출

### 3.4 `packages/runner/src/routes/insightsHandlers.ts`

- L57, L113: `fetchAndExtractJobPosting({...})` → `fetchAndExtractJobPosting({...}, ctx.jobPostingFetcher)`
- 함수가 `ctx` 를 이미 받고 있는지 확인 (L49 `analyzeProjectInsightsService(ctx, input)` 은 받음 → OK, L94 `generateProjectInsightsService(ctx, ...)` 도 받음 → OK).

### 3.5 `packages/runner/src/routes/projectsHandlers.ts`

- L182 `analyzePosting(_ctx, payload)` — 현재 `_ctx` 로 무시. 이름을 `ctx` 로 바꾸고 `fetchAndExtractJobPosting({...}, ctx.jobPostingFetcher)` 로 변경.

### 3.6 `packages/runner/package.json`

```jsonc
{
  "dependencies": {
    "@jasojeon/shared": "file:../shared",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "multer": "^1.4.5-lts.2",
    "puppeteer": "^22.15.0",
    "ws": "^8.18.1",
    "zod": "^3.24.4"
  }
}
```

> Codex 에게 지시: `npm view puppeteer version` 로 최신 stable 확인 후 `^{major}.x` 로 핀. 22.x 가 없으면 최신 major 사용.

### 3.7 `packages/shared/package.json`

**건드리지 않음** (shared 는 puppeteer 모름).

---

## 4. 테스트 설계 (모두 `node:test` + `node:assert/strict`)

### 4.1 신규: `packages/shared/src/test/jobPosting.fetcher.test.ts`

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { StaticFetcher, FetcherError, isFetcherError, DEFAULT_STATIC_HEADERS } from "../core/jobPosting/fetcher/staticFetcher";

test("StaticFetcher maps 200 response into JobPostingFetchResponse", async () => {
  const fetcher = new StaticFetcher({
    fetchImpl: async (_url, _init) => new Response("<html>ok</html>", {
      status: 200, headers: { "content-type": "text/html" }
    })
  });
  const res = await fetcher.fetch("https://example.com/a");
  assert.equal(res.status, 200);
  assert.equal(res.fetcherKind, "static");
  assert.match(res.html, /ok/);
});

test("StaticFetcher throws FetcherError{kind:network} on thrown fetch", async () => {
  const fetcher = new StaticFetcher({ fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  await assert.rejects(() => fetcher.fetch("https://x/y"), (err: unknown) => {
    assert.ok(isFetcherError(err));
    assert.equal((err as FetcherError).info.kind, "network");
    return true;
  });
});

test("StaticFetcher throws FetcherError{kind:http} on non-ok response with snippet + headers", async () => {
  const fetcher = new StaticFetcher({
    fetchImpl: async () => new Response("<html>denied</html>", {
      status: 500, statusText: "Internal Server Error",
      headers: { "x-request-id": "r1", "set-cookie": "s=1" }
    })
  });
  await assert.rejects(() => fetcher.fetch("https://x/y"), (err: unknown) => {
    assert.ok(isFetcherError(err));
    const info = (err as FetcherError).info;
    assert.equal(info.kind, "http");
    assert.equal(info.status, 500);
    assert.equal(info.statusText, "Internal Server Error");
    assert.equal(info.responseHeaders?.["x-request-id"], "r1");
    // StaticFetcher 는 raw 헤더만 전달 (redact 는 jobPosting.ts 가 담당)
    assert.equal(info.responseHeaders?.["set-cookie"], "s=1");
    assert.match(info.bodySnippet ?? "", /denied/);
    return true;
  });
});

test("StaticFetcher default headers match ForJob user-agent contract", async () => {
  let observed: Record<string, string> | undefined;
  const fetcher = new StaticFetcher({
    fetchImpl: async (_u, init) => {
      observed = init?.headers as Record<string, string>;
      return new Response("x", { status: 200 });
    }
  });
  await fetcher.fetch("https://x/");
  assert.match(observed!["user-agent"], /^ForJob\/0\.1\.\d+ \(\+https:\/\/github\.com\/Jaeboong\/CoordinateAI\)$/);
  assert.equal(observed!["accept-language"], DEFAULT_STATIC_HEADERS["accept-language"]);
});

test("StaticFetcher headersOverride merges per-call", async () => {
  let observed: Record<string, string> | undefined;
  const fetcher = new StaticFetcher({
    fetchImpl: async (_u, init) => { observed = init?.headers as Record<string, string>; return new Response("x", { status: 200 }); }
  });
  await fetcher.fetch("https://x/", { headersOverride: { "x-test": "1" } });
  assert.equal(observed!["x-test"], "1");
  assert.match(observed!["user-agent"], /ForJob/);
});
```

### 4.2 신규: `packages/runner/src/test/puppeteerFetcher.test.ts`

**DI 로 puppeteer stub 주입** (D1 메모). `vi.mock` 사용 금지.

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { PuppeteerFetcher } from "../jobPosting/puppeteerFetcher";
import { isFetcherError } from "@jasojeon/shared";

function createStubPuppeteer(overrides: Partial<{
  gotoImpl: (url: string) => unknown;
  contentImpl: () => string;
  statusImpl: () => number;
  throwOnLaunch: boolean;
}> = {}) {
  const closed: string[] = [];
  const calls: Record<string, number> = { launch: 0, newPage: 0, goto: 0, content: 0 };
  const stub = {
    launch: async () => {
      calls.launch++;
      if (overrides.throwOnLaunch) throw new Error("launch failed");
      return {
        newPage: async () => {
          calls.newPage++;
          return {
            setUserAgent: async () => {},
            setExtraHTTPHeaders: async () => {},
            goto: async (url: string) => {
              calls.goto++;
              if (overrides.gotoImpl) return overrides.gotoImpl(url);
              return {
                status: () => overrides.statusImpl?.() ?? 200,
                statusText: () => "OK",
                headers: () => ({ "content-type": "text/html" }),
                url: () => url
              };
            },
            content: async () => { calls.content++; return overrides.contentImpl?.() ?? "<html>ok</html>"; },
            url: () => "https://jumpit.saramin.co.kr/position/123",
            close: async () => { closed.push("page"); }
          };
        },
        close: async () => { closed.push("browser"); }
      };
    }
  };
  return { stub, closed, calls };
}

test("PuppeteerFetcher reuses browser across calls (singleton lazy init)", async () => {
  const { stub, calls } = createStubPuppeteer();
  const f = new PuppeteerFetcher({ puppeteerModule: stub as any });
  await f.fetch("https://jumpit.saramin.co.kr/a");
  await f.fetch("https://jumpit.saramin.co.kr/b");
  assert.equal(calls.launch, 1, "browser launched once");
  assert.equal(calls.newPage, 2);
  await f.close();
});

test("PuppeteerFetcher returns 200 response with final url and html", async () => {
  const { stub } = createStubPuppeteer({ contentImpl: () => "<html>hello</html>" });
  const f = new PuppeteerFetcher({ puppeteerModule: stub as any });
  const r = await f.fetch("https://jumpit.saramin.co.kr/x");
  assert.equal(r.status, 200);
  assert.equal(r.fetcherKind, "puppeteer");
  assert.match(r.html, /hello/);
  assert.match(r.finalUrl, /jumpit\.saramin\.co\.kr/);
  await f.close();
});

test("PuppeteerFetcher throws FetcherError on non-2xx", async () => {
  const { stub } = createStubPuppeteer({ statusImpl: () => 500 });
  const f = new PuppeteerFetcher({ puppeteerModule: stub as any });
  await assert.rejects(() => f.fetch("https://jumpit.saramin.co.kr/y"), (err: unknown) => {
    assert.ok(isFetcherError(err));
    assert.equal((err as any).info.kind, "http");
    assert.equal((err as any).info.status, 500);
    return true;
  });
  await f.close();
});

test("PuppeteerFetcher throws FetcherError{kind:puppeteer} on goto failure", async () => {
  const { stub } = createStubPuppeteer({ gotoImpl: () => { throw new Error("timeout"); } });
  const f = new PuppeteerFetcher({ puppeteerModule: stub as any });
  await assert.rejects(() => f.fetch("https://jumpit.saramin.co.kr/z"), (err: unknown) => {
    assert.ok(isFetcherError(err));
    assert.equal((err as any).info.kind, "puppeteer");
    return true;
  });
  await f.close();
});

test("PuppeteerFetcher close() is idempotent and allows relaunch", async () => {
  const { stub, calls } = createStubPuppeteer();
  const f = new PuppeteerFetcher({ puppeteerModule: stub as any });
  await f.fetch("https://jumpit.saramin.co.kr/a");
  await f.close();
  await f.close(); // no throw
  await f.fetch("https://jumpit.saramin.co.kr/b");
  assert.equal(calls.launch, 2, "relaunched after close");
  await f.close();
});
```

### 4.3 신규: `packages/runner/src/test/fetcherRouter.test.ts`

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import { createFetcherRouter, SPA_HOSTS, resolveSpaHosts } from "../jobPosting/fetcherRouter";
import { FetcherError, type JobPostingFetcher } from "@jasojeon/shared";

function stubFetcher(label: "static" | "puppeteer", impl?: (url: string) => Promise<any> | any): JobPostingFetcher {
  return {
    async fetch(url) {
      const res = impl ? await impl(url) : null;
      if (res instanceof Error) throw res;
      return { html: `<${label}>`, status: 200, finalUrl: url, responseHeaders: {}, fetcherKind: label, statusText: "OK" };
    },
    async close() {}
  };
}

test("router routes non-SPA hosts to static", async () => {
  const s = stubFetcher("static"), p = stubFetcher("puppeteer");
  const r = createFetcherRouter({ puppeteerEnabled: true, staticFetcher: s, puppeteerFetcher: p });
  const res = await r.fetch("https://www.wanted.co.kr/wd/1");
  assert.equal(res.fetcherKind, "static");
});

test("router routes SPA host + enabled to puppeteer", async () => {
  const s = stubFetcher("static"), p = stubFetcher("puppeteer");
  const r = createFetcherRouter({ puppeteerEnabled: true, staticFetcher: s, puppeteerFetcher: p });
  const res = await r.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(res.fetcherKind, "puppeteer");
});

test("router falls back to static + warns when SPA host but flag off", async () => {
  const s = stubFetcher("static");
  const warns: string[] = [];
  const r = createFetcherRouter({
    puppeteerEnabled: false, staticFetcher: s,
    logger: { warn: (m) => warns.push(m) }
  });
  const res = await r.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(res.fetcherKind, "static");
  assert.ok(warns.some((m) => /falling back to static/.test(m)));
});

test("router falls back to static + warns when puppeteer throws", async () => {
  const s = stubFetcher("static");
  const p = stubFetcher("puppeteer", () => new FetcherError("boom", { kind: "puppeteer", requestUrl: "x" }));
  const warns: string[] = [];
  const r = createFetcherRouter({
    puppeteerEnabled: true, staticFetcher: s, puppeteerFetcher: p,
    logger: { warn: (m) => warns.push(m) }
  });
  const res = await r.fetch("https://jumpit.saramin.co.kr/position/1");
  assert.equal(res.fetcherKind, "static");
  assert.ok(warns.some((m) => /Puppeteer fetch failed/.test(m)));
});

test("resolveSpaHosts unions env JASOJEON_SPA_HOSTS", () => {
  const r = resolveSpaHosts("foo.com, bar.com ,jumpit.saramin.co.kr");
  assert.ok(r.includes("jumpit.saramin.co.kr"));
  assert.ok(r.includes("foo.com"));
  assert.ok(r.includes("bar.com"));
  assert.equal(new Set(r).size, r.length, "dedup");
});

test("SPA_HOSTS 상수는 최소 jumpit 포함", () => {
  assert.ok(SPA_HOSTS.includes("jumpit.saramin.co.kr"));
});
```

### 4.4 회귀 (무수정 유지)

- `packages/shared/src/test/jobPosting.test.ts` (전부 PASS)
- `packages/shared/src/test/jobPosting.goldens.test.ts` (6건 PASS — jobkorea ×3, greetinghr ×2, wanted ×1)
- `packages/shared/src/test/jobPosting.adapter.test.ts`
- `packages/shared/src/test/jobPosting.tier.test.ts`
- `packages/runner/src/test/insightsHandlers.lowConfidence.test.ts` (모듈 전체 monkey-patch 방식이라 영향 없음)
- `packages/runner/src/test/rpcDispatcher.test.ts`

### 4.5 수동 검증 스크립트 — `scripts/verify-puppeteer-jumpit.ts`

```ts
// bun run scripts/verify-puppeteer-jumpit.ts
// 또는 scripts/with-node.sh node_modules/tsx/dist/cli.mjs scripts/verify-puppeteer-jumpit.ts
import { PuppeteerFetcher } from "../packages/runner/src/jobPosting/puppeteerFetcher";

const TEST_URL = process.env.JUMPIT_URL
  ?? "https://jumpit.saramin.co.kr/position/38834"; // 유효 URL 하나를 run 시점에 확인

async function main() {
  const f = new PuppeteerFetcher();
  try {
    const t0 = Date.now();
    const res = await f.fetch(TEST_URL);
    const dt = Date.now() - t0;
    console.log(JSON.stringify({
      status: res.status, finalUrl: res.finalUrl, htmlLength: res.html.length,
      fetcherKind: res.fetcherKind, durationMs: dt
    }, null, 2));
    if (res.status !== 200) process.exit(1);
    if (res.html.length < 10_000) { console.error("html < 10KB"); process.exit(1); }
    if (!res.finalUrl.includes("jumpit.saramin.co.kr")) { console.error("host mismatch"); process.exit(1); }
    console.log("VERIFY OK");
  } finally {
    await f.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

**CI 포함 여부**: CI 에 넣지 **않음**. 로컬 수동 검증 전용. Chromium 다운로드 + 네트워크 호출이라 유닛 테스트 격리 원칙 위반.

---

## 5. Codex 실행 순서 (단계별 검증 커맨드)

각 단계 실패 시 **그 단계 직전 커밋 기준으로 revert + 재시도**. 단일 커밋 목표이므로 작업은 워킹 트리에서 진행하고 모든 단계 완료 후 한 번에 `git add`/`git commit`.

### Step 1: 호출 지점 확인 (READ ONLY)
```bash
# Codex grep (예상 결과와 대조)
grep -r "fetchAndExtractJobPosting" packages/
# 예상: packages/shared/src/core/jobPosting.ts (정의)
#       packages/shared/src/test/jobPosting*.test.ts (5~6 파일)
#       packages/runner/src/routes/insightsHandlers.ts (L8, L57, L113)
#       packages/runner/src/routes/projectsHandlers.ts (L33, L182)
#       packages/runner/src/test/insightsHandlers.lowConfidence.test.ts (monkey-patch)
```
**성공 판정**: 위 파일 목록과 일치. 누락 시 중단.

### Step 2: shared fetcher 인프라 작성
- `types.ts`, `staticFetcher.ts` 작성
- `packages/shared/src/index.ts` export 추가
- **검증**:
  ```bash
  cd packages/shared && ../../scripts/with-node.sh ../../node_modules/typescript/lib/tsc.js -p tsconfig.json
  ../../scripts/with-node.sh --test dist/test/jobPosting.fetcher.test.js
  ```
- **성공 판정**: 새 테스트 5개 PASS, 기존 tsc 빌드 에러 0.

### Step 3: jobPosting.ts 리팩터 (StaticFetcher 경유)
- `fetchAndExtractJobPosting` 시그니처 오버로드 + `resolveFetcher` + `convertFetcherError` 추가.
- 229-258행을 fetcher.fetch 기반으로 교체.
- **검증**:
  ```bash
  cd packages/shared && ../../scripts/with-node.sh ../../node_modules/typescript/lib/tsc.js -p tsconfig.json
  ../../scripts/with-node.sh --test dist/test/*.test.js
  ```
- **성공 판정**: 기존 6 goldens PASS, jobPosting.test.ts 전체 PASS (특히 L122-185 diagnostics/네트워크/header regex 테스트), adapter/tier/crossValidate/jsonLd 테스트 PASS.

### Step 4: runner puppeteerFetcher + fetcherRouter + 의존성
- `packages/runner/src/jobPosting/puppeteerFetcher.ts`, `fetcherRouter.ts` 작성.
- `packages/runner/package.json` 에 `puppeteer` 추가.
- **설치**:
  ```bash
  cd C:/Project/Jasojeon
  ./scripts/with-npm.sh install
  # Chromium 다운로드 포함. 첫 실행은 5~10분 소요 가능.
  ```
- **검증**:
  ```bash
  cd packages/runner && ../../scripts/with-node.sh ../../node_modules/typescript/lib/tsc.js -p tsconfig.json
  ../../scripts/with-node.sh --test dist/test/puppeteerFetcher.test.js dist/test/fetcherRouter.test.js
  ```
- **성공 판정**: 신규 단위 테스트 (puppeteer 5개 + router 6개) PASS. 실제 Chromium 비실행 확인 (stub 주입).

### Step 5: runner 호출 지점 수정
- `runnerContext.ts` 에 `jobPostingFetcher` 필드 + 초기화.
- `insightsHandlers.ts` L57, L113 → `ctx.jobPostingFetcher` 2번째 arg.
- `projectsHandlers.ts` L182 → 동일.
- 프로세스 종료 훅에 `ctx.jobPostingFetcher.close?.()` 연결.
- **검증**:
  ```bash
  cd C:/Project/Jasojeon && ./scripts/check.sh
  ```
- **성공 판정**: test-all 통과. Windows EBUSY 7건 (runner 빌드 파일 lock) 은 기존 이슈로 무시. 그 외 신규 실패 0.

### Step 6: 실제 Chromium 1건 검증
- `scripts/verify-puppeteer-jumpit.ts` 작성 (§4.5) + URL 환경변수화.
- **실행**:
  ```bash
  JUMPIT_URL="https://jumpit.saramin.co.kr/position/<live-id>" \
    ./scripts/with-node.sh node_modules/tsx/dist/cli.mjs scripts/verify-puppeteer-jumpit.ts
  ```
- **성공 판정**: stdout 에 `VERIFY OK`. html length > 10000, finalUrl 에 `jumpit.saramin.co.kr` 포함, status 200.

### Step 7: runner 번들 크기 기록
- **측정**:
  ```bash
  # before (이 PR 이전 HEAD 기준) node_modules 크기
  du -sh packages/runner/node_modules  # 기록 needed (PR 전)
  # after 빌드 산출물
  du -sh packages/runner/dist
  du -sh node_modules  # puppeteer 포함 전체 monorepo
  ```
- Plan §6 성공 기준 체크리스트에 before/after 기입.
- **성공 판정**: puppeteer 설치 후 node_modules 증분이 120-200MB 범위 (Chromium 포함).

### Step 8: 커밋
```bash
git add packages/shared/src/core/jobPosting/fetcher/ \
        packages/shared/src/core/jobPosting.ts \
        packages/shared/src/index.ts \
        packages/runner/src/jobPosting/ \
        packages/runner/src/runnerContext.ts \
        packages/runner/src/routes/insightsHandlers.ts \
        packages/runner/src/routes/projectsHandlers.ts \
        packages/runner/src/test/puppeteerFetcher.test.ts \
        packages/runner/src/test/fetcherRouter.test.ts \
        packages/shared/src/test/jobPosting.fetcher.test.ts \
        packages/runner/package.json \
        package-lock.json \
        scripts/verify-puppeteer-jumpit.ts
git commit -m "feat(shared,runner): P2 Chunk 0.5 — JobPostingFetcher 인터페이스 + PuppeteerFetcher"
```

---

## 6. 성공 기준 (완료 판정 체크리스트)

- [ ] `./scripts/check.sh` 통과 (Windows EBUSY 7건 제외 신규 실패 0)
- [ ] 기존 goldens 6건 (`jobPosting.goldens.test.ts`) 전부 PASS — **snapshot JSON 변경 0 파일**
- [ ] 기존 `jobPosting.test.ts` 전 케이스 PASS (특히 header regex, 500 status message, network message, set-cookie redact)
- [ ] 신규 `jobPosting.fetcher.test.ts` 5 케이스 PASS
- [ ] 신규 `puppeteerFetcher.test.ts` 5 케이스 PASS
- [ ] 신규 `fetcherRouter.test.ts` 6 케이스 PASS
- [ ] `verify-puppeteer-jumpit.ts` 실행 시 `VERIFY OK` 출력
- [ ] PUPPETEER_ENABLED 미설정 (기본) 환경에서 runner 기동 시 static fetcher 만 사용 (`router.puppeteer === null`)
- [ ] runner 번들/node_modules 크기 before/after 기록됨 (커밋 메시지 body 또는 plan 문서 하단)
- [ ] shared 에 puppeteer import 0건 (`grep -r "from \"puppeteer\"" packages/shared` → empty)

---

## 7. Non-Goals

- jobplanet / rememberapp / saramin 어댑터 구현 (Chunk 5/6)
- Puppeteer SPA 인터랙션 (login, form submit) — GET + `page.content()` 만.
- macOS / Linux 실제 Chromium 동작 확인 — Windows 로컬 + CI 의존.
- `RunnerConfig` 구조 개편 — 환경변수 `PUPPETEER_ENABLED`, `JASOJEON_SPA_HOSTS` 만.
- Puppeteer headless/headful toggle, CDP 세션 노출 — 향후 Chunk.
- 장기 브라우저 재시작 / 메모리 누수 감시 — 운영 이슈 대비 X.

---

## 8. 리스크 · 롤백

| # | 리스크 | 감지 신호 | 롤백 |
|---|---|---|---|
| R1 | `npm install` 시 Chromium 다운로드 실패 (방화벽/프록시) | install exit != 0 또는 `browser.launch()` "Could not find Chrome" | `packages/runner/package.json` 에서 puppeteer 제거, `fetcherRouter` 의 `puppeteerEnabled` 분기는 유지 (항상 static) |
| R2 | Step 3 에서 기존 테스트 대량 회귀 (오버로드/shim 의도치 못한 타입 추론) | `jobPosting.test.ts` L57/124/162/189 중 하나라도 실패 | Step 2 결과물 보존, Step 3 revert, `resolveFetcher` 분기 조건 재설계 |
| R3 | goldens 6건 중 텍스트 diff 발생 (headers/finalUrl 처리 차이) | snapshot JSON 불일치 | goldens 편집 금지. StaticFetcher 의 헤더·finalUrl 처리가 기존 jobPosting.ts 와 바이트-단위 같게 재정렬. |
| R4 | Puppeteer 번들 → `./scripts/check.sh` 시간 +2분 이상 | `time ./scripts/check.sh` before/after 기록 | 허용. 단 10분 초과 시 runner test 스크립트에서 puppeteerFetcher.test.js 만 분리 실행 검토 (Chunk 1 별개 이슈로 승격) |
| R5 | `RunnerContext` 초기화 순서에서 puppeteer 미설치 + 플래그 on → 기동 실패 | runner 기동 로그에 "Cannot find module 'puppeteer'" | `createFetcherRouter` 내부 `new PuppeteerFetcher()` 를 try/catch 로 감싸 실패 시 null + warn. (optional 업그레이드) |
| R6 | Windows EBUSY 빌드 경고 수 증가 | check.sh 출력 EBUSY 카운트 > 7 | plan 외 기존 이슈. 증가 시 Chunk 0.5 와 무관한 고장. 기록만. |

---

## 9. 참조 파일 (Codex 최초 오픈용)

- `packages/shared/src/core/jobPosting.ts` (200-258행이 변경 타겟)
- `packages/shared/src/test/jobPosting.test.ts` (L57, 122, 160, 189, 382 — fetchImpl 주입 회귀 방지 핵심)
- `packages/shared/src/test/jobPosting.goldens.test.ts` (L44-62 mockFetch 빌드 패턴)
- `packages/runner/src/routes/insightsHandlers.ts` (L8, 57, 113 호출 지점)
- `packages/runner/src/routes/projectsHandlers.ts` (L33, 182 호출 지점)
- `packages/runner/src/runnerContext.ts` (DI 주입 지점)
- `packages/runner/package.json` (puppeteer 추가 지점)
- `docs/plans/2026-04-19-posting-parser-p2-major-adapters.md` §5 Chunk 0.5 (463-489행 원안)
