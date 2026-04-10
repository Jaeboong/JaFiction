import {
  dedupeStrings,
  getLedgerTargetSectionKey,
  getLedgerTickets,
  InterventionPartialSnapshot
} from "../discussion/discussionLedger";
import { RealtimeReviewerVerdictSummary } from "../discussion/convergenceEvaluator";
import {
  extractDiscussionLedger,
  extractRealtimeReviewerObjection,
  extractRealtimeReviewerStatus
} from "../parsing/responseParsers";
import { turnLabel } from "../participants";
import { buildRealtimeSectionDefinitions } from "../realtimeSections";
import { truncateContinuationText } from "../continuation";
import { NotionRequestDescriptor } from "../notionRequest";
import { getPerspectiveInstruction } from "./deepFeedbackPrompts";
import {
  buildFinalEssayKoreanInstruction,
  buildFormalToneRuleBlock,
  buildNotionPrePassKoreanInstruction,
  buildRealtimeKoreanResponseInstruction,
  buildStructuredKoreanResponseInstruction
} from "./languageRules";
import {
  buildBindingDirectiveBlock,
  buildChallengeTicketBlock,
  buildDrafterContextBlock,
  buildDiscussionLedgerBlock,
  buildPrompt,
  buildUserGuidanceBlock,
  buildValidSectionKeysBlock,
  BuiltPrompt,
  formatDiscussionLedgerItems
} from "./promptBlocks";
import {
  DiscussionLedger,
  RealtimeSectionDefinition,
  ReviewerPerspective,
  ReviewTurn
} from "../../types";

interface RealtimeReferencePacket {
  refId: string;
  sourceLabel: string;
  summary: string;
}

export function buildRealtimeCoordinatorDiscussionPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  ledger?: DiscussionLedger,
  options?: {
    reviewerVerdictSummary?: RealtimeReviewerVerdictSummary;
    convergenceNoticeRounds?: number;
  }
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const bindingDirectiveBlock = buildBindingDirectiveBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 320 });
  const previousRoundBlock = buildPreviousRoundReviewerSummary(turns, round);
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "", true);
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);
  const toneRuleBlock = buildFormalToneRuleBlock();
  const sectionDefinitions = buildRealtimeSectionDefinitions(ledger);
  const validSectionKeysBlock = buildValidSectionKeysBlock(sectionDefinitions);
  const sectionRoleBoundaryBlock = buildSectionRoleBoundaryBlock(ledger, sectionDefinitions);
  const reviewerVerdictBlock = buildReviewerVerdictPromptBlock(options?.reviewerVerdictSummary);
  const convergenceNoticeBlock = buildConvergenceNoticeBlock(options?.convergenceNoticeRounds);
  const hasReviewerHistory = turns.some((turn) => turn.role === "reviewer" && turn.status === "completed" && turn.round > 0);

  return buildPrompt({
    promptKind: "realtime-coordinator-open",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [bindingDirectiveBlock, previousRoundBlock, challengeTicketsBlock, historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are the coordinator for a realtime multi-model essay review discussion.",
    buildRealtimeKoreanResponseInstruction(),
    toneRuleBlock,
    validSectionKeysBlock,
    sectionRoleBoundaryBlock,
    reviewerVerdictBlock,
    convergenceNoticeBlock,
    `Round: ${round}`,
    "This turn is facilitation only. Do not write the full essay yet.",
    "Return Markdown with exactly these top-level sections:",
    "## Current Focus",
    "## Target Section",
    "## Target Section Key",
    "## Current Objective",
    "## Rewrite Direction",
    "## Must Keep",
    "## Must Resolve",
    "## Available Evidence",
    "## Exit Criteria",
    "## Next Owner",
    "## Mini Draft",
    "## Accepted Decisions",
    "## Open Challenges",
    "## Deferred Challenges",
    "## Section Outcome",
    "## Challenge Decisions",
    "Write Current Focus as one line and Target Section as a short label.",
    "Write Target Section Key as a stable slug for the current target section.",
    "Use Current Objective to define the section-level success target.",
    "Use Rewrite Direction to describe how the next section draft should change without writing the whole essay.",
    "Must Keep, Must Resolve, Available Evidence, and Exit Criteria must use bullet items. If empty, write exactly '- 없음'.",
    "Next Owner should usually be section_drafter unless more research is clearly required.",
    "Mini Draft must be bullet points or short sentence starters only — never full paragraph prose. The drafter converts it into actual text. Do not write the full section here.",
    "Accepted Decisions, Open Challenges, and Deferred Challenges must use bullet items. If empty, write exactly '- 없음'.",
    "Open Challenges are blockers for the current Target Section only.",
    "Deferred Challenges are valid follow-up issues for later sections or final polish.",
    "Write Section Outcome as exactly one of: keep-open, close-section, handoff-next-section, write-final.",
    "Use Challenge Decisions to mark ticket transitions with lines like '- [ticketId] close' or '- [new] add | sectionKey=... | sectionLabel=... | severity=advisory | text=...'.",
    "If Open Challenges are empty but Deferred Challenges remain, hand off Target Section to the next deferred issue instead of reopening the completed section.",
    "Current Focus, Rewrite Direction, Must Keep, and Must Resolve must be derived fresh from the current reviewer feedback and available evidence. Do not copy or lightly rephrase these fields from the previous ledger — the previous values are intentionally omitted to force a new reading.",
    hasReviewerHistory
      ? "Use the latest reviewer feedback and the previous ledger to move one unresolved issue closer to convergence."
      : "Open the discussion by naming the single highest-leverage issue and proposing the first Mini Draft.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    challengeTicketsBlock,
    "",
    bindingDirectiveBlock,
    bindingDirectiveBlock ? "" : "",
    previousRoundBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock
    ]
  });
}

export function buildRealtimeCoordinatorRedirectPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  messages: string[],
  ledger?: DiscussionLedger,
  options?: {
    reviewerVerdictSummary?: RealtimeReviewerVerdictSummary;
    convergenceNoticeRounds?: number;
  }
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const bindingDirectiveBlock = buildBindingDirectiveBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 320 });
  const previousRoundBlock = buildPreviousRoundReviewerSummary(turns, round);
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "", true);
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);
  const toneRuleBlock = buildFormalToneRuleBlock();
  const sectionDefinitions = buildRealtimeSectionDefinitions(ledger);
  const validSectionKeysBlock = buildValidSectionKeysBlock(sectionDefinitions);
  const sectionRoleBoundaryBlock = buildSectionRoleBoundaryBlock(ledger, sectionDefinitions);
  const reviewerVerdictBlock = buildReviewerVerdictPromptBlock(options?.reviewerVerdictSummary);
  const convergenceNoticeBlock = buildConvergenceNoticeBlock(options?.convergenceNoticeRounds);
  const userMessageBlock = [
    "## New User Messages",
    ...messages.map((message, index) => `### Message ${index + 1}\n${message}`)
  ].join("\n\n");

  return buildPrompt({
    promptKind: "realtime-coordinator-redirect",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [bindingDirectiveBlock, previousRoundBlock, challengeTicketsBlock, historyBlock, userMessageBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are the coordinator for a realtime multi-model essay review discussion.",
    buildRealtimeKoreanResponseInstruction(),
    toneRuleBlock,
    validSectionKeysBlock,
    sectionRoleBoundaryBlock,
    reviewerVerdictBlock,
    convergenceNoticeBlock,
    `Round: ${round}`,
    "The user just redirected the discussion. Reply first and reset the direction.",
    "Return Markdown with exactly these top-level sections:",
    "## Current Focus",
    "## Target Section",
    "## Target Section Key",
    "## Current Objective",
    "## Rewrite Direction",
    "## Must Keep",
    "## Must Resolve",
    "## Available Evidence",
    "## Exit Criteria",
    "## Next Owner",
    "## Mini Draft",
    "## Accepted Decisions",
    "## Open Challenges",
    "## Deferred Challenges",
    "## Section Outcome",
    "## Challenge Decisions",
    "Acknowledge the new user message by reflecting it inside Current Focus and Rewrite Direction.",
    "Write Target Section Key as a stable slug for the current target section.",
    "Must Keep, Must Resolve, Available Evidence, and Exit Criteria must use bullet items. If empty, write exactly '- 없음'.",
    "Next Owner should usually be section_drafter unless more research is clearly required.",
    "Mini Draft must be bullet points or short sentence starters only — never full paragraph prose. The drafter converts it into actual text.",
    "Accepted Decisions, Open Challenges, and Deferred Challenges must use bullet items. If empty, write exactly '- 없음'.",
    "Open Challenges are blockers for the current Target Section only.",
    "Deferred Challenges are valid follow-up issues for later sections or final polish.",
    "Write Section Outcome as exactly one of: keep-open, close-section, handoff-next-section, write-final.",
    "Use Challenge Decisions to mark ticket transitions with lines like '- [ticketId] close' or '- [new] add | sectionKey=... | sectionLabel=... | severity=advisory | text=...'.",
    "If Open Challenges are empty but Deferred Challenges remain, hand off Target Section to the next deferred issue instead of reopening the completed section.",
    "Current Focus, Rewrite Direction, Must Keep, and Must Resolve must be derived fresh from the current reviewer feedback and available evidence. Do not copy or lightly rephrase these fields from the previous ledger — the previous values are intentionally omitted to force a new reading.",
    "Do not write the full essay yet.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    challengeTicketsBlock,
    "",
    bindingDirectiveBlock,
    bindingDirectiveBlock ? "" : "",
    previousRoundBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock,
    "",
    userMessageBlock
    ]
  });
}

