import { CompileContextProfile, ContextDocument, ProjectRecord } from "./types";
import { DocumentContentReader } from "./storageInterfaces";

export interface CompileContextRequest {
  project: ProjectRecord;
  profileDocuments: ContextDocument[];
  projectDocuments: ContextDocument[];
  selectedDocumentIds: string[];
  question: string;
  draft: string;
  charLimit?: number;
  profile?: CompileContextProfile;
}

export interface CompileContextResult {
  markdown: string;
  includedDocuments: ContextDocument[];
}

export class ContextCompiler {
  constructor(private readonly storage: DocumentContentReader) {}

  async compile(request: CompileContextRequest): Promise<CompileContextResult> {
    const profile = request.profile ?? "full";
    const selectedIds = new Set(request.selectedDocumentIds);
    const includedProfileDocuments = request.profileDocuments.filter(
      (document) => document.pinnedByDefault || selectedIds.has(document.id)
    );
    const pinnedProjectIds = new Set(request.project.pinnedDocumentIds);
    const includedProjectDocuments = request.projectDocuments.filter(
      (document) => document.pinnedByDefault || pinnedProjectIds.has(document.id) || selectedIds.has(document.id)
    );
    const includedDocuments = [...includedProfileDocuments, ...includedProjectDocuments];

    const sections: string[] = ["# ForJob Compiled Context"];
    sections.push("## Project");
    sections.push(`- Company: ${request.project.companyName}`);
    if (request.project.roleName) {
      sections.push(`- Role: ${request.project.roleName}`);
    }
    if (request.project.overview?.trim()) {
      sections.push("");
      sections.push("## Job Overview");
      sections.push(profile === "minimal" ? summarizeText(request.project.overview, 320) : request.project.overview.trim());
    }
    if (request.project.mainResponsibilities?.trim()) {
      sections.push("");
      sections.push("## Main Responsibilities");
      sections.push(profile === "minimal" ? summarizeText(request.project.mainResponsibilities, 320) : request.project.mainResponsibilities.trim());
    }
    if (request.project.qualifications?.trim()) {
      sections.push("");
      sections.push("## Qualifications");
      sections.push(profile === "minimal" ? summarizeText(request.project.qualifications, 320) : request.project.qualifications.trim());
    }
    if (request.project.preferredQualifications?.trim()) {
      sections.push("");
      sections.push("## Preferred Qualifications");
      sections.push(
        profile === "minimal"
          ? summarizeText(request.project.preferredQualifications, 320)
          : request.project.preferredQualifications.trim()
      );
    }
    if (request.project.benefits?.trim()) {
      sections.push("");
      sections.push("## Benefits");
      sections.push(profile === "minimal" ? summarizeText(request.project.benefits, 320) : request.project.benefits.trim());
    }
    if (request.project.hiringProcess?.trim()) {
      sections.push("");
      sections.push("## Hiring Process");
      sections.push(profile === "minimal" ? summarizeText(request.project.hiringProcess, 320) : request.project.hiringProcess.trim());
    }
    if (request.project.insiderView?.trim()) {
      sections.push("");
      sections.push("## Insider View");
      sections.push(profile === "minimal" ? summarizeText(request.project.insiderView, 320) : request.project.insiderView.trim());
    }
    if (request.project.otherInfo?.trim()) {
      sections.push("");
      sections.push("## Other Information");
      sections.push(profile === "minimal" ? summarizeText(request.project.otherInfo, 320) : request.project.otherInfo.trim());
    }
    if (request.project.keywords?.length) {
      sections.push("");
      sections.push("## Job Keywords");
      sections.push(request.project.keywords.map((keyword) => `- ${keyword}`).join("\n"));
    }

    sections.push("## Evaluation Rubric");
    sections.push(renderRubric(request.project.rubric.trim(), profile));

    sections.push("## Essay Question");
    sections.push(profile === "minimal" ? summarizeText(request.question.trim(), 480) : request.question.trim());

    sections.push(profile === "minimal" ? "## Current Draft Excerpt" : "## Current Draft");
    sections.push(renderDraft(request.draft.trim(), profile));

    if (request.charLimit) {
      const current = request.draft.length;
      const remaining = request.charLimit - current;
      sections.push("## Character Limit");
      sections.push(
        [
          `Maximum: ${request.charLimit} characters (including spaces).`,
          `Current draft: approximately ${current} characters.`,
          `Remaining budget: approximately ${remaining} characters.`,
          "The revised draft MUST stay within this limit. Do not exceed it."
        ].join("\n")
      );
    }

    sections.push("## Common Profile Context");
    sections.push(await this.renderDocumentSection(includedProfileDocuments, profile));

    sections.push("## Project Context");
    sections.push(await this.renderDocumentSection(includedProjectDocuments, profile));

    return {
      markdown: sections.join("\n\n").trim(),
      includedDocuments
    };
  }

  private async renderDocumentSection(documents: ContextDocument[], profile: CompileContextProfile): Promise<string> {
    if (documents.length === 0) {
      return "_No documents selected._";
    }
    if (profile === "minimal") {
      return "_Document bodies omitted in minimal profile to preserve prompt budget._";
    }

    const chunks: string[] = [];
    for (const document of documents) {
      chunks.push(`### ${document.title}`);
      chunks.push(`- Source type: ${document.sourceType}`);
      if (document.note) {
        chunks.push(`- Note: ${document.note}`);
      }

      if (document.normalizedPath) {
        const content = await this.storage.readDocumentNormalizedContent(document);
        if (!content?.trim()) {
          chunks.push("_Normalized content was empty._");
          continue;
        }

        chunks.push(
          profile === "compact"
            ? buildDocumentDigest(content, document.sourceType)
            : content.trim()
        );
      } else {
        chunks.push("_Raw file only. Use the stored file and note for reference._");
      }
    }

    return chunks.join("\n\n");
  }
}

function renderRubric(rubric: string, profile: CompileContextProfile): string {
  if (!rubric) {
    return "- No rubric configured";
  }

  if (profile === "full") {
    return rubric;
  }

  return summarizeText(rubric, profile === "compact" ? 900 : 360);
}

function renderDraft(draft: string, profile: CompileContextProfile): string {
  if (!draft) {
    return "_No draft provided._";
  }

  if (profile === "full") {
    return draft;
  }

  if (profile === "compact") {
    return draft.length <= 2800 ? draft : summarizeText(draft, 2800);
  }

  return summarizeText(draft, 900);
}

function buildDocumentDigest(content: string, sourceType: ContextDocument["sourceType"]): string {
  const normalized = content.trim();
  if (!normalized) {
    return "_Normalized content was empty._";
  }

  return [
    `- Prompt digest (${sourceType}):`,
    summarizeText(normalized, 900)
  ].join("\n");
}

function summarizeText(text: string, maxChars: number): string {
  const normalized = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
