#!/usr/bin/env bun
/**
 * 공고 파서 fixture 수집 스크립트
 * 실행: bun run scripts/fetch-posting-fixtures.ts [--force]
 *
 * - urls.txt에서 URL 파싱
 * - 각 URL을 fetch하여 fetched/ 디렉토리에 HTML 저장
 * - jobPosting.ts의 파서 함수를 재사용하여 파싱 결과 수집
 * - results.json 및 report.md 생성
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  normalizeJobPostingHtml,
  extractStructuredJobPostingFields,
  fetchAndExtractJobPosting,
  type JobPostingExtractionResult,
} from "../packages/shared/src/core/jobPosting";

// ─── 상수 ───────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const PLAN_DIR = join(REPO_ROOT, "docs/plans/2026-04-17-posting-parser-fixtures");
const FETCHED_DIR = join(PLAN_DIR, "fetched");
const URLS_FILE = join(PLAN_DIR, "urls.txt");
const RESULTS_FILE = join(PLAN_DIR, "results.json");
const REPORT_FILE = join(PLAN_DIR, "report.md");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const TIMEOUT_MS = 20_000;
const DOMAIN_THROTTLE_MS = 2_000;
const MAX_RETRIES = 2;
const FORCE = process.argv.includes("--force");

// ─── URL 메타 파싱 ───────────────────────────────────────────────────────────

interface UrlMeta {
  url: string;
  category: string;
  company: string;
  role: string;
  deadline: string;
}

function parseUrlsFile(content: string): UrlMeta[] {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const results: UrlMeta[] = [];
  let currentMeta: Omit<UrlMeta, "url"> | null = null;

  for (const line of lines) {
    if (line.startsWith("# 공고") || line.startsWith("# 포맷") || line.startsWith("# 중복")) {
      // 헤더 코멘트 — 스킵
      continue;
    }
    if (line.startsWith("#")) {
      // 메타 코멘트: # <카테고리> | <회사> | <직무> | <마감>
      const body = line.slice(1).trim();
      const parts = body.split("|").map((p) => p.trim());
      currentMeta = {
        category: parts[0] ?? "",
        company: parts[1] ?? "",
        role: parts[2] ?? "",
        deadline: parts[3] ?? "",
      };
    } else if (line.startsWith("http")) {
      if (currentMeta) {
        results.push({ url: line, ...currentMeta });
        currentMeta = null;
      }
    }
  }
  return results;
}

// ─── 도메인 유틸 ─────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function getDomainGroup(url: string): string {
  const hostname = extractDomain(url);
  if (hostname === "jumpit.saramin.co.kr") return "jumpit";
  if (hostname === "www.wanted.co.kr" || hostname === "wanted.co.kr") return "wanted";
  if (hostname.endsWith(".recruiter.co.kr")) return "recruiter_co_kr";
  if (hostname.endsWith(".careerlink.kr")) return "careerlink";
  if (hostname === "www.jobkorea.co.kr") return "jobkorea";
  if (hostname.endsWith(".greetinghr.com")) return "greetinghr";
  if (hostname === "career.kia.com") return "kia";
  if (hostname === "recruit.posco.com") return "posco";
  if (hostname === "careers.lg.com") return "lg";
  return "other_corporate";
}

function safeFilename(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// ─── Charset 감지 ─────────────────────────────────────────────────────────────

function detectCharset(contentType: string, htmlHead: string): string {
  // Content-Type에서 charset 추출
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) return ctMatch[1].toLowerCase();

  // HTML meta에서 charset 추출 (앞 4KB만 확인)
  const metaCharset = htmlHead.match(/<meta[^>]+charset=["']?([^"'\s;>]+)/i);
  if (metaCharset) return metaCharset[1].toLowerCase();

  const httpEquiv = htmlHead.match(
    /<meta[^>]+http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"'\s;]+)/i
  );
  if (httpEquiv) return httpEquiv[1].toLowerCase();

  return "utf-8";
}

// ─── HTML 구조 신호 분석 ──────────────────────────────────────────────────────

interface JsonLdJobPosting {
  present: boolean;
  title?: string;
  hiringOrgName?: string;
  hasValidThrough: boolean;
  descriptionLength?: number;
}

interface StructureSignals {
  jsonLdJobPosting: JsonLdJobPosting;
  ssrPayload: "nextData" | "nuxt" | "initialState" | "apolloState" | "none";
  nextDataQueryKeys?: string[];
  meta: { title?: string; ogTitle?: string; ogDescription?: string; ogSiteName?: string };
  bodyTextLength: number;
  spaCandidate: boolean;
}

function analyzeStructure(html: string): StructureSignals {
  // JSON-LD 분석
  const jsonLdResult = analyzeJsonLd(html);

  // SSR payload 감지
  const ssrPayload = detectSsrPayload(html);
  const nextDataQueryKeys = ssrPayload === "nextData" ? extractNextDataQueryKeys(html) : undefined;

  // Meta tags
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)[^>]+property=["']og:title["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)[^>]+property=["']og:description["']/i);
  const ogSiteNameMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)[^>]+property=["']og:site_name["']/i);

  // body 텍스트 길이
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] ?? html;
  const bodyText = bodyHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const bodyTextLength = bodyText.length;

  return {
    jsonLdJobPosting: jsonLdResult,
    ssrPayload,
    nextDataQueryKeys,
    meta: {
      title: titleMatch?.[1] ? decodeSimpleEntities(titleMatch[1]).trim().slice(0, 200) : undefined,
      ogTitle: ogTitleMatch?.[1]?.trim().slice(0, 200),
      ogDescription: ogDescMatch?.[1]?.trim().slice(0, 300),
      ogSiteName: ogSiteNameMatch?.[1]?.trim().slice(0, 100),
    },
    bodyTextLength,
    spaCandidate: bodyTextLength < 500,
  };
}

function analyzeJsonLd(html: string): JsonLdJobPosting {
  const scriptMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (scriptMatches.length === 0) return { present: false, hasValidThrough: false };

  for (const match of scriptMatches) {
    try {
      const raw = JSON.parse(match[1]);
      const jobPosting = findJobPosting(raw);
      if (jobPosting) {
        return {
          present: true,
          title: String(jobPosting.title ?? "").slice(0, 200) || undefined,
          hiringOrgName: typeof jobPosting.hiringOrganization === "object"
            ? String((jobPosting.hiringOrganization as Record<string, unknown>).name ?? "").slice(0, 100) || undefined
            : undefined,
          hasValidThrough: Boolean(jobPosting.validThrough),
          descriptionLength: typeof jobPosting.description === "string" ? jobPosting.description.length : undefined,
        };
      }
    } catch {
      // 파싱 실패 — 다음 블록 시도
    }
  }
  return { present: false, hasValidThrough: false };
}

function findJobPosting(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  // 단일 객체
  if ((raw as Record<string, unknown>)["@type"] === "JobPosting") {
    return raw as Record<string, unknown>;
  }

  // 배열
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return undefined;
  }

  // @graph
  const graph = (raw as Record<string, unknown>)["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const found = findJobPosting(item);
      if (found) return found;
    }
  }
  return undefined;
}

function detectSsrPayload(html: string): StructureSignals["ssrPayload"] {
  if (/<script id="__NEXT_DATA__"/i.test(html)) return "nextData";
  if (/window\.__NUXT__\s*=/i.test(html)) return "nuxt";
  if (/window\.__INITIAL_STATE__\s*=/i.test(html)) return "initialState";
  if (/window\.__APOLLO_STATE__\s*=/i.test(html)) return "apolloState";
  return "none";
}

function extractNextDataQueryKeys(html: string): string[] {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[] }> } } };
    };
    const queries = data.props?.pageProps?.dehydratedState?.queries ?? [];
    return queries
      .filter((q): q is typeof q & { queryKey: unknown[] } => Array.isArray(q.queryKey))
      .map((q) => q.queryKey.slice(0, 3).map(String).join("/"))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function decodeSimpleEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ─── 분류 로직 ─────────────────────────────────────────────────────────────────

type Classification = "success" | "partial" | "total_failure" | "blocked" | "expired" | "error";

function classify(opts: {
  httpStatus?: number;
  html?: string;
  parse?: Partial<JobPostingExtractionResult>;
  matchScore: number;
  error?: Error;
}): Classification {
  if (opts.error) return "error";

  const { httpStatus, html, parse, matchScore } = opts;

  if (httpStatus === 403 || httpStatus === 429) return "blocked";
  if (httpStatus === 404) return "expired";

  if (html) {
    const lower = html.toLowerCase();
    if (/접근이\s*거부|접근\s*차단|차단됨|access\s*denied/i.test(html)) return "blocked";
    if (lower.includes("cf-challenge") || lower.includes("cloudflare")) {
      if (!parse?.companyName && !parse?.roleName) return "blocked";
    }
    const hasExpiredKeyword = /공고가?\s*마감|채용\s*종료|모집이?\s*완료|접수\s*마감됐|더\s*이상\s*지원\s*불가/i.test(html);
    if (hasExpiredKeyword && !parse?.companyName) return "expired";
  }

  const normalizedTextLength = parse?.normalizedText?.length ?? 0;
  const hasCompany = Boolean(parse?.companyName?.trim());
  const hasRole = Boolean(parse?.roleName?.trim());
  const hasText = normalizedTextLength >= 200 || Boolean(parse?.mainResponsibilities?.trim());

  if (!hasCompany && !hasRole && normalizedTextLength === 0) return "total_failure";

  if (hasCompany && hasRole && hasText && matchScore >= 0.5) return "success";

  return "partial";
}

// ─── Match 점수 계산 ──────────────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function computeMatchScore(
  expected: { company: string; role: string },
  parsed: { companyName?: string; roleName?: string }
): { score: number; companyMatch: boolean; roleMatch: boolean } {
  const expCompany = normalizeForMatch(expected.company);
  const expRole = normalizeForMatch(expected.role);
  const parsedCompany = normalizeForMatch(parsed.companyName ?? "");
  const parsedRole = normalizeForMatch(parsed.roleName ?? "");

  const companyMatch =
    expCompany.length > 0 && parsedCompany.length > 0
      ? parsedCompany.includes(expCompany) || expCompany.includes(parsedCompany)
      : false;

  const roleMatch =
    expRole.length > 0 && parsedRole.length > 0
      ? parsedRole.includes(expRole.slice(0, 6)) || expRole.includes(parsedRole.slice(0, 6))
      : false;

  const score = (companyMatch ? 0.6 : 0) + (roleMatch ? 0.4 : 0);
  return { score, companyMatch, roleMatch };
}

// ─── Fetch 로직 ───────────────────────────────────────────────────────────────

interface FetchResult {
  status: number;
  contentType: string;
  finalUrl: string;
  bytes: number;
  html: string;
  charset: string;
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<FetchResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") ?? "";
      const htmlHead = new TextDecoder("utf-8").decode(arrayBuffer.slice(0, 4096));
      const charset = detectCharset(contentType, htmlHead);

      let html: string;
      try {
        html = new TextDecoder(charset, { fatal: false }).decode(arrayBuffer);
      } catch {
        html = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
      }

      return {
        status: response.status,
        contentType,
        finalUrl: response.url || url,
        bytes: arrayBuffer.byteLength,
        html,
        charset,
      };
    } catch (error) {
      lastError = error;
      // HTTP 4xx/5xx는 재시도하지 않음 (status로 처리됨)
      // 네트워크/타임아웃 오류만 재시도
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 도메인 throttle ───────────────────────────────────────────────────────────

const lastDomainFetch: Map<string, number> = new Map();

async function throttleForDomain(domain: string): Promise<void> {
  const last = lastDomainFetch.get(domain);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < DOMAIN_THROTTLE_MS) {
      await sleep(DOMAIN_THROTTLE_MS - elapsed);
    }
  }
  lastDomainFetch.set(domain, Date.now());
}

// ─── 결과 타입 ────────────────────────────────────────────────────────────────

interface EntryResult {
  url: string;
  expected: { category: string; company: string; role: string; deadline: string };
  domainGroup: string;
  http?: {
    status: number;
    contentType: string;
    finalUrl: string;
    bytes: number;
    charset: string;
  };
  parse?: {
    companyName?: string;
    roleName?: string;
    keywords: string[];
    mainResponsibilitiesLength: number;
    qualificationsLength: number;
    normalizedTextLength: number;
    normalizedTextHead: string;
    warnings: string[];
  };
  match: { score: number; companyMatch: boolean; roleMatch: boolean };
  structure?: StructureSignals;
  classification: Classification;
  missingFields: string[];
  htmlPath?: string;
  error?: string;
}

// ─── 단일 URL 처리 ────────────────────────────────────────────────────────────

async function processUrl(
  meta: UrlMeta,
  idx: number,
  domainCounters: Map<string, number>
): Promise<EntryResult> {
  const domain = extractDomain(meta.url);
  const group = getDomainGroup(meta.url);
  const safeDomain = safeFilename(domain);

  // 도메인별 인덱스 계산
  const domainIdx = (domainCounters.get(domain) ?? 0) + 1;
  domainCounters.set(domain, domainIdx);
  const htmlFileName = `${safeDomain}_${String(domainIdx).padStart(3, "0")}.html`;
  const htmlPath = join(FETCHED_DIR, htmlFileName);
  const relativeHtmlPath = `fetched/${htmlFileName}`;

  const base: Pick<EntryResult, "url" | "expected" | "domainGroup" | "match"> = {
    url: meta.url,
    expected: { category: meta.category, company: meta.company, role: meta.role, deadline: meta.deadline },
    domainGroup: group,
    match: { score: 0, companyMatch: false, roleMatch: false },
  };

  // 이미 fetched 파일 있으면 스킵 (--force 없으면)
  let html: string | undefined;
  let fetchResult: FetchResult | undefined;

  if (!FORCE && existsSync(htmlPath)) {
    console.log(`  [SKIP] ${meta.url} (already fetched: ${htmlFileName})`);
    html = readFileSync(htmlPath, "utf-8");
    // cached metadata: status unknown, mark as 200 assuming it was OK when saved
    fetchResult = {
      status: 200,
      contentType: "text/html",
      finalUrl: meta.url,
      bytes: Buffer.byteLength(html, "utf-8"),
      html,
      charset: "utf-8",
    };
  } else {
    // throttle
    await throttleForDomain(domain);

    try {
      console.log(`  [FETCH] (${idx + 1}) ${meta.url}`);
      fetchResult = await fetchWithRetry(meta.url);
      html = fetchResult.html;

      // HTML 저장
      writeFileSync(htmlPath, html, "utf-8");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`  [ERROR] ${meta.url}: ${errMsg}`);
      return {
        ...base,
        classification: "error",
        missingFields: ["all"],
        error: errMsg,
      };
    }
  }

  // HTTP 상태가 4xx/5xx인 경우 parse 없이 분류
  if (fetchResult.status >= 400) {
    const classification = classify({
      httpStatus: fetchResult.status,
      html,
      parse: undefined,
      matchScore: 0,
    });
    return {
      ...base,
      http: {
        status: fetchResult.status,
        contentType: fetchResult.contentType,
        finalUrl: fetchResult.finalUrl,
        bytes: fetchResult.bytes,
        charset: fetchResult.charset,
      },
      structure: analyzeStructure(html ?? ""),
      match: { score: 0, companyMatch: false, roleMatch: false },
      classification,
      missingFields: ["all"],
      htmlPath: relativeHtmlPath,
    };
  }

  // 파싱 — fetchAndExtractJobPosting에 fake fetch 주입
  let parseResult: JobPostingExtractionResult | undefined;
  try {
    const capturedHtml = html!;
    const capturedFetchResult = fetchResult;
    const fakeFetch = async (_url: string): Promise<Response> =>
      new Response(capturedHtml, {
        status: capturedFetchResult.status,
        headers: { "content-type": capturedFetchResult.contentType },
      });

    parseResult = await fetchAndExtractJobPosting({ jobPostingUrl: meta.url }, fakeFetch as typeof fetch);
  } catch (error) {
    // 파싱 오류는 parse 없이 계속
    const errMsg = error instanceof Error ? error.message : String(error);
    console.warn(`  [PARSE-ERR] ${meta.url}: ${errMsg}`);
  }

  // 구조 분석
  const structure = analyzeStructure(html!);

  // match 점수
  const match = computeMatchScore(
    { company: meta.company, role: meta.role },
    { companyName: parseResult?.companyName, roleName: parseResult?.roleName }
  );

  // 누락 필드 계산
  const missingFields: string[] = [];
  if (!parseResult?.companyName) missingFields.push("companyName");
  if (!parseResult?.roleName) missingFields.push("roleName");
  if (!parseResult?.mainResponsibilities) missingFields.push("mainResponsibilities");
  if (!parseResult?.qualifications) missingFields.push("qualifications");
  if (!parseResult?.deadline) missingFields.push("deadline");

  const classification = classify({
    httpStatus: fetchResult.status,
    html: html!,
    parse: parseResult,
    matchScore: match.score,
  });

  const normalizedTextLength = parseResult?.normalizedText?.length ?? 0;
  const normalizedTextHead = parseResult?.normalizedText?.slice(0, 200) ?? "";

  return {
    ...base,
    http: {
      status: fetchResult.status,
      contentType: fetchResult.contentType,
      finalUrl: fetchResult.finalUrl,
      bytes: fetchResult.bytes,
      charset: fetchResult.charset,
    },
    parse: parseResult
      ? {
          companyName: parseResult.companyName,
          roleName: parseResult.roleName,
          keywords: parseResult.keywords,
          mainResponsibilitiesLength: parseResult.mainResponsibilities?.length ?? 0,
          qualificationsLength: parseResult.qualifications?.length ?? 0,
          normalizedTextLength,
          normalizedTextHead,
          warnings: parseResult.warnings,
        }
      : undefined,
    match,
    structure,
    classification,
    missingFields,
    htmlPath: relativeHtmlPath,
  };
}

// ─── 리포트 생성 ──────────────────────────────────────────────────────────────

function generateReport(entries: EntryResult[], generatedAt: string): string {
  const total = entries.length;
  const unique = new Set(entries.map((e) => e.url)).size;

  // 분류별 통계
  const classCounts: Record<Classification, number> = {
    success: 0,
    partial: 0,
    total_failure: 0,
    blocked: 0,
    expired: 0,
    error: 0,
  };
  for (const e of entries) classCounts[e.classification] += 1;

  // 도메인별 통계
  const domainStats: Map<string, { total: number; success: number; partial: number; total_failure: number; blocked: number; expired: number; error: number }> = new Map();
  for (const e of entries) {
    if (!domainStats.has(e.domainGroup)) {
      domainStats.set(e.domainGroup, { total: 0, success: 0, partial: 0, total_failure: 0, blocked: 0, expired: 0, error: 0 });
    }
    const stat = domainStats.get(e.domainGroup)!;
    stat.total += 1;
    stat[e.classification] += 1;
  }

  // JSON-LD 커버리지
  const jsonLdCount = entries.filter((e) => e.structure?.jsonLdJobPosting.present).length;
  const jsonLdPct = total > 0 ? Math.round((jsonLdCount / total) * 100) : 0;

  // SSR payload 분포
  const ssrCounts: Record<string, number> = { nextData: 0, nuxt: 0, initialState: 0, apolloState: 0, none: 0 };
  for (const e of entries) {
    if (e.structure?.ssrPayload) ssrCounts[e.structure.ssrPayload] += 1;
  }

  // SPA 후보
  const spaCandidates = entries.filter((e) => e.structure?.spaCandidate);

  // 문제 URL
  const problemUrls = entries.filter((e) =>
    e.classification === "error" || e.classification === "blocked" || e.classification === "expired"
  );

  // 도메인별 JSON-LD
  const domainJsonLd: Map<string, { total: number; present: number }> = new Map();
  for (const e of entries) {
    if (!domainJsonLd.has(e.domainGroup)) domainJsonLd.set(e.domainGroup, { total: 0, present: 0 });
    const stat = domainJsonLd.get(e.domainGroup)!;
    stat.total += 1;
    if (e.structure?.jsonLdJobPosting.present) stat.present += 1;
  }

  const lines: string[] = [];
  lines.push(`# 공고 파서 Fixture 수집 리포트`);
  lines.push(`\n생성일시: ${generatedAt}\n`);

  lines.push(`## 총괄 통계\n`);
  lines.push(`| 분류 | 건수 | 비율 |`);
  lines.push(`|------|------|------|`);
  const classOrder: Classification[] = ["success", "partial", "total_failure", "blocked", "expired", "error"];
  for (const cls of classOrder) {
    const cnt = classCounts[cls];
    const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : "0.0";
    lines.push(`| ${cls} | ${cnt} | ${pct}% |`);
  }
  lines.push(`| **합계** | **${total}** | 100% |`);
  lines.push(`\n- 총 URL: ${total}`);
  lines.push(`- 고유 URL: ${unique}`);

  lines.push(`\n## 도메인 그룹별 성공률\n`);
  lines.push(`| 도메인 그룹 | 샘플 수 | success | partial | total_failure | blocked/expired | error | 성공률 |`);
  lines.push(`|-------------|---------|---------|---------|---------------|-----------------|-------|--------|`);
  const sortedDomains = [...domainStats.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [group, stat] of sortedDomains) {
    const successPct = stat.total > 0 ? ((stat.success / stat.total) * 100).toFixed(0) : "0";
    const blocked = stat.blocked + stat.expired;
    lines.push(`| ${group} | ${stat.total} | ${stat.success} | ${stat.partial} | ${stat.total_failure} | ${blocked} | ${stat.error} | ${successPct}% |`);
  }

  lines.push(`\n## JSON-LD JobPosting 커버리지\n`);
  lines.push(`전체: **${jsonLdCount}/${total} (${jsonLdPct}%)**\n`);
  lines.push(`| 도메인 그룹 | 샘플 수 | JSON-LD 존재 | 커버리지 |`);
  lines.push(`|-------------|---------|-------------|---------|`);
  for (const [group, stat] of [...domainJsonLd.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const pct = stat.total > 0 ? ((stat.present / stat.total) * 100).toFixed(0) : "0";
    lines.push(`| ${group} | ${stat.total} | ${stat.present} | ${pct}% |`);
  }

  lines.push(`\n## SSR Payload 유형 분포\n`);
  lines.push(`| 유형 | 건수 | 비율 |`);
  lines.push(`|------|------|------|`);
  for (const [type, cnt] of Object.entries(ssrCounts).sort((a, b) => b[1] - a[1])) {
    const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : "0.0";
    lines.push(`| ${type} | ${cnt} | ${pct}% |`);
  }

  lines.push(`\n## SPA 후보 URL 목록 (body 텍스트 < 500자)\n`);
  if (spaCandidates.length === 0) {
    lines.push(`없음 (정적 fetch로 모두 파싱 가능)\n`);
  } else {
    lines.push(`| URL | 도메인 그룹 | body 텍스트 길이 | 분류 |`);
    lines.push(`|-----|-------------|-----------------|------|`);
    for (const e of spaCandidates) {
      lines.push(`| ${e.url} | ${e.domainGroup} | ${e.structure?.bodyTextLength ?? "?"} | ${e.classification} |`);
    }
  }

  lines.push(`\n## 가설 검증\n`);

  // H1: GreetingHR 비중 < 5%
  const greetinghrCount = entries.filter((e) => e.domainGroup === "greetinghr").length;
  const greetinghrPct = total > 0 ? ((greetinghrCount / total) * 100).toFixed(1) : "0.0";
  const h1Result = parseFloat(greetinghrPct) < 5 ? "참" : "거짓";
  lines.push(`### H1: GreetingHR 비중 < 5%`);
  lines.push(`- GreetingHR URL: ${greetinghrCount}/${total} (${greetinghrPct}%)`);
  lines.push(`- 결과: **${h1Result}** — GreetingHR 비중이 ${greetinghrPct}%로 5% ${parseFloat(greetinghrPct) < 5 ? "미만" : "이상"}임\n`);

  // H2: jumpit / wanted / recruiter.co.kr이 상위인지
  lines.push(`### H2: jumpit / wanted / recruiter_co_kr이 상위 도메인인지`);
  const topDomains = sortedDomains.slice(0, 5).map(([g, s]) => `${g}(${s.total})`).join(", ");
  lines.push(`- 상위 5 도메인 그룹: ${topDomains}`);
  const topThree = new Set(["jumpit", "wanted", "recruiter_co_kr"]);
  const h2Result = sortedDomains.slice(0, 3).some(([g]) => topThree.has(g)) ? "참" : "거짓";
  lines.push(`- 결과: **${h2Result}** — 상위 3 도메인 중 jumpit/wanted/recruiter_co_kr 포함 여부\n`);

  // H4: JSON-LD 커버리지
  lines.push(`### H4: JSON-LD JobPosting 커버리지`);
  lines.push(`- JSON-LD JobPosting 발견: ${jsonLdCount}/${total} (${jsonLdPct}%)\n`);

  // H5: SPA 비중
  const spaPct = total > 0 ? ((spaCandidates.length / total) * 100).toFixed(1) : "0.0";
  lines.push(`### H5: SPA 비중`);
  lines.push(`- SPA 후보: ${spaCandidates.length}/${total} (${spaPct}%)\n`);

  // Adapter 우선순위
  lines.push(`## Adapter 우선순위 제안 (실측 기반)\n`);
  lines.push(`커버리지 내림차순으로 정렬:\n`);
  const adapterOrder = sortedDomains
    .filter(([, s]) => s.total > 0)
    .map(([group, stat]) => {
      const successPct = ((stat.success / stat.total) * 100).toFixed(0);
      return `1. **${group}** — ${stat.total}개 샘플, 성공률 ${successPct}%`;
    });
  lines.push(adapterOrder.join("\n"));

  lines.push(`\n## 문제 URL 목록 (404/차단/타임아웃)\n`);
  if (problemUrls.length === 0) {
    lines.push(`없음\n`);
  } else {
    lines.push(`| URL | 분류 | HTTP 상태 | 오류 메시지 |`);
    lines.push(`|-----|------|-----------|------------|`);
    for (const e of problemUrls) {
      const status = e.http?.status ?? "-";
      const errMsg = e.error ? e.error.slice(0, 80) : "-";
      lines.push(`| ${e.url.slice(0, 80)} | ${e.classification} | ${status} | ${errMsg} |`);
    }
  }

  lines.push(`\n## 다음 단계 권고\n`);
  lines.push(`1. SPA 후보 사이트(${spaCandidates.length}건)는 Puppeteer/Playwright 기반 렌더링 어댑터 검토 필요`);
  lines.push(`2. JSON-LD 미지원 도메인(${total - jsonLdCount}건)에 대한 HTML 구조 분석 어댑터 개발 우선화`);
  lines.push(`3. 차단된 도메인(${classCounts.blocked}건)에 대해 Referer/Cookie 처리 또는 공식 API 확인`);
  lines.push(`4. total_failure(${classCounts.total_failure}건) 케이스의 HTML을 직접 확인하여 파서 개선 포인트 식별`);
  lines.push(`5. 상위 도메인(jumpit, wanted, recruiter_co_kr) 전용 어댑터를 먼저 구현하여 커버리지 극대화`);

  return lines.join("\n");
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== 공고 파서 Fixture 수집 시작 ===");
  console.log(`FORCE 모드: ${FORCE}`);

  // 디렉토리 생성
  mkdirSync(FETCHED_DIR, { recursive: true });

  // URLs 파싱
  const urlsContent = readFileSync(URLS_FILE, "utf-8");
  const urlMetas = parseUrlsFile(urlsContent);
  console.log(`총 ${urlMetas.length}개 URL 발견`);

  const uniqueUrls = new Set(urlMetas.map((m) => m.url));
  console.log(`고유 URL: ${uniqueUrls.size}개`);

  // 도메인별 카운터 (파일명 결정용)
  const domainCounters: Map<string, number> = new Map();

  // 처리 (도메인별 throttle을 위해 순차 처리)
  const entries: EntryResult[] = [];
  for (let i = 0; i < urlMetas.length; i += 1) {
    const meta = urlMetas[i];
    try {
      const result = await processUrl(meta, i, domainCounters);
      entries.push(result);
      console.log(`  -> ${result.classification} | ${result.parse?.companyName ?? "-"} | ${result.parse?.roleName ?? "-"}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[FATAL] ${meta.url}: ${errMsg}`);
      entries.push({
        url: meta.url,
        expected: { category: meta.category, company: meta.company, role: meta.role, deadline: meta.deadline },
        domainGroup: getDomainGroup(meta.url),
        match: { score: 0, companyMatch: false, roleMatch: false },
        classification: "error",
        missingFields: ["all"],
        error: errMsg,
      });
    }
  }

  // results.json 저장 (normalizedText 제외)
  const generatedAt = new Date().toISOString();
  const results = {
    generatedAt,
    totalUrls: urlMetas.length,
    uniqueUrls: uniqueUrls.size,
    entries: entries.map((e) => {
      // normalizedText 필드는 제외, parse.normalizedTextLength만 보존
      return e;
    }),
  };

  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nresults.json 저장: ${RESULTS_FILE}`);

  // report.md 생성
  const reportContent = generateReport(entries, generatedAt);
  writeFileSync(REPORT_FILE, reportContent, "utf-8");
  console.log(`report.md 저장: ${REPORT_FILE}`);

  // 요약 출력
  const classCounts: Record<string, number> = {};
  for (const e of entries) {
    classCounts[e.classification] = (classCounts[e.classification] ?? 0) + 1;
  }
  console.log("\n=== 수집 완료 ===");
  console.log(`총 URL: ${urlMetas.length}, 고유: ${uniqueUrls.size}`);
  console.log("분류별:", classCounts);
}

main().catch((error) => {
  console.error("치명적 오류:", error);
  process.exit(1);
});