export function buildRealtimeReviewerPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  allTurns: ReviewTurn[],
  round: number,
  ledger: DiscussionLedger | undefined,
  currentParticipantId: string,
  perspective?: ReviewerPerspective
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const toneRuleBlock = buildFormalToneRuleBlock();
  // 같은 라운드의 다른 리뷰어 응답은 보이지 않게 한다 — 독립 평가 보장
  const visibleTurns = allTurns.filter((turn) => {
    if (turn.round === round && turn.role === "reviewer" && turn.participantId !== currentParticipantId) {
      return false;
    }
    return true;
  });
  const historyBlock = buildRealtimeDiscussionHistory(
    visibleTurns.filter((turn) => turn.participantId === "coordinator" && turn.round < round),
    { maxTurns: 2, maxCharsPerTurn: 220 }
  );
  const coordinatorReferenceBlock = buildCoordinatorReferenceBlock(visibleTurns, round);
  const reviewerReferenceBlock = buildReviewerReferencesBlock(visibleTurns, round, currentParticipantId);
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "");
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);
  const perspectiveInstruction = getPerspectiveInstruction(perspective);
  const challengeHeaderInstruction = [
    'Challenge header uses exactly one verdict token on the header line only.',
    'Use "Challenge: keep-open", "Challenge: close", or "Challenge: defer".',
    'If you are referring to an existing ticket or a new ticket, you may write "Challenge: [ticketId] keep-open" or "Challenge: [new] defer".',
    '티켓 ID는 반드시 대괄호를 포함한 형식으로 출력: [t-xxx-xxxxxx].',
    '플레이스홀더가 아님 — 실제 티켓 ID를 대괄호 안에 그대로 넣을 것.'
  ].join(" ");
  const crossFeedbackInstruction = [
    'Cross-feedback header uses exactly one verdict token on the header line only.',
    'Use "Cross-feedback: agree" or "Cross-feedback: disagree".',
    'If you are explicitly citing a reference, you may write "Cross-feedback: [refId] agree" or "Cross-feedback: [refId] disagree".'
  ].join(" ");

  return buildPrompt({
    promptKind: "realtime-reviewer",
    contextProfile: "minimal",
    contextMarkdown,
    notionBrief,
    historyBlocks: [coordinatorReferenceBlock, reviewerReferenceBlock, challengeTicketsBlock, historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are a reviewer in a realtime multi-model essay discussion.",
    buildRealtimeKoreanResponseInstruction(),
    toneRuleBlock,
    perspectiveInstruction,
    `Round: ${round}`,
    "Review the current discussion ledger, especially the Section Draft when available and otherwise the Mini Draft seed.",
    "Keep the blind review rule: do not assume anything about same-round reviewer replies that are not shown below.",
    "Respond in exactly these 4 labeled sections in this order.",
    'Section 1 header must be exactly "Status: APPROVE", "Status: REVISE", or "Status: BLOCK". Do not add explanation lines under Status.',
    'Section 2 header must be exactly "Mini Draft:" and the explanation must be written only on the following line or lines in natural Korean.',
    'Section 3 header must start with "Challenge:" and the verdict must stay only on the header line.',
    challengeHeaderInstruction,
    'Write the Challenge explanation only on the following line or lines in natural Korean.',
    'Do not repeat challenge verdict tokens such as "keep-open", "close", or "defer" inside the explanation body.',
    'Section 4 header must start with "Cross-feedback:" and the verdict must stay only on the header line.',
    crossFeedbackInstruction,
    'Write the Cross-feedback explanation only on the following line or lines in natural Korean.',
    'Do not repeat cross-feedback verdict tokens such as "agree" or "disagree" inside the explanation body.',
    "Use APPROVE if the current direction is section-ready.",
    "Use REVISE if improvement is recommended but it should not block closing the current Target Section.",
    "Use BLOCK only if the current Target Section should not close yet.",
    "Do not use headings or bullet lists.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    challengeTicketsBlock,
    "",
    coordinatorReferenceBlock,
    "",
    reviewerReferenceBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock
    ]
  });
}

export function buildRealtimeFinalDraftPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  ledger?: DiscussionLedger
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 320 });
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "");

  return buildPrompt({
    promptKind: "realtime-final-draft",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are the finalizer closing a realtime multi-model essay review session.",
    buildFinalEssayKoreanInstruction(),
    "The current section is ready, no blocking reviewer feedback remains, and there are no Deferred Challenges left.",
    "Write the final polished essay draft now.",
    "Use the Section Draft when available as the local seed, preserve the Accepted Decisions, and keep the final essay aligned with the resolved focus.",
    "Return only the rewritten essay in Markdown.",
    "Do not include section headings, status tags, summaries, or extra commentary.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock
    ]
  });
}

export function buildDevilsAdvocatePrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  ledger?: DiscussionLedger
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const bindingDirectiveBlock = buildBindingDirectiveBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 320 });
  const previousRoundBlock = buildPreviousRoundReviewerSummary(turns, round);
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "", true);
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);

  return buildPrompt({
    promptKind: "realtime-coordinator-challenge",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [bindingDirectiveBlock, previousRoundBlock, challengeTicketsBlock, historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are the coordinator for a realtime multi-model essay review.",
    buildRealtimeKoreanResponseInstruction(),
    `Round: ${round}`,
    "All reviewers agreed too quickly. This often means groupthink.",
    "Return Markdown with exactly these top-level sections:",
    "## Current Focus",
    "## Target Section",
    "## Target Section Key",
    "## Current Objective",
    "## Rewrite Direction",
    "## Must Keep",
    "## Must Resolve",
    "## Available Evidence",
    "## Exit Criteria",
    "## Next Owner",
    "## Mini Draft",
    "## Accepted Decisions",
    "## Open Challenges",
    "## Deferred Challenges",
    "## Section Outcome",
    "## Challenge Decisions",
    "Use this turn to challenge one assumption the reviewers accepted too quickly and add at least one concrete Open Challenge.",
    "Write Target Section Key as a stable slug for the current target section.",
    "Must Keep, Must Resolve, Available Evidence, and Exit Criteria must use bullet items. If empty, write exactly '- 없음'.",
    "Next Owner should usually be section_drafter unless more research is clearly required.",
    "Mini Draft must be bullet points or short sentence starters only — never full paragraph prose. The drafter converts it into actual text.",
    "Deferred Challenges should capture later follow-up issues instead of blocking the current section.",
    "Write Section Outcome as exactly one of: keep-open, close-section, handoff-next-section, write-final.",
    "Use Challenge Decisions to mark ticket transitions with lines like '- [ticketId] close' or '- [new] add | sectionKey=... | sectionLabel=... | severity=advisory | text=...'.",
    "If the current section is already closed, redirect the next Target Section to one Deferred Challenge instead of reopening the same section.",
    "Current Focus, Rewrite Direction, Must Keep, and Must Resolve must be derived fresh from the current reviewer feedback and available evidence. Do not copy or lightly rephrase these fields from the previous ledger — the previous values are intentionally omitted to force a new reading.",
    "Do not write the full essay.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    challengeTicketsBlock,
    "",
    bindingDirectiveBlock,
    bindingDirectiveBlock ? "" : "",
    previousRoundBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock
    ]
  });
}

export function buildWeakConsensusPolishPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  ledger?: DiscussionLedger
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const bindingDirectiveBlock = buildBindingDirectiveBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 320 });
  const previousRoundBlock = buildPreviousRoundReviewerSummary(turns, round);
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "", true);
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);

  return buildPrompt({
    promptKind: "realtime-coordinator-polish",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [bindingDirectiveBlock, previousRoundBlock, challengeTicketsBlock, historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
    "You are the coordinator for a realtime multi-model essay review discussion.",
    buildRealtimeKoreanResponseInstruction(),
    `Round: ${round}`,
    "The current section is technically ready, but most reviewers still recommend advisory revisions.",
    "Use one polish round to absorb advisory feedback without opening a new section yet.",
    "Return Markdown with exactly these top-level sections:",
    "## Current Focus",
    "## Target Section",
    "## Target Section Key",
    "## Current Objective",
    "## Rewrite Direction",
    "## Must Keep",
    "## Must Resolve",
    "## Available Evidence",
    "## Exit Criteria",
    "## Next Owner",
    "## Mini Draft",
    "## Accepted Decisions",
    "## Open Challenges",
    "## Deferred Challenges",
    "## Section Outcome",
    "## Challenge Decisions",
    "Write Target Section Key as a stable slug for the current target section.",
    "Must Keep, Must Resolve, Available Evidence, and Exit Criteria must use bullet items. If empty, write exactly '- 없음'.",
    "Next Owner should usually be section_drafter unless more research is clearly required.",
    "Mini Draft must be bullet points or short sentence starters only — never full paragraph prose. The drafter converts it into actual text.",
    "Write Section Outcome as exactly one of: keep-open, close-section, handoff-next-section, write-final.",
    "Do not invent new blocker scope unless the reviewer feedback clearly justifies it.",
    "Use Challenge Decisions to close, keep-open, defer, promote, or add tickets as needed.",
    "Current Focus, Rewrite Direction, Must Keep, and Must Resolve must be derived fresh from the current reviewer feedback and available evidence. Do not copy or lightly rephrase these fields from the previous ledger — the previous values are intentionally omitted to force a new reading.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    ledgerBlock,
    "",
    challengeTicketsBlock,
    "",
    bindingDirectiveBlock,
    bindingDirectiveBlock ? "" : "",
    previousRoundBlock,
    "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    historyBlock
    ]
  });
}

export function buildInterventionCoordinatorPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  messages: string[],
  snapshot: InterventionPartialSnapshot,
  ledger?: DiscussionLedger
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const bindingDirectiveBlock = buildBindingDirectiveBlock(
    userInterventions.length > 0
      ? userInterventions
      : messages.map((message) => ({ round: snapshot.round, text: message })),
    "round"
  );
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 4, maxCharsPerTurn: 260 });
  const ledgerBlock = buildDiscussionLedgerBlock(ledger, "");
  const challengeTicketsBlock = buildChallengeTicketBlock(ledger);
  const partialSnapshotBlock = buildInterventionPartialSnapshotBlock(snapshot);
  const userMessageBlock = [
    "## New Binding User Directives",
    ...messages.map((message, index) => `### Directive ${index + 1}\n${message}`)
  ].join("\n\n");

  return buildPrompt({
    promptKind: "realtime-coordinator-intervention",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [bindingDirectiveBlock, partialSnapshotBlock, challengeTicketsBlock, historyBlock, userMessageBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
      "You are the intervention coordinator for a realtime multi-model essay review discussion.",
      buildRealtimeKoreanResponseInstruction(),
      `Round: ${round}`,
      "The active turn was interrupted because the user issued a new binding directive.",
      "These directives are not hints. They are binding unless they create a factual impossibility.",
      "Return Markdown with exactly these top-level sections:",
      "## Decision",
      "## Reason",
      "## Current Focus",
      "## Target Section",
      "## Target Section Key",
      "## Current Objective",
      "## Rewrite Direction",
      "## Must Keep",
      "## Must Resolve",
      "## Available Evidence",
      "## Exit Criteria",
      "## Next Owner",
      "## Mini Draft",
      "## Accepted Decisions",
      "## Open Challenges",
      "## Deferred Challenges",
      "## Section Outcome",
      "## Challenge Decisions",
      "## Clarifying Question",
      "Decision must be exactly one of: accept, redirect, clarify.",
      "Use accept when the user is explicitly closing the current section or the best action is to force-close it and move on.",
      "Use redirect when the user gave enough direction to restart the next round with a new brief.",
      "Use clarify when the user's directive is ambiguous enough that the next round would likely fail without a follow-up question.",
      "If you choose clarify, fill Clarifying Question with exactly one concrete question and write '- 없음' for the unused list sections whenever needed.",
      "If you choose redirect, place the newest binding directive first under Must Resolve using the exact prefix '[USER DIRECTIVE - 최우선 지시]'.",
      "If you choose accept, still explain why in Reason and update Challenge Decisions accordingly.",
      "Must Keep, Must Resolve, Available Evidence, Exit Criteria, Accepted Decisions, Open Challenges, and Deferred Challenges must use bullet items. If empty, write exactly '- 없음'.",
      "Section Outcome must be exactly one of: keep-open, close-section, handoff-next-section, write-final.",
      "Use Challenge Decisions to close, defer, promote, or add tickets with the existing grammar.",
      "",
      contextMarkdown,
      "",
      notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
      notionBrief ? "" : "",
      bindingDirectiveBlock,
      "",
      partialSnapshotBlock,
      "",
      ledgerBlock,
      "",
      challengeTicketsBlock,
      "",
      guidanceBlock,
      guidanceBlock ? "" : "",
      historyBlock,
      "",
      userMessageBlock
    ]
  });
}

