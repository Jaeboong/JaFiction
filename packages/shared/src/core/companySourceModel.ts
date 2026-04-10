export const companySourceKinds = [
  "openDartOverview",
  "openDartFinancials",
  "officialHomepage",
  "companyIntro",
  "businessIntro",
  "officialHiring",
  "officialIr",
  "officialPress",
  "officialTechBlog"
] as const;

export type CompanySourceKind = (typeof companySourceKinds)[number];
export type CompanySourceStatus = "available" | "fetched" | "failed" | "missing";
export type CompanySourceSection = "company-summary" | "business-model" | "offerings" | "growth-direction" | "role-context" | "financial";

export interface CompanySourceEntry {
  id: string;
  tier: "official";
  kind: CompanySourceKind;
  label: string;
  status: CompanySourceStatus;
  url?: string;
  title?: string;
  fetchedAt?: string;
  note?: string;
  discoveredFrom?: "openDart" | "homepage" | "jobPosting";
}

export interface CompanySourceSnippet {
  sourceId: string;
  sourceKind: CompanySourceKind;
  sectionLabel: CompanySourceSection;
  text: string;
  confidence: "high" | "medium" | "low";
}

export interface CompanySourceCoverage {
  summaryLabel: string;
  sourceTypes: string[];
  omissions: string[];
  coverageNote: string;
  externalEnrichmentUsed: boolean;
}

export interface CompanySourceManifest {
  collectedAt: string;
  companyName: string;
  sources: CompanySourceEntry[];
  coverage: CompanySourceCoverage;
}

export interface CompanySourceBundle {
  manifest: CompanySourceManifest;
  snippets: CompanySourceSnippet[];
}

export const companySourceLabels: Record<CompanySourceKind, string> = {
  openDartOverview: "OpenDART 기업개황",
  openDartFinancials: "OpenDART 재무 요약",
  officialHomepage: "공식 홈페이지",
  companyIntro: "공식 회사 소개",
  businessIntro: "공식 사업 소개",
  officialHiring: "공식 채용 페이지",
  officialIr: "공식 IR",
  officialPress: "공식 보도자료/뉴스",
  officialTechBlog: "공식 기술 블로그"
};

export const companySourceRequestHeaders = {
  "user-agent": "ForJob/0.1.1 (+https://github.com/Jaeboong/CoordinateAI)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
};

export function buildCompanySourceId(kind: CompanySourceKind): string {
  return kind.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
