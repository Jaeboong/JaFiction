import { CompanySourceBundle, CompanySourceCoverage } from "./companySourceModel";
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
  companySourceBundle: CompanySourceBundle
): string {
  return [
    "# ForJob Company Analysis Pre-pass",
    "",
    "You are generating a source-aware company analysis artifact for a Korean job application workflow.",
    "Use only the supplied source bundle, OpenDART enrichment, and reviewed role inputs.",
    "Do not fabricate unsupported facts. If source coverage is weak, say 'insufficient source coverage' plainly.",
    "",
    "Return exactly two files using this format:",
    "<<<FILE: company-profile.json>>>",
    "{...valid json...}",
    "<<<END FILE>>>",
    "<<<FILE: company-insight.md>>>",
    "...markdown...",
    "<<<END FILE>>>",
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
    JSON.stringify(companySourceBundle.snippets, null, 2)
  ].join("\n");
}

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
    "<<<FILE: job-insight.md>>>",
    "...markdown...",
    "<<<END FILE>>>",
    "<<<FILE: application-strategy.md>>>",
    "...markdown...",
    "<<<END FILE>>>",
    "<<<FILE: question-analysis.md>>>",
    "...markdown...",
    "<<<END FILE>>>",
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
  const pattern = new RegExp(`<<<FILE:\\s*${escapeRegExp(fileName)}>>>\\s*([\\s\\S]*?)\\s*<<<END FILE>>>`, "i");
  const match = text.match(pattern);
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
