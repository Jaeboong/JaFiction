import { RunContinuationContext } from "../storage";
import { RunChatMessage } from "../types";

export function appendContinuationContext(
  contextMarkdown: string,
  continuationContext?: RunContinuationContext,
  continuationNote?: string
): string {
  const continuationBlock = buildContinuationBlock(continuationContext, continuationNote);
  if (!continuationBlock) {
    return contextMarkdown;
  }

  return [contextMarkdown, continuationBlock].filter(Boolean).join("\n\n");
}

export function buildContinuationBlock(
  continuationContext?: RunContinuationContext,
  continuationNote?: string
): string {
  if (!continuationContext) {
    return continuationNote
      ? [
          "## Continuation Request",
          continuationNote
        ].join("\n\n")
      : "";
  }

  const sections = [
    "## Previous Run Context",
    `Continuing from run \`${continuationContext.record.id}\` started at ${continuationContext.record.startedAt}.`,
    continuationNote ? `### What To Continue Now\n${continuationNote}` : "",
    `### Previous Question\n${continuationContext.record.question}`,
    `### Previous Draft\n${continuationContext.record.draft}`,
    continuationContext.summary ? `### Previous Summary\n${continuationContext.summary}` : "",
    continuationContext.improvementPlan ? `### Previous Improvement Plan\n${continuationContext.improvementPlan}` : "",
    continuationContext.revisedDraft ? `### Previous Revised Draft\n${continuationContext.revisedDraft}` : "",
    continuationContext.notionBrief ? `### Previous Notion Brief\n${continuationContext.notionBrief}` : "",
    buildPreviousConversationHighlights(continuationContext.chatMessages)
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function buildPreviousConversationHighlights(messages?: RunChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return "";
  }

  const relevant = messages
    .filter((message) => message.status === "completed" && message.speakerRole !== "system")
    .slice(-6);
  if (relevant.length === 0) {
    return "";
  }

  const lines = relevant.map((message) => {
    const subtitle = message.speakerRole === "user"
      ? "You"
      : `${message.speaker}${message.round !== undefined ? ` round ${message.round}` : ""}`;
    return `- ${subtitle}: ${truncateContinuationText(message.content, 280)}`;
  });

  return `### Previous Conversation Highlights\n${lines.join("\n")}`;
}

export function truncateContinuationText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}
