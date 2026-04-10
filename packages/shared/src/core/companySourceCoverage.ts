import { normalizeJobPostingText } from "./jobPosting";
import { OpenDartCompanyResolution, OpenDartFinancialSummary } from "./openDart";
import {
  buildCompanySourceId,
  CompanySourceCoverage,
  CompanySourceEntry,
  CompanySourceKind,
  CompanySourceManifest,
  CompanySourceSnippet,
  companySourceLabels
} from "./companySourceModel";

const coverageTypeKinds: Array<{ kinds: CompanySourceKind[]; label: string; omission: string }> = [
  {
    kinds: ["openDartOverview", "openDartFinancials"],
    label: "OpenDART",
    omission: "OpenDART 기업개황/재무 자료가 충분하지 않습니다."
  },
  {
    kinds: ["officialHomepage", "companyIntro", "businessIntro"],
    label: "공식 홈페이지",
    omission: "공식 홈페이지/회사 소개/사업 소개 자료를 충분히 확보하지 못했습니다."
  },
  {
    kinds: ["officialHiring"],
    label: "공식 채용",
    omission: "공식 채용 페이지를 확인하지 못했습니다."
  },
  {
    kinds: ["officialIr", "officialPress", "officialTechBlog"],
    label: "공식 IR/보도/기술 자료",
    omission: "최근 방향성을 뒷받침할 공식 IR/보도/기술 자료가 제한적입니다."
  }
];

export function buildOpenDartArtifacts(
  companyResolution: OpenDartCompanyResolution | undefined,
  collectedAt: string
): { sources: CompanySourceEntry[]; snippets: CompanySourceSnippet[] } {
  if (!companyResolution || companyResolution.status !== "resolved") {
    return {
      sources: [
        buildMissingSource("openDartOverview", collectedAt, resolveOpenDartNote(companyResolution)),
        buildMissingSource("openDartFinancials", collectedAt, resolveOpenDartNote(companyResolution))
      ],
      snippets: []
    };
  }

  const sources: CompanySourceEntry[] = [
    {
      id: "open-dart-overview",
      tier: "official",
      kind: "openDartOverview",
      label: companySourceLabels.openDartOverview,
      status: "available",
      fetchedAt: collectedAt,
      title: companyResolution.match.corpName
    },
    {
      id: "open-dart-financials",
      tier: "official",
      kind: "openDartFinancials",
      label: companySourceLabels.openDartFinancials,
      status: companyResolution.financials.length > 0 ? "available" : "missing",
      fetchedAt: collectedAt,
      note: companyResolution.financials.length > 0 ? undefined : "최근 연간 재무 요약이 비어 있습니다."
    }
  ];

  const snippets: CompanySourceSnippet[] = [
    {
      sourceId: "open-dart-overview",
      sourceKind: "openDartOverview",
      sectionLabel: "company-summary",
      text: normalizeJobPostingText([
        `${companyResolution.overview.corpName} / CEO ${companyResolution.overview.ceoName ?? "Unknown"}`,
        companyResolution.overview.establishedAt ? `설립일 ${companyResolution.overview.establishedAt}` : "",
        companyResolution.overview.homepageUrl ? `홈페이지 ${companyResolution.overview.homepageUrl}` : ""
      ].filter(Boolean).join("\n")),
      confidence: "high"
    }
  ];

  if (companyResolution.financials.length > 0) {
    snippets.push({
      sourceId: "open-dart-financials",
      sourceKind: "openDartFinancials",
      sectionLabel: "financial",
      text: companyResolution.financials.map(renderFinancialSummary).join("\n"),
      confidence: "high"
    });
  }

  return { sources, snippets };
}

export function extractSourceSnippets(
  sourceId: string,
  sourceKind: CompanySourceKind,
  normalizedText?: string
): CompanySourceSnippet[] {
  const lines = (normalizedText ?? "").split("\n").map((line) => line.trim()).filter((line) => line.length >= 8);
  if (lines.length === 0) {
    return [];
  }

  const snippets = [
    buildSnippet(sourceId, sourceKind, "business-model", pickRelevantLines(lines, /(사업|서비스|플랫폼|솔루션|광고|제품|브랜드|고객|커머스)/i), sourceKind === "businessIntro" ? "high" : "medium"),
    buildSnippet(sourceId, sourceKind, "offerings", pickRelevantLines(lines, /(브랜드|서비스|제품|플랫폼|솔루션|포트폴리오|제공)/i), "medium"),
    buildSnippet(sourceId, sourceKind, "growth-direction", pickRelevantLines(lines, /(성장|확장|출시|신규|고도화|강화|파트너|투자|글로벌|AI|데이터)/i), "medium"),
    buildSnippet(sourceId, sourceKind, "role-context", pickRelevantLines(lines, /(채용|직무|개발|엔지니어|인재|기술|조직|문제|미션)/i), sourceKind === "officialHiring" ? "high" : "low")
  ].filter((snippet): snippet is CompanySourceSnippet => Boolean(snippet));

  if (snippets.length > 0) {
    return snippets;
  }

  return [buildSnippet(sourceId, sourceKind, sourceKind === "officialHiring" ? "role-context" : "company-summary", lines.slice(0, 2).join("\n"), "low")!];
}

