import {
  CompileContextProfile,
  DiscussionLedger,
  PromptMetrics,
  RealtimeSectionDefinition,
  RunArtifacts
} from "../../types";

export interface BuiltPrompt {
  text: string;
  promptKind: PromptMetrics["promptKind"];
  contextProfile: CompileContextProfile;
  contextChars: number;
  historyChars: number;
  notionBriefChars: number;
  discussionLedgerChars: number;
}

export function buildPrompt(options: {
  promptKind: PromptMetrics["promptKind"];
  contextProfile: CompileContextProfile;
  contextMarkdown: string;
  notionBrief?: string;
  historyBlocks?: string[];
  discussionLedgerBlock?: string;
  sections: Array<string | undefined>;
}): BuiltPrompt {
  return {
    text: options.sections.filter(Boolean).join("\n"),
    promptKind: options.promptKind,
    contextProfile: options.contextProfile,
    contextChars: options.contextMarkdown.length,
    historyChars: sumPromptBlockChars(options.historyBlocks),
    notionBriefChars: options.notionBrief?.trim().length ?? 0,
    discussionLedgerChars: options.discussionLedgerBlock?.length ?? 0
  };
}

export function sumPromptBlockChars(blocks: Array<string | undefined> = []): number {
  return blocks.reduce((sum, block) => sum + (block?.length ?? 0), 0);
}

export function formatDiscussionLedgerItems(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- 없음"];
}

