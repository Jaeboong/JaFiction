import { OpenDartCompanyResolution } from "../openDart";
import { OpenDartCandidate } from "../types";
import { CompanySourceCoverage, CompanySourceSnippet } from "../companySourceModel";

/**
 * 외부 호출 없이 project 필드에서 파생된 공고 소스.
 */
export interface PostingSourcePayload {
  companyName: string;
  roleName?: string;
  mainResponsibilities?: string;
  qualifications?: string;
  preferredQualifications?: string;
  keywords: readonly string[];
  jobPostingText?: string;
  snippets: readonly CompanySourceSnippet[];
}

/**
 * WebSearchProvider 결과를 정규화한 웹/뉴스 소스.
 */
export interface WebSourcePayload {
  providerId?: "naver" | "brave";
  fetchedAt: string;
  entries: readonly WebSourceEntry[];
  snippets: readonly CompanySourceSnippet[];
  notes: readonly string[];
}

export interface WebSourceEntry {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: "news" | "web";
}

/**
 * DART resolve 결과를 정규화한 소스 (ambiguous 제외).
 */
export interface DartSourcePayload {
  resolution: OpenDartCompanyResolution;
}

/**
 * collectCompanyContext 호출 시 전달할 회사/직무 힌트.
 * 미래 확장을 위해 객체 타입으로 분리.
 */
export interface CompanyContextHints {
  companyName: string;
  roleName?: string;
  keywords?: readonly string[];
}

/**
 * collectCompanyContext 반환 타입.
 * sources.dart?.resolution.status 가 "ambiguous" 인 경우는
 * reviewNeeded 로만 나타나고 dart 는 undefined.
 */
export interface CompanyContextBundle {
  collectedAt: string;
  companyName: string;
  sources: {
    dart?: DartSourcePayload;
    web: WebSourcePayload;
    posting: PostingSourcePayload;
  };
  coverage: CompanySourceCoverage;
  reviewNeeded?: {
    reason: "openDartAmbiguous";
    candidates: readonly OpenDartCandidate[];
  };
}
