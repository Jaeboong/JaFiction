import { CompanySourceBundle, CompanySourceCoverage } from "./companySourceModel";
import type { CompanyContextBundle } from "./companyContext/types";
import { OpenDartCompanyResolution } from "./openDart";
import { ProjectRecord } from "./types";

export interface CompanyProfile {
  generatedAt: string;
  companyName: string;
  oneLineDefinition?: string;
  businessModel: string[];
  businessStructure: string[];
  growthDirection: string[];
  financialTakeaways: string[];
  officialDirection: string[];
  roleRelevance: string[];
  essayAngles: string[];
  interviewQuestions: string[];
  coverage: CompanySourceCoverage;
}

export interface SupportingInsightArtifacts {
  "job-insight.md": string;
  "application-strategy.md": string;
  "question-analysis.md": string;
}

export function buildCompanyAnalysisPrompt(
  project: ProjectRecord,
  companyResolution: OpenDartCompanyResolution | undefined,
  companySourceBundle: CompanySourceBundle,
  companyContext?: CompanyContextBundle
): string {
  return [
    "# ForJob Company Analysis Pre-pass",
    "",
    "You are generating a source-aware company analysis artifact for a Korean job application workflow.",
    "Use only the supplied source bundle, OpenDART enrichment, and reviewed role inputs.",
    "Do not fabricate unsupported facts. If source coverage is weak, say 'insufficient source coverage' plainly.",
    "",
    SOURCE_TIER_RULES_BLOCK,
    "",
    "Return exactly two files using this format:",
    "===BEGIN FILE: company-profile.json===",
    "{...valid json...}",
    "===END FILE===",
    "===BEGIN FILE: company-insight.md===",
    "...markdown...",
    "===END FILE===",
    "",
    "## company-profile.json requirements",
    "- valid JSON only",
    "- keys: oneLineDefinition, businessModel, businessStructure, growthDirection, financialTakeaways, officialDirection, roleRelevance, essayAngles, interviewQuestions",
    "- every value except oneLineDefinition must be an array of strings",
    "- essayAngles must contain at least 3 concrete, essay-ready company angles when source support exists",
    "",
    "## company-insight.md required sections",
    "1. 회사 한줄 정의",
    "2. 이 회사는 어떻게 돈을 버는가",
    "3. 핵심 사업 구조와 브랜드/서비스",
    "4. 최근 1~2년 성장축과 변화",
    "5. 재무 해석: 지원자가 봐야 할 포인트",
    "6. 공식 자료 기반 최근 방향성",
    "7. 이 직무가 회사 안에서 맡는 의미",
    "8. 자소서에서 강조할 회사 맥락 3개",
    "9. 면접에서 준비할 회사 질문",
    "10. 출처와 근거 강도",
    "",
    "Every section must connect company context back to the applicant's essay/interview preparation.",
    "",
    "## Project Inputs",
    JSON.stringify({
      companyName: project.companyName,
      roleName: project.roleName,
      mainResponsibilities: project.mainResponsibilities,
      qualifications: project.qualifications,
      preferredQualifications: project.preferredQualifications,
      keywords: project.keywords,
      jobPostingUrl: project.jobPostingUrl
    }, null, 2),
    "",
    "## OpenDART Enrichment JSON",
    JSON.stringify(companyResolution ?? { status: "notAttempted" }, null, 2),
    "",
    "## Company Source Manifest JSON",
    JSON.stringify(companySourceBundle.manifest, null, 2),
    "",
    "## Company Source Snippets JSON",
    JSON.stringify(companySourceBundle.snippets, null, 2),
    ...(companyContext ? [
      "",
      "## Web/News Source Snippets JSON (tier=contextual)",
      JSON.stringify(companyContext.sources.web.snippets, null, 2)
    ] : [])
  ].join("\n");
}

/**
 * Source Tier Rules 블록 (LLM에게 소스 권위 순서를 명시).
 * Stage D에서 추가. Snapshot test로 회귀 방지.
 */