export function buildNotionPrePassPrompt(
  contextMarkdown: string,
  notionRequest: NotionRequestDescriptor | undefined
): BuiltPrompt {
  const requestHeading = notionRequest?.kind === "auto" ? "## Auto Context Request" : "## User Notion Request";
  return buildPrompt({
    promptKind: "notion-prepass",
    contextProfile: "minimal",
    contextMarkdown,
    sections: [
    "You are the context researcher for a multi-model essay feedback discussion.",
    buildNotionPrePassKoreanInstruction(),
    "Before the main review starts, use your configured Notion MCP tools to resolve the user's Notion request.",
    "Search for the most relevant Notion page or database entries, then summarize only the context that will improve the essay review.",
    "Prompt budget rules:",
    "- Use the explicit user request and the minimal draft excerpt below as your main anchor.",
    "- Search top 3 candidates or fewer.",
    "- Fetch at most 2 pages unless the request is still ambiguous after that.",
    "If the best match is clearly stronger than the next candidate, resolve it directly.",
    "If the result is ambiguous, do not hallucinate certainty. Briefly mention the top candidates and produce a conservative summary.",
    "If you cannot access Notion MCP or cannot resolve the request, say so clearly in the Resolution section.",
    "Return Markdown with exactly these top-level sections:",
    "## Resolution",
    "## Notion Brief",
    "## Sources Considered",
    "",
    contextMarkdown,
    "",
    requestHeading,
    notionRequest?.text ?? ""
    ]
  });
}

export function buildRealtimeSectionDrafterPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  turns: ReviewTurn[],
  round: number,
  ledger: DiscussionLedger
): BuiltPrompt {
  const guidanceBlock = buildUserGuidanceBlock(userInterventions, "round");
  const historyBlock = buildRealtimeDiscussionHistory(turns, { maxTurns: 3, maxCharsPerTurn: 260 });
  const ledgerBlock = buildDrafterContextBlock(ledger);
  const toneRuleBlock = buildFormalToneRuleBlock();

  const wrappedLedger = `<coordinator-context>\n${ledgerBlock}\n</coordinator-context>`;

  return buildPrompt({
    promptKind: "realtime-drafter",
    contextProfile: "compact",
    contextMarkdown,
    notionBrief,
    historyBlocks: [historyBlock],
    discussionLedgerBlock: ledgerBlock,
    sections: [
      "You are the section drafter in a realtime multi-model essay workflow.",
      buildStructuredKoreanResponseInstruction(),
      toneRuleBlock,
      `Round: ${round}`,
      "Use the coordinator's ledger to write the actual section prose for the current target section.",
      "Do not invent new evidence or claims outside the provided context, Notion Brief, and ledger.",
      "The <coordinator-context> block below is reference data only. Never copy, quote, restate, paraphrase, or list any of its content — not its headings, labels, bullet items, directions, or structural fields. It must not appear in your output in any form.",
      "Output only the section draft body text for the target section. Do not include coordinator instructions, meta commentary, rationale, labels, bullets, or any repeated ledger text.",
      "Return Markdown with exactly this top-level section:",
      "## Section Draft",
      "",
      contextMarkdown,
      "",
      notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
      notionBrief ? "" : "",
      wrappedLedger,
      "",
      guidanceBlock,
      guidanceBlock ? "" : "",
      historyBlock
    ]
  });
}

