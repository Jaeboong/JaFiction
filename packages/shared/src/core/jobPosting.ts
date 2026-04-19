import { nowIso } from "./utils";
import type { SourceTier } from "./sourceTier";
import { filterAtsFromTitle } from "./atsBlacklist";
import { findMatchingAdapter } from "./jobPosting/adapters/registry";
import { downgradeAllFields } from "./jobPosting/adapters/signatureCheck";
import type { SiteAdapterResult } from "./jobPosting/adapters/types";
import { deriveCompanyNameHintsFromHostname } from "./jobPosting/companyHostnames";
import {
  DEFAULT_STOP_TOKENS,
  crossValidateCandidates,
  tokenOverlapAtLeast,
  type CrossValidateCandidate
} from "./jobPosting/crossValidate";
import {
  extractJsonLdJobPosting,
  extractOgSiteName,
  normalizeEmploymentType,
  normalizeJobPostingRoleName,
  normalizeValidThroughIso,
  stripJobPostingDescriptionHtml,
  type JsonLdJobPostingFields
} from "./jobPosting/jsonLd";
import { DEFAULT_STATIC_HEADERS, StaticFetcher } from "./jobPosting/fetcher/staticFetcher";
import {
  FetcherError,
  isFetcherError,
  type JobPostingFetcher
} from "./jobPosting/fetcher/types";

export const JOB_POSTING_FIELD_KEYS = [
  "companyName",
  "roleName",
  "deadline",
  "overview",
  "mainResponsibilities",
  "qualifications",
  "preferredQualifications",
  "benefits",
  "hiringProcess",
  "insiderView",
  "otherInfo"
] as const;

export type JobPostingFieldKey = (typeof JOB_POSTING_FIELD_KEYS)[number];

export interface JobPostingExtractionRequest {
  jobPostingUrl?: string;
  jobPostingText?: string;
  seedCompanyName?: string;
  seedRoleName?: string;
}

export interface JobPostingExtractionResult {
  source: "url" | "manual";
  fetchedAt: string;
  fetchedUrl?: string;
  pageTitle?: string;
  normalizedText: string;
  companyName?: string;
  roleName?: string;
  deadline?: string;
  overview?: string;
  mainResponsibilities?: string;
  qualifications?: string;
  preferredQualifications?: string;
  benefits?: string;
  hiringProcess?: string;
  insiderView?: string;
  otherInfo?: string;
  keywords: string[];
  warnings: string[];
  fieldSources: Partial<Record<JobPostingFieldKey, SourceTier>>;
}

export interface JobPostingFetchDiagnostics {
  occurredAt: string;
  failureKind: "http" | "network";
  requestUrl: string;
  finalUrl?: string;
  status?: number;
  statusText?: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  bodySnippet?: string;
}

export class JobPostingFetchError extends Error {
  readonly diagnostics: JobPostingFetchDiagnostics;

  constructor(message: string, diagnostics: JobPostingFetchDiagnostics, options?: { cause?: unknown }) {
    super(message);
    this.name = "JobPostingFetchError";
    this.diagnostics = diagnostics;
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        configurable: true
      });
    }
  }
}

export function isJobPostingFetchError(error: unknown): error is JobPostingFetchError {
  return error instanceof JobPostingFetchError;
}

interface EmbeddedJobPostingSource {
  detailHtml: string;
  pageTitle?: string;
  companyName?: string;
  roleTitle?: string;
}

interface SectionCandidate {
  headingRaw: string;
  headingNormalized: string;
  contentLines: string[];
  supportHeading?: string;
  isCommon: boolean;
}

