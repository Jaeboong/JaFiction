import { CompileContextProfile } from "../types";
import { truncateContinuationText } from "./continuation";

export type NotionRequestKind = "explicit" | "implicit" | "auto";

export interface NotionRequestDescriptor {
  text: string;
  kind: NotionRequestKind;
}

export function normalizeNotionRequest(request?: string): string | undefined {
  const trimmed = request?.trim();
  if (!trimmed) {
    return undefined;
  }

  return /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : undefined;
}

export function resolveNotionRequestDescriptor(
  explicitRequest?: string,
  continuationNote?: string,
  pageIds?: string[]
): NotionRequestDescriptor | undefined {
  const normalizedExplicit = normalizeNotionRequest(explicitRequest);
  if (normalizedExplicit) {
    return { text: normalizedExplicit, kind: "explicit" };
  }

  const implicitRequest = normalizeNotionRequest(deriveImplicitNotionRequest(continuationNote));
  if (implicitRequest) {
    return { text: implicitRequest, kind: "implicit" };
  }

  const autoRequest = buildAutoNotionRequest(pageIds);
  if (autoRequest) {
    return { text: autoRequest, kind: "auto" };
  }

  return undefined;
}

export function compressNotionBrief(brief: string, profile: CompileContextProfile): string {
  const trimmed = brief.trim();
  if (!trimmed) {
    return "";
  }
  if (profile === "full") {
    return trimmed;
  }

  const maxItems = profile === "compact" ? 5 : 3;
  const maxChars = profile === "compact" ? 900 : 420;
  const maxItemChars = profile === "compact" ? 180 : 130;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s+/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  const bullets: string[] = [];
  for (const line of lines) {
    const candidate = `- ${truncateContinuationText(line, maxItemChars)}`;
    if (bullets.length >= maxItems) {
      break;
    }
    if (sumPromptBlockChars([bullets.join("\n"), candidate]) > maxChars) {
      break;
    }
    if (!bullets.includes(candidate)) {
      bullets.push(candidate);
    }
  }

  if (bullets.length === 0) {
    return truncateContinuationText(trimmed, maxChars);
  }

  return bullets.join("\n");
}

export function deriveImplicitNotionRequest(continuationNote?: string): string | undefined {
  const trimmed = normalizeNotionRequest(continuationNote);
  if (!trimmed) {
    return undefined;
  }

  return /(?:\bnotion\b|노션)/i.test(trimmed) ? trimmed : undefined;
}

export function buildAutoNotionRequest(pageIds?: string[]): string | undefined {
  if (!pageIds || pageIds.length === 0) {
    return undefined;
  }

  return `Fetch these Notion pages and summarize relevant context: ${pageIds.join(", ")}`;
}

function sumPromptBlockChars(blocks: Array<string | undefined> = []): number {
  return blocks.reduce((sum, block) => sum + (block?.length ?? 0), 0);
}