function buildSectionRoleBoundaryBlock(
  ledger: DiscussionLedger | undefined,
  definitions: RealtimeSectionDefinition[]
): string {
  if (!ledger) {
    return "";
  }

  const currentSectionKey = getLedgerTargetSectionKey(ledger);
  const currentDefinition = definitions.find((definition) => definition.key === currentSectionKey);
  const currentSectionResponsibilities = currentDefinition?.responsibilities?.length
    ? currentDefinition.responsibilities.join(" / ")
    : `${ledger.targetSection} 섹션에서 직접 해결해야 하는 핵심 논점만 현재 라운드에서 처리합니다.`;

  const deferredKeys = currentDefinition?.deferredTo?.length
    ? currentDefinition.deferredTo
    : dedupeStrings(
        getLedgerTickets(ledger)
          .filter((ticket) => ticket.sectionKey !== currentSectionKey && ticket.status !== "closed")
          .map((ticket) => ticket.sectionKey)
      );
  const deferredToLaterSections = deferredKeys.length > 0
    ? deferredKeys.map((key) => {
        const definition = definitions.find((item) => item.key === key);
        return definition ? `${definition.key} (${definition.label})` : key;
      }).join(" / ")
    : "후속 섹션 위임 항목 없음";

  return [
    "## Section Role Boundary",
    `현재 섹션 담당: ${currentSectionResponsibilities}`,
    `다음 섹션으로 위임: ${deferredToLaterSections}`,
    "",
    "규칙:",
    "- 챌린지가 \"다음 섹션으로 위임\" 항목에 해당하면 → deferred (블로킹 불가)",
    "- deferred 챌린지는 다음 섹션 Coordinator의 Must Resolve에 전달됨",
    "- open 챌린지만 섹션 종료를 블로킹할 수 있음"
  ].join("\n");
}

function buildReviewerVerdictPromptBlock(summary?: RealtimeReviewerVerdictSummary): string {
  if (!summary) {
    return "";
  }

  return [
    "## Reviewer Verdict",
    `APPROVE: ${summary.approveCount} / REVISE: ${summary.reviseCount} / BLOCK: ${summary.blockCount}`,
    ...(summary.minorityRevise
      ? [
          `Minority REVISE (${summary.minorityRevise.reviewer}): "${summary.minorityRevise.summary}"`,
          "→ 이 챌린지가 현재 섹션 역할 범위 안인가? 밖이면 deferred로 마킹하고 섹션을 닫아라."
        ]
      : [])
  ].join("\n");
}

function buildConvergenceNoticeBlock(rounds: number | undefined): string {
  if (!rounds || rounds < 3) {
    return "";
  }

  return [
    "## Convergence Notice",
    `이 섹션은 ${rounds}라운드 REVISE 중입니다.`,
    "",
    "판단 기준:",
    "1. 남은 챌린지가 섹션 범위 밖 → 즉시 deferred 처리 후 종료",
    "2. 남은 챌린지가 해결 가능한 수준 → 이번 라운드에서 반드시 종료",
    "3. 해결 불가능한 실질적 문제 → 사용자에게 에스컬레이션 (awaiting-user-input)",
    "",
    "에스컬레이션이 필요하면 Current Focus를 반드시 '[AWAITING USER INPUT]'로 시작하고, Must Resolve 첫 bullet에 사용자에게 물을 질문을 한 문장으로 적어라."
  ].join("\n");
}

function buildInterventionPartialSnapshotBlock(snapshot: InterventionPartialSnapshot): string {
  return [
    "## Partial Snapshot Before Intervention",
    `- Interrupted Round: ${snapshot.round}`,
    `- Completed Turns Captured: ${snapshot.completedTurns.length}`,
    `- Completed Chat Messages Captured: ${snapshot.completedChatMessages.length}`,
    "",
    "### Binding Directives",
    ...formatDiscussionLedgerItems(snapshot.directiveMessages),
    "",
    "### Current Draft",
    snapshot.currentDraft,
    "",
    snapshot.currentSection
      ? [
          "### Current Section State",
          `- Target Section: ${snapshot.currentSection.targetSection}`,
          `- Target Section Key: ${snapshot.currentSection.targetSectionKey}`,
          snapshot.currentSection.sectionOutcome ? `- Section Outcome: ${snapshot.currentSection.sectionOutcome}` : "",
          "",
          "#### Current Focus",
          snapshot.currentSection.currentFocus,
          "",
          ...(snapshot.currentSection.currentObjective ? ["#### Current Objective", snapshot.currentSection.currentObjective, ""] : []),
          ...(snapshot.currentSection.rewriteDirection ? ["#### Rewrite Direction", snapshot.currentSection.rewriteDirection, ""] : []),
          "#### Must Resolve",
          ...formatDiscussionLedgerItems(snapshot.currentSection.mustResolve),
          "",
          "#### Open Challenges",
          ...formatDiscussionLedgerItems(snapshot.currentSection.openChallenges),
          "",
          "#### Deferred Challenges",
          ...formatDiscussionLedgerItems(snapshot.currentSection.deferredChallenges)
        ].filter(Boolean).join("\n")
      : "### Current Section State\n_No section state available._"
  ].join("\n");
}