export const SOURCE_TIER_RULES_BLOCK = `## Source Tier Rules (MUST follow)

You receive three source tiers. They have different authority levels.

1. FACTUAL (tier=factual) — OpenDART 공식 공시, 재무제표, 기업개황.
   - 회사명/대표/매출/설립연월/상장여부 등 "사실"은 이 tier가 최종 근거다.
   - 다른 tier와 충돌하면 factual이 항상 이긴다.
   - factual 데이터가 부재(dart source 없음)해도 추측으로 채우지 않는다.

2. CONTEXTUAL (tier=contextual) — 뉴스/웹 검색 결과 (최근 6~12개월).
   - 최근 이슈, 제품 출시, 업계 포지션, 회사 문화 시그널 서술에만 사용.
   - factual 숫자(매출/임직원 수)를 contextual snippet 기반으로 덮어쓰지 마라.
   - 인용 시 "~에 따르면 (news, <publishedAt>)" 형식으로 짧게 언급.
   - publishedAt이 9개월 이상 지났으면 "현재 유효한지 불확실" 표기.

3. ROLE (tier=role) — 공고 원문 + 사용자가 입력한 회사/직무 hints.
   - 직무 책임/자격요건/우대사항의 근거는 이 tier만 사용.
   - 회사 전반 사실을 이 tier에서 추론하지 마라 (공고는 자기소개용 마케팅 문구를 포함한다).

## Conflict resolution
- factual ≻ contextual ≻ role.
- 모든 tier에서 근거가 없으면 해당 섹션에 "출처 부족"을 명시하고 비워라. 절대 메꾸지 마라.

## Output requirements
- 각 아티팩트 섹션 말미의 "출처와 근거 강도" 블록에 tier별 근거 개수를 표기.
- factual 0건이면 "구조화된 공시 자료 없음 (비상장/해외법인/미확인)" 이라고 명기.`;

export function buildSupportingInsightPrompt(
  project: ProjectRecord,
  companyProfile: CompanyProfile,
  companyInsight: string
): string {
  return [
    "# ForJob Supporting Insight Generation",
    "",
    "You are generating the remaining insight artifacts for a Korean job application workflow.",
    "Use only the reviewed posting inputs and the synthesized company profile/insight below.",
    "Do not invent unsupported facts. If coverage is weak, keep interpretations conservative.",
    "",
    "Return exactly three markdown files using this format:",
    "===BEGIN FILE: job-insight.md===",
    "...markdown...",
    "===END FILE===",
    "===BEGIN FILE: application-strategy.md===",
    "...markdown...",
    "===END FILE===",
    "===BEGIN FILE: question-analysis.md===",
    "...markdown...",
    "===END FILE===",
    "",
    "## Project Inputs",
    JSON.stringify({
      companyName: project.companyName,
      roleName: project.roleName,
      mainResponsibilities: project.mainResponsibilities,
      qualifications: project.qualifications,
      preferredQualifications: project.preferredQualifications,
      keywords: project.keywords,
      jobPostingText: project.jobPostingText,
      essayQuestions: project.essayQuestions
    }, null, 2),
    "",
    "## Company Profile JSON",
    JSON.stringify(companyProfile, null, 2),
    "",
    "## Company Insight Markdown",
    companyInsight
  ].join("\n");
}

export function parseCompanyAnalysisResponse(
  text: string,
  companyName: string,
  coverage: CompanySourceCoverage
): { companyProfile: CompanyProfile; companyInsight: string } {
  const rawProfile = JSON.parse(stripCodeFences(extractArtifact(text, "company-profile.json")));
  const companyInsight = extractArtifact(text, "company-insight.md");
  return {
    companyProfile: {
      generatedAt: new Date().toISOString(),
      companyName,
      oneLineDefinition: toOptionalString(rawProfile.oneLineDefinition),
      businessModel: toStringArray(rawProfile.businessModel),
      businessStructure: toStringArray(rawProfile.businessStructure),
      growthDirection: toStringArray(rawProfile.growthDirection),
      financialTakeaways: toStringArray(rawProfile.financialTakeaways),
      officialDirection: toStringArray(rawProfile.officialDirection),
      roleRelevance: toStringArray(rawProfile.roleRelevance),
      essayAngles: toStringArray(rawProfile.essayAngles),
      interviewQuestions: toStringArray(rawProfile.interviewQuestions),
      coverage
    },
    companyInsight
  };
}

export function parseSupportingInsightResponse(text: string): SupportingInsightArtifacts {
  return {
    "job-insight.md": extractArtifact(text, "job-insight.md"),
    "application-strategy.md": extractArtifact(text, "application-strategy.md"),
    "question-analysis.md": extractArtifact(text, "question-analysis.md")
  };
}

function extractArtifact(text: string, fileName: string): string {
  // Primary format: ===BEGIN FILE: name=== ... ===END FILE===
  // Also accepts legacy <<<FILE: name>>> ... <<<END FILE>>> for backward compatibility
  const primary = new RegExp(`={3,}\\s*BEGIN\\s+FILE:\\s*${escapeRegExp(fileName)}\\s*={3,}\\s*([\\s\\S]*?)\\s*={3,}\\s*END\\s+FILE\\s*={3,}`, "i");
  const legacy = new RegExp(`<<<FILE:\\s*${escapeRegExp(fileName)}>>>\\s*([\\s\\S]*?)\\s*<<<END FILE>>>`, "i");
  const match = text.match(primary) ?? text.match(legacy);
  if (!match?.[1]?.trim()) {
    throw new Error(`인사이트 응답에서 ${fileName} 블록을 찾지 못했습니다.`);
  }
  return match[1].trim();
}

function stripCodeFences(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function toOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