const blockLikeTags = /<(?:\/?(?:p|div|section|article|main|header|footer|aside|nav|ul|ol|li|table|thead|tbody|tr|th|td|h[1-6]|br))\b[^>]*>/gi;
const stripTags = /<[^>]+>/g;
const collapseSpaces = /[ \t\u00a0]+/g;
const sensitiveResponseHeaders = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie"]);
const knownKeywordPatterns = [
  /spring\s*boot/i,
  /\bspring\b/i,
  /\bjava\b/i,
  /\bkotlin\b/i,
  /\bjpa\b/i,
  /\bhibernate\b/i,
  /\bmysql\b/i,
  /\bpostgres(?:ql)?\b/i,
  /\bredis\b/i,
  /\bkafka\b/i,
  /\bkinesis\b/i,
  /\bnosql\b/i,
  /\bmongodb\b/i,
  /\baws\b/i,
  /\bgcp\b/i,
  /\bncp\b/i,
  /\bdocker\b/i,
  /\bkubernetes\b/i,
  /\becs\b/i,
  /\beks\b/i,
  /\bapi\b/i,
  /\bswagger\b/i,
  /\btest\s*code\b/i,
  /\bmsa\b/i,
  /\bci\/cd\b/i,
  /\bhadoop\b/i,
  /\belk\b/i,
  /\bgraphql\b/i
];
const sectionHeadingPatterns = {
  deadline: [
    /^모집\s*기간$/i,
    /^지원\s*기간$/i,
    /^접수\s*기간$/i,
    /^지원\s*마감$/i,
    /^지원\s*마감일$/i,
    /^마감$/i,
    /^마감\s*일$/i,
    /^마감\s*기한$/i,
    /^application\s*deadline$/i
  ],
  responsibilities: [/^주요\s*업무$/i, /^담당\s*업무$/i, /^직무\s*내용$/i, /^what you'll do$/i, /^responsibilities$/i],
  qualifications: [/^자격\s*요건$/i, /^지원\s*자격$/i, /^필수\s*요건$/i, /^required qualifications$/i, /^requirements$/i],
  preferred: [/^우대\s*사항$/i, /^preferred qualifications$/i, /^nice to have$/i],
  overview: [/^공고\s*개요$/i, /^채용\s*개요$/i, /^포지션\s*소개$/i, /^job\s*overview$/i, /^about\s*the\s*role$/i, /^소개$/i],
  benefits: [/^복리\s*후생$/i, /^복지$/i, /^혜택$/i, /^benefits$/i, /^welfare$/i, /^perks$/i],
  hiringProcess: [
    /^채용\s*절차$/i, /^채용\s*프로세스(?:는)?$/i, /^전형\s*절차$/i, /^전형\s*안내$/i,
    /^전형\s*구분$/i, /^지원\s*방법$/i, /^hiring\s*process$/i, /^selection\s*process$/i
  ],
  insiderView: [/^재직자\s*시각$/i, /^함께하게\s*될\s*팀은$/i, /^팀\s*소개$/i, /^팀\s*구성$/i, /^insider\s*view$/i],
  otherInfo: [/^기타\s*정보$/i, /^기타$/i, /^근무\s*조건$/i, /^기타\s*문의\s*사항$/i, /^기타\s*안내$/i, /^지원\s*서류$/i]
};
const stopHeadingPatterns = [
  ...sectionHeadingPatterns.deadline,
  ...sectionHeadingPatterns.responsibilities,
  ...sectionHeadingPatterns.qualifications,
  ...sectionHeadingPatterns.preferred,
  ...sectionHeadingPatterns.overview,
  ...sectionHeadingPatterns.benefits,
  ...sectionHeadingPatterns.hiringProcess,
  ...sectionHeadingPatterns.insiderView,
  ...sectionHeadingPatterns.otherInfo,
  /^지원\s*분야/i,
  /^급여\s*사항$/i,
  /^공유하기$/i,
  /^지원하기$/i,
  /^[-—–]{3,}$/i
];
const deadlineHintLinePattern = /(?:모집|지원|접수)\s*기간|지원\s*마감|마감(?:일|기한)?/i;
const deadlineDatePatterns = [
  /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?(?:\s*(?:(\d{1,2})\s*:\s*(\d{2})|(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?))?/g,
  /(?:(\d{4})\s*[./-]\s*)?(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*\([^)]*\))?(?:\s*(?:(\d{1,2})\s*:\s*(\d{2})|(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?))?/g
] as const;
const jsonLdOverviewMinLength = 50;
const companyLinePattern = /주식회사|\(주\)|corp|inc\.?|ltd\.?/i;
const companyLineMaxLength = 40;

export async function fetchAndExtractJobPosting(
  request: JobPostingExtractionRequest,
  fetchImpl?: typeof fetch
): Promise<JobPostingExtractionResult>;
export async function fetchAndExtractJobPosting(
  request: JobPostingExtractionRequest,
  fetcher?: JobPostingFetcher
): Promise<JobPostingExtractionResult>;
export async function fetchAndExtractJobPosting(
  request: JobPostingExtractionRequest,
  fetcherOrFetchImpl?: JobPostingFetcher | typeof fetch
): Promise<JobPostingExtractionResult> {
  const manualText = request.jobPostingText?.trim();
  if (manualText) {
    return buildExtractionResult("manual", normalizeJobPostingText(manualText), {
      seedCompanyName: request.seedCompanyName,
      seedRoleName: request.seedRoleName
    });
  }

  const jobPostingUrl = request.jobPostingUrl?.trim();
  if (!jobPostingUrl) {
    throw new Error("지원 공고 URL 또는 수동 입력 텍스트가 필요합니다.");
  }

  if (!/^https?:\/\//i.test(jobPostingUrl)) {
    throw new Error("지원 공고 URL은 http 또는 https로 시작해야 합니다.");
  }

  const fetcher = resolveFetcher(fetcherOrFetchImpl);
  const requestHeaders = { ...DEFAULT_STATIC_HEADERS };

  let fetchResult: Awaited<ReturnType<JobPostingFetcher["fetch"]>>;
  try {
    fetchResult = await fetcher.fetch(jobPostingUrl);
  } catch (error) {
    if (isFetcherError(error)) {
      throw convertFetcherError(error, jobPostingUrl, requestHeaders);
    }
    throw error;
  }

  const { html } = fetchResult;
  const embeddedSource = extractEmbeddedJobPostingSource(html);
  const jsonLdFields = extractJsonLdJobPosting(html);
  const normalizedText = normalizeJobPostingHtml(embeddedSource?.detailHtml || html);
  const finalUrl = fetchResult.finalUrl || jobPostingUrl;
  const adapterLookup = resolveMatchingAdapter(jobPostingUrl, finalUrl);
  const adapterResult = resolveSiteAdapterResult(
    adapterLookup?.adapter.extract(html, {
      url: adapterLookup?.match.canonicalUrl || finalUrl,
      jsonLdFields,
      normalizedText
    }),
    adapterLookup?.adapter.siteKey
  );
  // ATS 사이트명이 포함된 title은 companyName/roleName 추출에 사용하면 안 되므로 필터링
  const extractedPageTitle = extractTitle(html);
  const resolvedPageTitle = embeddedSource?.pageTitle
    || (shouldBypassAtsTitleFilter(adapterResult) ? extractedPageTitle : filterAtsFromTitle(extractedPageTitle));
  const baseResult = buildExtractionResult("url", normalizedText, {
    fetchedUrl: finalUrl,
    pageTitle: resolvedPageTitle,
    seedCompanyName: embeddedSource?.companyName || request.seedCompanyName,
    seedRoleName: request.seedRoleName,
    jsonLdFields,
    nextDataRoleTitle: embeddedSource?.roleTitle,
    hostname: extractHostname(finalUrl),
    html
  });
  return mergeSiteAdapterResult(baseResult, adapterResult);
}

function resolveFetcher(fetcherOrFetchImpl?: JobPostingFetcher | typeof fetch): JobPostingFetcher {
  if (!fetcherOrFetchImpl) {
    return new StaticFetcher();
  }

  if (typeof fetcherOrFetchImpl === "function") {
    return new StaticFetcher({ fetchImpl: fetcherOrFetchImpl });
  }

  return fetcherOrFetchImpl;
}

function convertFetcherError(
  error: FetcherError,
  requestUrl: string,
  requestHeaders: Record<string, string>
): JobPostingFetchError {
  if (error.info.kind === "network" || error.info.kind === "timeout" || error.info.kind === "browser") {
    return new JobPostingFetchError(
      "지원 공고 요청 중 네트워크 오류가 발생했습니다.",
      {
        occurredAt: nowIso(),
        failureKind: "network",
        requestUrl,
        requestHeaders: sanitizeHeaders(requestHeaders)
      },
      { cause: error.info.cause ?? error }
    );
  }

  return new JobPostingFetchError(error.message, {
    occurredAt: nowIso(),
    failureKind: "http",
    requestUrl,
    finalUrl: error.info.finalUrl || requestUrl,
    status: error.info.status,
    statusText: error.info.statusText,
    requestHeaders: sanitizeHeaders(requestHeaders),
    responseHeaders: error.info.responseHeaders ? sanitizeHeaders(error.info.responseHeaders) : undefined,
    bodySnippet: error.info.bodySnippet
  });
}

export function normalizeJobPostingHtml(html: string): string {
  const withoutScripts = html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "\n");

  return normalizeJobPostingText(
    decodeHtmlEntities(withoutScripts.replace(blockLikeTags, "\n").replace(stripTags, " "))
  );
}

export function normalizeJobPostingText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(collapseSpaces, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function extractStructuredJobPostingFields(
  normalizedText: string,
  options: {
    pageTitle?: string;
    seedCompanyName?: string;
    seedRoleName?: string;
    nextDataRoleTitle?: string;
    jsonLdSeed?: JsonLdJobPostingFields;
    hostname?: string;
    html?: string;
  } = {}
): Omit<JobPostingExtractionResult, "source" | "fetchedAt" | "fetchedUrl" | "normalizedText"> {
  const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const warnings: string[] = [];
  const ogSiteName = options.html ? extractOgSiteName(options.html) : undefined;

  const roleResult = inferRoleNameWithTier(lines, {
    pageTitle: options.pageTitle,
    seedRoleName: options.seedRoleName,
    jsonLdSeed: options.jsonLdSeed,
    nextDataRoleTitle: options.nextDataRoleTitle
  });
  const roleName = roleResult?.value;

  const deadlineSection = findSection(lines, sectionHeadingPatterns.deadline, 8);
  const deadline = extractDeadline(lines, deadlineSection);
  const roleHintKeywords = buildRoleHintKeywords(options.seedRoleName || roleName);
  const overview = findSection(lines, sectionHeadingPatterns.overview);
  const mainResponsibilities = findSection(lines, sectionHeadingPatterns.responsibilities);
  const qualifications = findBestSection(lines, sectionHeadingPatterns.qualifications, roleHintKeywords);
  const preferredQualifications = findBestSection(lines, sectionHeadingPatterns.preferred, roleHintKeywords);
  const benefits = findSection(lines, sectionHeadingPatterns.benefits);
  const hiringProcess = findSection(lines, sectionHeadingPatterns.hiringProcess);
  const insiderView = findSection(lines, sectionHeadingPatterns.insiderView);
  const otherInfo = findSection(lines, sectionHeadingPatterns.otherInfo, 25);
  const companyResult = inferCompanyNameWithTier(lines, {
    pageTitle: options.pageTitle,
    seedCompanyName: options.seedCompanyName,
    jsonLdSeed: options.jsonLdSeed,
    roleName,
    hostname: options.hostname,
    ogSiteName
  });
  const companyName = companyResult?.value;
  const keywords = collectKeywords([mainResponsibilities, qualifications, preferredQualifications, roleName].filter(Boolean).join("\n"));

  if (!mainResponsibilities) {
    warnings.push("주요 업무 섹션을 명확히 찾지 못했습니다.");
  }
  if (!qualifications) {
    warnings.push("자격요건 섹션을 명확히 찾지 못했습니다.");
  }

  const fieldSources: Partial<Record<JobPostingFieldKey, SourceTier>> = {};
  if (companyResult) {
    fieldSources.companyName = companyResult.tier;
  }
  if (roleResult) {
    fieldSources.roleName = roleResult.tier;
  }

  return {
    pageTitle: options.pageTitle,
    companyName,
    roleName,
    deadline,
    overview,
    mainResponsibilities,
    qualifications,
    preferredQualifications,
    benefits,
    hiringProcess,
    insiderView,
    otherInfo,
    keywords,
    warnings,
    fieldSources
  };
}

function extractDeadline(lines: string[], deadlineSection?: string): string | undefined {
  const candidates: string[] = [];
  if (deadlineSection?.trim()) {
    candidates.push(deadlineSection);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = stripBulletPrefix(lines[index]);
    if (!deadlineHintLinePattern.test(currentLine)) {
      continue;
    }

    const nextLine = lines[index + 1] ? stripBulletPrefix(lines[index + 1]) : "";
    candidates.push(nextLine ? `${currentLine}\n${nextLine}` : currentLine);
  }

  for (const candidate of candidates) {
    const normalized = normalizeDeadline(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeDeadline(source: string, now: Date = new Date()): string | undefined {
  const matches = collectDeadlineMatches(source);
  if (matches.length === 0) {
    return undefined;
  }

  const latest = matches.reduce((current, candidate) => {
    if (candidate.index > current.index) {
      return candidate;
    }
    if (candidate.index < current.index) {
      return current;
    }
    if (candidate.hasTime && !current.hasTime) {
      return candidate;
    }
    return current;
  });

  const year = latest.year ?? now.getFullYear();
  const month = pad2(latest.month);
  const day = pad2(latest.day);
  const time = latest.hasTime ? `${pad2(latest.hour)}:${pad2(latest.minute)}` : "-";
  return `${year}년 ${month}월 ${day}일, ${time}`;
}

interface DeadlineMatch {
  index: number;
  year?: number;
  month: number;
  day: number;
  hasTime: boolean;
  hour: number;
  minute: number;
}

function collectDeadlineMatches(source: string): DeadlineMatch[] {
  const matches: DeadlineMatch[] = [];

  for (const pattern of deadlineDatePatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match = regex.exec(source);
    while (match) {
      const year = parseOptionalNumber(match[1]);
      const month = parseOptionalNumber(match[2]);
      const day = parseOptionalNumber(match[3]);
      const hour = parseOptionalNumber(match[4]) ?? parseOptionalNumber(match[6]);
      const minute = parseOptionalNumber(match[5]) ?? parseOptionalNumber(match[7]) ?? 0;
      const hasTime = hour !== undefined && (match[5] !== undefined || match[7] !== undefined);
      const index = match.index;

      if (
        month !== undefined &&
        day !== undefined &&
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= 31 &&
        (!hasTime || (hour !== undefined && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59))
      ) {
        matches.push({
          index,
          year,
          month,
          day,
          hasTime,
          hour: hour ?? 0,
          minute
        });
      }

      match = regex.exec(source);
    }
  }

  return matches;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildExtractionResult(
  source: JobPostingExtractionResult["source"],
  normalizedText: string,
  options: {
    fetchedUrl?: string;
    pageTitle?: string;
    seedCompanyName?: string;
    seedRoleName?: string;
    jsonLdFields?: JsonLdJobPostingFields;
    nextDataRoleTitle?: string;
    hostname?: string;
    html?: string;
  }
): JobPostingExtractionResult {
  const extracted = extractStructuredJobPostingFields(normalizedText, {
    pageTitle: options.pageTitle,
    seedCompanyName: options.seedCompanyName,
    seedRoleName: options.seedRoleName,
    nextDataRoleTitle: options.nextDataRoleTitle,
    jsonLdSeed: options.jsonLdFields,
    hostname: options.hostname,
    html: options.html
  });
  const jsonLdOverview = resolveJsonLdOverview(options.jsonLdFields);
  const jsonLdDeadline = resolveJsonLdDeadline(options.jsonLdFields);
  const mergedOtherInfo = mergeJsonLdOtherInfo(extracted.otherInfo, options.jsonLdFields);

  if (jsonLdOverview) {
    extracted.overview = jsonLdOverview;
    extracted.fieldSources.overview = "factual";
  }

  if (jsonLdDeadline) {
    extracted.deadline = jsonLdDeadline;
    extracted.fieldSources.deadline = "factual";
  }

  if (mergedOtherInfo) {
    extracted.otherInfo = mergedOtherInfo;
  }

  const jsonLdDescription = options.jsonLdFields?.description?.trim();
  if (jsonLdDescription && extracted.mainResponsibilities?.trim()) {
    const descriptionText = stripJobPostingDescriptionHtml(jsonLdDescription);
    if (
      descriptionText.length >= jsonLdOverviewMinLength
      && tokenOverlapAtLeast(extracted.mainResponsibilities, descriptionText, 5, {
        minTokenLen: 2,
        stopTokens: DEFAULT_STOP_TOKENS
      })
    ) {
      extracted.fieldSources.mainResponsibilities = "factual";
    }
  }

  return {
    source,
    fetchedAt: nowIso(),
    fetchedUrl: options.fetchedUrl,
    pageTitle: options.pageTitle,
    normalizedText,
    companyName: extracted.companyName,
    roleName: extracted.roleName,
    deadline: extracted.deadline,
    overview: extracted.overview,
    mainResponsibilities: extracted.mainResponsibilities,
    qualifications: extracted.qualifications,
    preferredQualifications: extracted.preferredQualifications,
    benefits: extracted.benefits,
    hiringProcess: extracted.hiringProcess,
    insiderView: extracted.insiderView,
    otherInfo: extracted.otherInfo,
    keywords: extracted.keywords,
    warnings: extracted.warnings,
    fieldSources: extracted.fieldSources
  };
}

function resolveMatchingAdapter(originalUrl: string, finalUrl: string) {
  const primaryMatch = findMatchingAdapter(originalUrl);
  if (primaryMatch) {
    return primaryMatch;
  }

  if (finalUrl !== originalUrl) {
    return findMatchingAdapter(finalUrl);
  }

  return undefined;
}

function resolveSiteAdapterResult(
  adapterResult: SiteAdapterResult | undefined,
  siteKey: string | undefined
): SiteAdapterResult | undefined {
  if (!adapterResult) {
    return undefined;
  }

  const normalizedResult = adapterResult.signatureVerified
    ? cloneSiteAdapterResult(adapterResult)
    : downgradeAllFields(adapterResult);

  if (!adapterResult.signatureVerified && siteKey) {
    normalizedResult.warnings = mergeWarnings(normalizedResult.warnings, [`site_signature_mismatch:${siteKey}`]);
  }

  return normalizedResult;
}

function cloneSiteAdapterResult(adapterResult: SiteAdapterResult): SiteAdapterResult {
  return {
    ...adapterResult,
    fields: { ...adapterResult.fields },
    warnings: [...adapterResult.warnings]
  };
}

function shouldBypassAtsTitleFilter(adapterResult: SiteAdapterResult | undefined): boolean {
  if (!adapterResult) {
    return false;
  }

  if (adapterResult.fields.companyName || adapterResult.fields.roleName) {
    return true;
  }

  return adapterResult.adapterTrust === "high" && adapterResult.signatureVerified;
}

function mergeSiteAdapterResult(
  baseResult: JobPostingExtractionResult,
  adapterResult: SiteAdapterResult | undefined
): JobPostingExtractionResult {
  if (!adapterResult) {
    return baseResult;
  }

  const mergedResult: JobPostingExtractionResult = {
    ...baseResult,
    warnings: mergeWarnings(baseResult.warnings, adapterResult.warnings),
    fieldSources: { ...baseResult.fieldSources }
  };

  for (const fieldKey of JOB_POSTING_FIELD_KEYS) {
    const extraction = adapterResult.fields[fieldKey];
    if (!extraction) {
      continue;
    }

    mergedResult[fieldKey] = extraction.value;
    mergedResult.fieldSources[fieldKey] = extraction.tier;
  }

  mergedResult.keywords = collectKeywords(
    [
      mergedResult.mainResponsibilities,
      mergedResult.qualifications,
      mergedResult.preferredQualifications,
      mergedResult.roleName
    ].filter(Boolean).join("\n")
  );

  return mergedResult;
}

function mergeWarnings(existingWarnings: string[], additionalWarnings: string[]): string[] {
  const mergedWarnings: string[] = [];
  const seenWarnings = new Set<string>();

  for (const warning of [...existingWarnings, ...additionalWarnings]) {
    if (!warning || seenWarnings.has(warning)) {
      continue;
    }
    seenWarnings.add(warning);
    mergedWarnings.push(warning);
  }

  return mergedWarnings;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? normalizeJobPostingText(decodeHtmlEntities(match[1])) : undefined;
}

function findSection(lines: string[], headingPatterns: RegExp[], maxLines = 14): string | undefined {
  const sections = collectSections(lines, headingPatterns, maxLines);
  return sections.length > 0 ? joinSectionContents([sections[0]]) : undefined;
}

function findBestSection(lines: string[], headingPatterns: RegExp[], roleHintKeywords: string[]): string | undefined {
  const sections = collectSections(lines, headingPatterns);
  if (sections.length === 0) {
    return undefined;
  }

  const commonSections = sections.filter((section) => section.isCommon);
  const targetedSection = roleHintKeywords.length > 0
    ? sections.find((section) => !section.isCommon && sectionMatchesRole(section, roleHintKeywords))
    : undefined;

  if (targetedSection) {
    return joinSectionContents([targetedSection, ...commonSections]);
  }

  if (commonSections.length > 0) {
    const primarySection = sections.find((section) => !section.isCommon);
    return joinSectionContents(primarySection ? [primarySection, ...commonSections] : commonSections);
  }

  return joinSectionContents([sections[0]]);
}

function inferRoleName(lines: string[], pageTitle?: string, seedRoleName?: string): string | undefined {
  return inferRoleNameWithTier(lines, { pageTitle, seedRoleName })?.value;
}

interface FieldWithTier {
  value: string;
  tier: SourceTier;
}

// Tier 분류 규칙:
// - factual: seed(사용자 직접 입력) 경로
// - contextual: body에서 추출한 값이 pageTitle에도 동일하게 포함됨 (교차 확인)
// - role: body 단독 추출 or title 단독 폴백
function inferRoleNameWithTier(
  lines: string[],
  options: {
    pageTitle?: string;
    seedRoleName?: string;
    jsonLdSeed?: JsonLdJobPostingFields;
    nextDataRoleTitle?: string;
  } = {}
): FieldWithTier | undefined {
  if (options.seedRoleName?.trim()) {
    return { value: options.seedRoleName.trim(), tier: "factual" };
  }

  if (options.jsonLdSeed?.title?.trim()) {
    const normalizedTitle = normalizeJobPostingRoleName(
      options.jsonLdSeed.title,
      options.jsonLdSeed.companyName
    );
    if (normalizedTitle) {
      return { value: normalizedTitle, tier: "factual" };
    }
  }

  const fromDetail = extractRoleFromDetailLines(lines);
  if (fromDetail) {
    if (options.nextDataRoleTitle && tokenOverlapAtLeast(fromDetail, options.nextDataRoleTitle, 2)) {
      return { value: fromDetail, tier: "factual" };
    }
    if (options.pageTitle && options.pageTitle.toLowerCase().includes(fromDetail.toLowerCase())) {
      return { value: fromDetail, tier: "contextual" };
    }
    return { value: fromDetail, tier: "role" };
  }

  const titleCandidates = [
    ...(options.pageTitle ? splitTitleCandidates(options.pageTitle) : []),
    ...(normalizeOpeningTitle(options.pageTitle) ? [normalizeOpeningTitle(options.pageTitle)!] : [])
  ];
  const match = titleCandidates.find((candidate) =>
    /개발|엔지니어|backend|frontend|full[- ]?stack|data|java|ios|android|pm|designer|research/i.test(candidate)
  );
  if (match?.trim()) {
    return { value: match.trim(), tier: "role" };
  }

  return undefined;
}

const rolePattern = /개발|엔지니어|backend|frontend|full[- ]?stack|data|java|ios|android|pm|designer|research/i;
const trailingParticlePattern = /\s*(?:는|은|이|가|을|를|의|로|에|와|과)\s*,?\s*$/;

function extractRoleFromDetailLines(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 6)) {
    if (matchesHeading(normalizeHeadingForMatch(line), stopHeadingPatterns)) {
      break;
    }
    const stripped = stripBulletPrefix(line).replace(trailingParticlePattern, "").trim();
    if (stripped && stripped.length <= 60 && rolePattern.test(stripped)) {
      return stripped;
    }
  }
  return undefined;
}

function inferCompanyName(
  lines: string[],
  pageTitle: string | undefined,
  seedCompanyName: string | undefined,
  roleName: string | undefined
): string | undefined {
  return inferCompanyNameWithTier(lines, {
    pageTitle,
    seedCompanyName,
    roleName
  })?.value;
}

// Tier 분류 규칙:
// - factual: seed(사용자 직접 입력) 경로
// - contextual: body에서 company 패턴 매칭 + pageTitle에도 동일 포함
// - role: title 단독 폴백 or body 단독
function inferCompanyNameWithTier(
  lines: string[],
  options: {
    pageTitle?: string;
    seedCompanyName?: string;
    jsonLdSeed?: JsonLdJobPostingFields;
    roleName?: string;
    hostname?: string;
    ogSiteName?: string;
  } = {}
): FieldWithTier | undefined {
  if (options.seedCompanyName?.trim()) {
    return { value: options.seedCompanyName.trim(), tier: "factual" };
  }

  if (options.jsonLdSeed?.companyName?.trim()) {
    return { value: options.jsonLdSeed.companyName.trim(), tier: "factual" };
  }

  const titleStripCandidate = extractCompanyNameFromTitleStrip(options.pageTitle, options.roleName);
  const footerCandidate = extractFooterCompanyCandidate(lines);
  const bodyCandidate = extractBodyCompanyCandidate(lines);
  const candidates: CrossValidateCandidate[] = [];

  for (const companyNameHint of deriveCompanyNameHintsFromHostname(options.hostname)) {
    candidates.push({ value: companyNameHint, source: "hostname" });
  }
  if (titleStripCandidate) {
    candidates.push({ value: titleStripCandidate, source: "titleStrip" });
  }
  if (options.ogSiteName?.trim()) {
    candidates.push({ value: options.ogSiteName.trim(), source: "ogSiteName" });
  }
  if (footerCandidate) {
    candidates.push({ value: footerCandidate, source: "footer" });
  }
  if (bodyCandidate) {
    candidates.push({ value: bodyCandidate, source: "body" });
  }

  const crossValidated = crossValidateCandidates(candidates, { minAgreeCount: 2 });
  if (crossValidated.tier === "factual" && crossValidated.value) {
    return { value: crossValidated.value, tier: "factual" };
  }

  if (titleStripCandidate) {
    return { value: titleStripCandidate, tier: "role" };
  }

  if (bodyCandidate) {
    if (options.pageTitle && options.pageTitle.toLowerCase().includes(bodyCandidate.toLowerCase())) {
      return { value: bodyCandidate, tier: "contextual" };
    }
    return { value: bodyCandidate, tier: "role" };
  }

  return undefined;
}

function resolveJsonLdOverview(jsonLdFields?: JsonLdJobPostingFields): string | undefined {
  const description = jsonLdFields?.description?.trim();
  if (!description) {
    return undefined;
  }

  const normalized = stripJobPostingDescriptionHtml(description);
  return normalized.length >= jsonLdOverviewMinLength ? normalized : undefined;
}

function resolveJsonLdDeadline(jsonLdFields?: JsonLdJobPostingFields): string | undefined {
  const validThrough = jsonLdFields?.validThrough?.trim();
  return validThrough ? normalizeValidThroughIso(validThrough) : undefined;
}

function mergeJsonLdOtherInfo(
  existingOtherInfo: string | undefined,
  jsonLdFields?: JsonLdJobPostingFields
): string | undefined {
  const jsonLdLines = collectJsonLdOtherInfoLines(jsonLdFields);
  if (jsonLdLines.length === 0) {
    return existingOtherInfo;
  }

  return [jsonLdLines.join("\n"), existingOtherInfo].filter(Boolean).join("\n");
}

function collectJsonLdOtherInfoLines(jsonLdFields?: JsonLdJobPostingFields): string[] {
  if (!jsonLdFields) {
    return [];
  }

  const lines: string[] = [];
  const employmentType = jsonLdFields.employmentType
    ? normalizeEmploymentType(jsonLdFields.employmentType) || jsonLdFields.employmentType.trim()
    : undefined;
  if (employmentType) {
    lines.push(`고용형태: ${employmentType}`);
  }

  const locationText = jsonLdFields.locationText?.trim();
  if (locationText) {
    lines.push(`근무지역: ${locationText}`);
  }

  return lines;
}

function splitTitleCandidates(title: string): string[] {
  return title
    .split(/\||-|—|·|:/)
    .map((part) => normalizeOpeningTitle(part) || part.trim())
    .filter(Boolean);
}

function extractCompanyNameFromTitleStrip(pageTitle: string | undefined, roleName: string | undefined): string | undefined {
  const filteredTitle = filterAtsFromTitle(pageTitle);
  if (!filteredTitle) {
    return undefined;
  }

  const normalizedRoleName = roleName?.trim().toLowerCase();
  const candidates = splitTitleCandidates(filteredTitle)
    .map((candidate) => stripCompanyTitleSuffix(candidate))
    .filter(Boolean);

  return candidates.find((candidate) => candidate.toLowerCase() !== normalizedRoleName);
}

function stripCompanyTitleSuffix(value: string): string {
  return value.replace(/\s*(?:채용\s*공고|채용공고|채용|공고)\s*$/i, "").trim();
}

function extractFooterCompanyCandidate(lines: string[]): string | undefined {
  const footerLines = lines.slice(-30);
  for (let index = footerLines.length - 1; index >= 0; index -= 1) {
    const candidate = footerLines[index]?.trim();
    if (candidate && candidate.length <= companyLineMaxLength && companyLinePattern.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function extractBodyCompanyCandidate(lines: string[]): string | undefined {
  const candidate = lines.find((line) => companyLinePattern.test(line))?.trim();
  return candidate && candidate.length <= companyLineMaxLength ? candidate : undefined;
}

function stripBulletPrefix(line: string): string {
  return line
    .replace(/^[\p{Extended_Pictographic}\uFE0F\s\-•·■▪▶☑📢✈💻✅◆◇▪▫▸▹►▻➤➜]+/gu, "")
    .replace(/^[\s\-•·■▪▶]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function collectSections(lines: string[], headingPatterns: RegExp[], maxLines = 14): SectionCandidate[] {
  const sections: SectionCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index];
    const normalizedHeading = normalizeHeadingForMatch(heading);
    if (!matchesHeading(normalizedHeading, headingPatterns)) {
      continue;
    }

    const contentLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isStopHeading(line)) {
        break;
      }
      if (contentLines.length >= maxLines) {
        break;
      }
      contentLines.push(stripBulletPrefix(line));
    }

    if (contentLines.length === 0) {
      continue;
    }

    sections.push({
      headingRaw: heading,
      headingNormalized: normalizedHeading,
      contentLines,
      supportHeading: findNearbySupportHeading(lines, index),
      isCommon: /공통/.test(normalizeHeadingRaw(heading))
    });
  }

  return sections;
}

function joinSectionContents(sections: SectionCandidate[]): string | undefined {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const section of sections) {
    for (const line of section.contentLines) {
      if (!line || seen.has(line)) {
        continue;
      }
      seen.add(line);
      merged.push(line);
    }
  }
  return merged.length > 0 ? merged.join("\n") : undefined;
}

function isStopHeading(line: string): boolean {
  const normalized = normalizeHeadingForMatch(line);
  return matchesHeading(normalized, stopHeadingPatterns) || isSupportHeading(normalized);
}

function findNearbySupportHeading(lines: string[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor -= 1) {
    const normalized = normalizeHeadingForMatch(lines[cursor]);
    if (isSupportHeading(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

function sectionMatchesRole(section: SectionCandidate, roleHintKeywords: string[]): boolean {
  const supportHeading = section.supportHeading?.toLowerCase() || "";
  return roleHintKeywords.some((keyword) => supportHeading.includes(keyword.toLowerCase()));
}

function normalizeHeadingRaw(line: string): string {
  return stripBulletPrefix(line).replace(/\s+/g, " ").trim();
}

function normalizeHeadingForMatch(line: string): string {
  return normalizeHeadingRaw(line)
    .replace(/\s*\(([^)]*)\)\s*$/, "")
    .trim();
}

function matchesHeading(line: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(line));
}

function isSupportHeading(line: string): boolean {
  return /^지원\s*분야(?:\s*\d+)?\s*\.?/i.test(line);
}

function buildRoleHintKeywords(roleName?: string): string[] {
  if (!roleName?.trim()) {
    return [];
  }

  const hints = new Set<string>();
  const normalized = roleName.trim();
  for (const keyword of collectKeywords(normalized)) {
    hints.add(keyword);
  }

  for (const [pattern, token] of [
    [/java/i, "java"],
    [/python/i, "python"],
    [/kotlin/i, "kotlin"],
    [/backend|백엔드/i, "backend"],
    [/frontend|프론트/i, "frontend"]
  ] as const) {
    if (pattern.test(normalized)) {
      hints.add(token);
    }
  }

  return [...hints];
}

function normalizeOpeningTitle(title?: string): string | undefined {
  const value = title?.trim();
  if (!value) {
    return undefined;
  }

  return value
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/\s*(?:신입\s*\/\s*경력|신입|경력)\s*채용\s*$/i, "")
    .replace(/\s*공개\s*채용\s*$/i, "")
    .trim();
}

function extractHostname(url: string | undefined): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function extractEmbeddedJobPostingSource(html: string): EmbeddedJobPostingSource | undefined {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!nextDataMatch?.[1]) {
    return undefined;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]) as {
      props?: {
        pageProps?: {
          dehydratedState?: {
            queries?: Array<{
              queryKey?: unknown[];
              state?: { data?: { data?: Record<string, unknown> } };
            }>;
          };
        };
      };
    };

    const queries = nextData.props?.pageProps?.dehydratedState?.queries;
    const openingPayload = queries?.find((query) => Array.isArray(query.queryKey) && query.queryKey[1] === "getOpeningById")?.state?.data?.data;
    const detailHtml = extractString((openingPayload as Record<string, unknown> | undefined)?.openingsInfo, "detail");
    if (!detailHtml) {
      return undefined;
    }

    return {
      detailHtml,
      pageTitle: extractString((openingPayload as Record<string, unknown> | undefined)?.openingsInfo, "title"),
      companyName: extractString((openingPayload as Record<string, unknown> | undefined)?.groupInfo, "name"),
      roleTitle: extractString((openingPayload as Record<string, unknown> | undefined)?.openingsInfo, "title")
    };
  } catch {
    return undefined;
  }
}

function extractString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function sanitizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, string>>((accumulator, [name, value]) => {
      accumulator[name] = sensitiveResponseHeaders.has(name.toLowerCase()) ? "[redacted]" : value;
      return accumulator;
    }, {});
}

function summarizeResponseBody(body: string): string | undefined {
  const normalized = body
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
  return normalized || undefined;
}

function collectKeywords(text: string): string[] {
  const keywords = new Set<string>();
  for (const pattern of knownKeywordPatterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      keywords.add(normalizeKeyword(match[0]));
    }
  }

  for (const token of text.match(/\b[A-Za-z][A-Za-z0-9/+.-]{1,24}\b/g) ?? []) {
    if (/^[A-Z0-9/+.-]{2,25}$/.test(token) || /^[A-Z][a-zA-Z0-9/+.-]{1,24}$/.test(token)) {
      keywords.add(normalizeKeyword(token));
    }
  }

  return [...keywords].slice(0, 12);
}

function normalizeKeyword(keyword: string): string {
  return keyword
    .replace(/\s+/g, " ")
    .replace(/^ci\/cd$/i, "CI/CD")
    .replace(/^spring\s*boot$/i, "Spring Boot")
    .replace(/^test\s*code$/i, "Test Code")
    .replace(/^java$/i, "Java")
    .replace(/^jpa$/i, "JPA")
    .replace(/^aws$/i, "AWS")
    .replace(/^gcp$/i, "GCP")
    .replace(/^ncp$/i, "NCP");
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized in namedEntities) {
      return namedEntities[normalized];
    }

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}