function buildRealtimeDiscussionHistory(
  turns: ReviewTurn[],
  options: { maxTurns?: number; maxCharsPerTurn?: number } = {}
): string {
  const maxTurns = Math.max(1, options.maxTurns ?? 3);
  const maxCharsPerTurn = Math.max(80, options.maxCharsPerTurn ?? 320);
  const relevant = turns
    .filter((turn) => turn.status === "completed" && turn.round > 0 && turn.role !== "coordinator")
    .slice(-maxTurns);
  if (relevant.length === 0) {
    return "## Recent Discussion\n\n_No prior realtime discussion yet._";
  }

  return [
    "## Recent Discussion",
    ...relevant.map((turn) => `### ${turnLabel(turn)} round ${turn.round}\n${truncateContinuationText(turn.response, maxCharsPerTurn)}`)
  ].join("\n\n");
}

function buildPreviousRoundReviewerSummary(turns: ReviewTurn[], round: number): string {
  const previousRoundTurns = turns.filter(
    (turn) => turn.status === "completed" && turn.role === "reviewer" && turn.round === round - 1
  );
  if (previousRoundTurns.length === 0) {
    return "## Previous Round Reviewer Summary\n\n_No previous-round reviewer objections yet._";
  }

  return [
    "## Previous Round Reviewer Summary",
    ...previousRoundTurns.map((turn) => {
      const status = extractRealtimeReviewerStatus(turn.response);
      const objection = extractRealtimeReviewerObjection(turn.response);
      return `- ${turnLabel(turn)}: ${truncateContinuationText(objection, 180)} (Status: ${status})`;
    })
  ].join("\n");
}

function buildCoordinatorReferenceBlock(
  turns: ReviewTurn[],
  round: number
): string {
  const previousCoordinatorTurn = [...turns]
    .reverse()
    .find((turn) => turn.status === "completed" && turn.participantId === "coordinator" && turn.round > 0 && turn.round < round);
  const previousLedger = previousCoordinatorTurn
    ? extractDiscussionLedger(previousCoordinatorTurn.response, previousCoordinatorTurn.round)
    : undefined;
  if (!previousLedger) {
    return "## Coordinator Reference\n\n_No coordinator reference yet._";
  }

  const coordinatorReference: RealtimeReferencePacket = {
    refId: `coord-r${previousLedger.updatedAtRound}`,
    sourceLabel: `Coordinator round ${previousLedger.updatedAtRound}`,
    summary: buildCoordinatorReferenceSummary(previousLedger)
  };
  return buildRealtimeReferenceBlock("## Coordinator Reference", [coordinatorReference], "_No coordinator reference yet._");
}

function buildCoordinatorReferenceSummary(ledger: DiscussionLedger): string {
  const summaryParts = [
    `Target Section: ${ledger.targetSection}`,
    `Current Focus: ${ledger.currentFocus}`
  ];
  if (ledger.openChallenges.length > 0) {
    summaryParts.push(`Open Challenges: ${ledger.openChallenges.join("; ")}`);
  }
  if (ledger.deferredChallenges.length > 0) {
    summaryParts.push(`Deferred Challenges: ${ledger.deferredChallenges.join("; ")}`);
  }
  return summaryParts.join(" | ");
}

function buildReviewerReferencesBlock(
  turns: ReviewTurn[],
  round: number,
  currentParticipantId: string
): string {
  const previousRoundTurns = turns.filter(
    (turn) =>
      turn.status === "completed" &&
      turn.role === "reviewer" &&
      turn.round === round - 1 &&
      turn.participantId !== currentParticipantId
  );
  const references = previousRoundTurns.map((turn) => ({
    refId: `rev-r${turn.round}-${turn.participantId ?? "reviewer"}`,
    sourceLabel: `${turnLabel(turn)} round ${turn.round}`,
    summary: extractRealtimeReviewerObjection(turn.response)
  }));
  return buildRealtimeReferenceBlock(
    "## Reviewer References",
    references,
    "_No previous-round reviewer references available._"
  );
}

function buildRealtimeReferenceBlock(heading: string, references: RealtimeReferencePacket[], emptyState: string): string {
  if (references.length === 0) {
    return `${heading}\n\n${emptyState}`;
  }

  return [
    heading,
    ...references.map((reference) => `- [${reference.refId}] ${reference.sourceLabel}: ${truncateContinuationText(reference.summary, 180)}`)
  ].join("\n");
}