function formatDiscussionLedgerInlineItems(items?: string[]): string {
  return items && items.length > 0 ? items.join(" | ") : "없음";
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function finalizePromptMetrics(prompt: BuiltPrompt): PromptMetrics {
  return {
    promptKind: prompt.promptKind,
    contextProfile: prompt.contextProfile,
    promptChars: prompt.text.length,
    estimatedPromptTokens: Math.ceil(prompt.text.length / 4),
    contextChars: prompt.contextChars,
    historyChars: prompt.historyChars,
    notionBriefChars: prompt.notionBriefChars,
    discussionLedgerChars: prompt.discussionLedgerChars
  };
}

export function buildValidSectionKeysBlock(definitions: RealtimeSectionDefinition[]): string {
  if (definitions.length === 0) {
    return "";
  }

  return [
    "## Valid Section Keys",
    definitions.map((definition) => definition.key).join(", "),
    "",
    "※ 섹션 키는 반드시 위 목록 중 하나여야 한다. 챌린지 텍스트나 ID를 섹션 키로 사용하지 말 것."
  ].join("\n");
}

export function buildDiscussionLedgerBlock(ledger?: DiscussionLedger, heading = "## Discussion Ledger", stripped = false): string {
  if (!ledger) {
    return heading ? `${heading}\n\n_No discussion ledger yet._` : "_No discussion ledger yet._";
  }

  return [
    ...(heading ? [heading] : []),
    `- Updated At Round: ${ledger.updatedAtRound}`,
    `- Target Section: ${ledger.targetSection}`,
    ...(ledger.targetSectionKey ? [`- Target Section Key: ${ledger.targetSectionKey}`] : []),
    ...(ledger.nextOwner ? [`- Next Owner: ${ledger.nextOwner}`] : []),
    "",
    ...(!stripped ? [
      "### Current Focus",
      ledger.currentFocus,
      "",
      ...(ledger.currentObjective ? ["### Current Objective", ledger.currentObjective, ""] : []),
      ...(ledger.rewriteDirection ? ["### Rewrite Direction", ledger.rewriteDirection, ""] : []),
      "### Mini Draft",
      ledger.miniDraft,
      "",
    ] : []),
    ...(ledger.sectionDraft ? ["### Section Draft", ledger.sectionDraft, ""] : []),
    ...(ledger.changeRationale ? ["### Change Rationale", ledger.changeRationale, ""] : []),
    ...(!stripped && ledger.mustKeep ? ["### Must Keep", ...formatDiscussionLedgerItems(ledger.mustKeep), ""] : []),
    ...(!stripped && ledger.mustResolve ? ["### Must Resolve", ...formatDiscussionLedgerItems(ledger.mustResolve), ""] : []),
    ...(ledger.availableEvidence ? ["### Available Evidence", ...formatDiscussionLedgerItems(ledger.availableEvidence), ""] : []),
    ...(ledger.exitCriteria ? ["### Exit Criteria", ...formatDiscussionLedgerItems(ledger.exitCriteria), ""] : []),
    "### Accepted Decisions",
    ...formatDiscussionLedgerItems(ledger.acceptedDecisions),
    "",
    "### Open Challenges",
    ...formatDiscussionLedgerItems(ledger.openChallenges),
    "",
    "### Deferred Challenges",
    ...formatDiscussionLedgerItems(ledger.deferredChallenges)
  ].join("\n");
}

export function buildDrafterContextBlock(ledger?: DiscussionLedger): string {
  if (!ledger) {
    return "Discussion Ledger: 없음";
  }

  return [
    `Updated At Round: ${ledger.updatedAtRound}`,
    `Target Section: ${ledger.targetSection}`,
    ...(ledger.targetSectionKey ? [`Target Section Key: ${ledger.targetSectionKey}`] : []),
    ...(ledger.nextOwner ? [`Next Owner: ${ledger.nextOwner}`] : []),
    `Current Focus: ${ledger.currentFocus}`,
    ...(ledger.currentObjective ? [`Current Objective: ${ledger.currentObjective}`] : []),
    ...(ledger.rewriteDirection ? [`Rewrite Direction: ${ledger.rewriteDirection}`] : []),
    `Mini Draft: ${ledger.miniDraft}`,
    `Must Keep: ${formatDiscussionLedgerInlineItems(ledger.mustKeep)}`,
    `Must Resolve: ${formatDiscussionLedgerInlineItems(ledger.mustResolve)}`,
    `Available Evidence: ${formatDiscussionLedgerInlineItems(ledger.availableEvidence)}`,
    `Exit Criteria: ${formatDiscussionLedgerInlineItems(ledger.exitCriteria)}`,
    ...(ledger.sectionDraft ? [`Section Draft: ${ledger.sectionDraft}`] : []),
    ...(ledger.changeRationale ? [`Change Rationale: ${ledger.changeRationale}`] : []),
    `Accepted Decisions: ${formatDiscussionLedgerInlineItems(ledger.acceptedDecisions)}`,
    `Open Challenges: ${formatDiscussionLedgerInlineItems(ledger.openChallenges)}`,
    `Deferred Challenges: ${formatDiscussionLedgerInlineItems(ledger.deferredChallenges)}`
  ].join("\n");
}

export function buildChallengeTicketBlock(ledger?: DiscussionLedger): string {
  const tickets = ledger?.tickets ?? [];
  if (tickets.length === 0) {
    return "## Challenge Tickets\n\n_No challenge tickets yet._";
  }

  return [
    "## Challenge Tickets",
    ...tickets.map((ticket) =>
      `- [${ticket.id}] ${ticket.status} | ${ticket.severity} | sectionKey=${ticket.sectionKey} | sectionLabel=${ticket.sectionLabel} | text=${ticket.text}`
    )
  ].join("\n");
}

export function buildSessionSnapshotBlock(artifacts?: RunArtifacts): string {
  if (!artifacts) {
    return "";
  }

  return [
    "## Current Session Snapshot",
    `### Current Summary\n${artifacts.summary}`,
    `### Current Improvement Plan\n${artifacts.improvementPlan}`,
    `### Current Revised Draft\n${artifacts.revisedDraft}`,
    artifacts.finalChecks ? `### Current Final Checks\n${artifacts.finalChecks}` : ""
  ].join("\n\n");
}

export function buildBindingDirectiveBlock(userInterventions: Array<{ round: number; text: string }>, unitLabel = "cycle"): string {
  if (userInterventions.length === 0) {
    return "";
  }

  return [
    "## Must Resolve Priority Override",
    "Treat every item below as binding. Copy the newest one to the top of Must Resolve with the exact prefix '[USER DIRECTIVE - 최우선 지시]'.",
    "",
    ...userInterventions.slice(-6).map((item) =>
      item.round <= 0
        ? `- [USER DIRECTIVE - 최우선 지시] ${item.text}`
        : `- [USER DIRECTIVE - 최우선 지시] (${unitLabel} ${item.round} 이후) ${item.text}`
    )
  ].join("\n");
}

export function buildUserGuidanceBlock(userInterventions: Array<{ round: number; text: string }>, unitLabel = "cycle"): string {
  if (userInterventions.length === 0) {
    return "";
  }

  return [
    "## User Guidance",
    "IMPORTANT: The user (essay author) has provided binding guidance below.",
    "The user knows their own experience better than any reviewer.",
    "Treat these interventions as directives, not hints.",
    "If the user disagrees with reviewer consensus, explore HOW to make the user's preferred direction work rather than dismissing it.",
    "Only push back if the user's direction has a factual or logical problem that cannot be resolved by better writing.",
    "",
    ...userInterventions.slice(-6).map((item) =>
      item.round <= 0
        ? `### Before Start\n${item.text}`
        : `### After ${unitLabel} ${item.round}\n${item.text}`
    )
  ].join("\n\n");
}