export function buildCoverage(sources: CompanySourceEntry[]): CompanySourceCoverage {
  const sourceTypes = coverageTypeKinds.filter((item) => item.kinds.some((kind) => hasUsableSource(sources, kind))).map((item) => item.label);
  const omissions = coverageTypeKinds.filter((item) => !item.kinds.some((kind) => hasUsableSource(sources, kind))).map((item) => item.omission);
  return {
    summaryLabel: sourceTypes.length > 0 ? sourceTypes.join(" + ") : "OpenDART/공식 소스 부족",
    sourceTypes,
    omissions,
    coverageNote: omissions.length === 0
      ? "회사 구조와 최근 방향을 설명할 공식 소스 커버리지가 비교적 충분합니다."
      : sourceTypes.length >= 2
        ? "일부 공식 소스를 확보했지만 누락된 축은 문서 안에서 제한적으로만 해석해야 합니다."
        : "공식 소스 커버리지가 약해 공고/기본 회사 정보 중심으로만 보수적으로 해석해야 합니다.",
    externalEnrichmentUsed: false
  };
}

export function renderCompanySourceCoverageMarkdown(manifest: CompanySourceManifest | undefined): string {
  if (!manifest) {
    return "";
  }

  const lines = [
    "## 소스 커버리지",
    `- 수집 범위: ${manifest.coverage.summaryLabel}`,
    `- 수집 시각: ${manifest.collectedAt}`,
    `- 외부 보강: ${manifest.coverage.externalEnrichmentUsed ? "사용" : "사용 안 함"}`,
    `- Coverage note: ${manifest.coverage.coverageNote}`,
    "",
    "### 세부 소스",
    ...manifest.sources.map((source) => `- ${source.label}: ${translateStatus(source.status)}${source.title ? ` / ${source.title}` : ""}${source.url ? ` / ${source.url}` : ""}${source.note ? ` / ${source.note}` : ""}`)
  ];

  if (manifest.coverage.omissions.length > 0) {
    lines.push("", "### 현재 누락/제한", ...manifest.coverage.omissions.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim();
}

export function dedupeSnippets(snippets: CompanySourceSnippet[]): CompanySourceSnippet[] {
  const seen = new Set<string>();
  return snippets.filter((snippet) => {
    const key = `${snippet.sourceId}:${snippet.sectionLabel}:${snippet.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildMissingSource(kind: CompanySourceKind, collectedAt: string, note?: string): CompanySourceEntry {
  return {
    id: buildCompanySourceId(kind),
    tier: "official",
    kind,
    label: companySourceLabels[kind],
    status: "missing",
    fetchedAt: collectedAt,
    note
  };
}

function buildSnippet(
  sourceId: string,
  sourceKind: CompanySourceKind,
  sectionLabel: CompanySourceSnippet["sectionLabel"],
  text: string | undefined,
  confidence: CompanySourceSnippet["confidence"]
): CompanySourceSnippet | undefined {
  const normalized = normalizeJobPostingText(text ?? "");
  return normalized ? { sourceId, sourceKind, sectionLabel, text: normalized, confidence } : undefined;
}

function renderFinancialSummary(financial: OpenDartFinancialSummary): string {
  return `${financial.year} ${financial.fsDivision}: revenue ${formatAmount(financial.revenue)}, operating income ${formatAmount(financial.operatingIncome)}, net income ${formatAmount(financial.netIncome)}`;
}

function pickRelevantLines(lines: string[], pattern: RegExp): string | undefined {
  const matched = lines.filter((line) => pattern.test(line)).slice(0, 2);
  return matched.length > 0 ? matched.join("\n") : undefined;
}

function resolveOpenDartNote(companyResolution: OpenDartCompanyResolution | undefined): string {
  if (!companyResolution) return "OpenDART 조회를 수행하지 않았습니다.";
  if (companyResolution.status === "resolved") return "OpenDART 데이터를 정상 확보했습니다.";
  if ("notices" in companyResolution && companyResolution.notices.length > 0) return companyResolution.notices.join(" ");
  return "OpenDART 자료가 충분하지 않습니다.";
}

function hasUsableSource(sources: CompanySourceEntry[], kind: CompanySourceKind): boolean {
  return sources.some((source) => source.kind === kind && ["available", "fetched"].includes(source.status));
}

function translateStatus(status: CompanySourceEntry["status"]): string {
  return ({ available: "확보", fetched: "수집됨", failed: "실패", missing: "없음" })[status];
}

function formatAmount(amount: number | undefined): string {
  return typeof amount === "number" ? amount.toLocaleString("ko-KR") : "N/A";
}
