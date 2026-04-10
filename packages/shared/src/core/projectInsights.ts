import { CompanySourceManifest } from "./companySourceModel";

export const projectInsightArtifactDefinitions = [
  { key: "company", tabLabel: "기업 분석", fileName: "company-insight.md" },
  { key: "job", tabLabel: "직무 분석", fileName: "job-insight.md" },
  { key: "strategy", tabLabel: "지원 전략", fileName: "application-strategy.md" },
  { key: "question", tabLabel: "문항 분석", fileName: "question-analysis.md" }
] as const;

export type ProjectInsightDocumentKey = (typeof projectInsightArtifactDefinitions)[number]["key"];

export const projectInsightDocumentTitles = projectInsightArtifactDefinitions.map((artifact) => artifact.fileName);

const projectInsightTitleSet = new Set<string>(projectInsightDocumentTitles);

export function isProjectInsightDocumentTitle(title: string): boolean {
  return projectInsightTitleSet.has(title);
}

export function hasProjectInsightDocuments(
  documents: ReadonlyArray<{ title: string }>
): boolean {
  return documents.some((document) => isProjectInsightDocumentTitle(document.title));
}

export interface ProjectInsightDocumentView {
  key: ProjectInsightDocumentKey;
  tabLabel: string;
  title: string;
  fileName: string;
  content: string;
  available: boolean;
}

export interface ProjectInsightWorkspaceState {
  projectSlug: string;
  companyName: string;
  roleName?: string;
  jobPostingUrl?: string;
  postingAnalyzedAt?: string;
  insightLastGeneratedAt?: string;
  openDartCorpName?: string;
  openDartStockCode?: string;
  companySourceManifest?: CompanySourceManifest;
  documents: ProjectInsightDocumentView[];
}
