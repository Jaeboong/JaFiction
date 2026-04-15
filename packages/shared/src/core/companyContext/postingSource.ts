import { ProjectRecord } from "../types";
import { CompanySourceSnippet } from "../companySourceModel";
import { PostingSourcePayload } from "./types";

export function derivePostingSource(project: ProjectRecord): PostingSourcePayload {
  const snippets: CompanySourceSnippet[] = [];
  const sourceId = "posting-derived";

  if (project.mainResponsibilities?.trim()) {
    snippets.push({
      sourceId,
      sourceKind: "postingDerived",
      sectionLabel: "role-context",
      text: project.mainResponsibilities.trim(),
      confidence: "high",
      sourceTier: "role"
    });
  }

  if (project.qualifications?.trim()) {
    snippets.push({
      sourceId,
      sourceKind: "postingDerived",
      sectionLabel: "role-context",
      text: project.qualifications.trim(),
      confidence: "high",
      sourceTier: "role"
    });
  }

  if (project.preferredQualifications?.trim()) {
    snippets.push({
      sourceId,
      sourceKind: "postingDerived",
      sectionLabel: "role-context",
      text: project.preferredQualifications.trim(),
      confidence: "medium",
      sourceTier: "role"
    });
  }

  if (project.jobPostingText?.trim() && snippets.length === 0) {
    const lines = project.jobPostingText.trim().split("\n").filter((l) => l.trim().length >= 8).slice(0, 3);
    if (lines.length > 0) {
      snippets.push({
        sourceId,
        sourceKind: "postingDerived",
        sectionLabel: "role-context",
        text: lines.join("\n"),
        confidence: "medium",
        sourceTier: "role"
      });
    }
  }

  return {
    companyName: project.companyName,
    roleName: project.roleName,
    mainResponsibilities: project.mainResponsibilities,
    qualifications: project.qualifications,
    preferredQualifications: project.preferredQualifications,
    keywords: project.keywords ?? [],
    jobPostingText: project.jobPostingText,
    snippets
  };
}
