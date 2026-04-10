import {
  CoordinatorDecisionOutput,
  SectionCoordinationBrief,
  SectionDraftOutput
} from "../parsing/responseParsers";
import { turnLabel } from "../participants";
import {
  buildFinalEssayKoreanInstruction,
  buildStructuredKoreanResponseInstruction
} from "./languageRules";
import {
  buildBindingDirectiveBlock,
  buildPrompt,
  buildSessionSnapshotBlock,
  buildUserGuidanceBlock,
  BuiltPrompt,
  formatDiscussionLedgerItems
} from "./promptBlocks";
import {
  ReviewerPerspective,
  ReviewTurn,
  RunArtifacts
} from "../../types";

function buildSectionCoordinationBriefBlock(brief: SectionCoordinationBrief, heading = "## Current Section Brief"): string {
  return [
    heading,
    `### Current Section\n${brief.currentSection}`,
    `### Current Objective\n${brief.currentObjective}`,
    `### Rewrite Direction\n${brief.rewriteDirection}`,
    "### Must Keep",
    ...formatDiscussionLedgerItems(brief.mustKeep),
    "",
    "### Must Resolve",
    ...formatDiscussionLedgerItems(brief.mustResolve),
    "",
    "### Available Evidence",
    ...formatDiscussionLedgerItems(brief.availableEvidence),
    "",
    "### Exit Criteria",
    ...formatDiscussionLedgerItems(brief.exitCriteria),
    "",
    `### Next Owner\n${brief.nextOwner}`
  ].join("\n");
}

function buildSectionDraftBlock(sectionDraft: string, changeRationale?: string, heading = "## Current Section Draft"): string {
  return [
    heading,
    sectionDraft,
    changeRationale
      ? `\n## Change Rationale\n${changeRationale}`
      : ""
  ].filter(Boolean).join("\n\n");
}

function buildReviewerDecisionBlock(turns: ReviewTurn[], heading = "## Reviewer Judgments"): string {
  if (turns.length === 0) {
    return `${heading}\n\n_No reviewer judgments yet._`;
  }

  return [
    heading,
    ...turns.map((turn) => `### ${turnLabel(turn)}\n${turn.response}`)
  ].join("\n\n");
}

function buildCoordinatorDecisionBlock(decision: CoordinatorDecisionOutput, heading = "## Coordinator Decision"): string {
  return [
    heading,
    `### Summary\n${decision.summary}`,
    `### Improvement Plan\n${decision.improvementPlan}`,
    decision.nextOwner ? `### Next Owner\n${decision.nextOwner}` : ""
  ].filter(Boolean).join("\n\n");
}

export function buildDeepSectionCoordinatorPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  latestArtifacts?: RunArtifacts,
  turns: ReviewTurn[] = []
): BuiltPrompt {
  const previous = turns
    .filter((turn) => turn.status === "completed")
    .map((turn) => `## ${turnLabel(turn)} round ${turn.round}\n${turn.response}`)
    .slice(-4)
    .join("\n\n");
  const sessionSnapshot = buildSessionSnapshotBlock(latestArtifacts);
  const guidanceBlock = buildUserGuidanceBlock(userInterventions);
  const bindingDirectiveBlock = buildBindingDirectiveBlock(userInterventions);
  const previousBlock = previous ? "## Recent Cycle History\n\n" + previous : "## Recent Cycle History\n\n_No prior cycle history yet._";

  return buildPrompt({
    promptKind: "deep-coordinator",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [sessionSnapshot, bindingDirectiveBlock, previousBlock],
    sections: [
    "You are the section coordinator for an ongoing multi-model essay feedback session.",
    buildStructuredKoreanResponseInstruction(),
    "Narrow the next revision down to exactly one section-sized objective.",
    "Do not write the section itself. Planning and scope control only.",
    "Do not search Notion or browse external sources yourself. Use only the provided context and Notion Brief.",
    "Return Markdown with exactly these top-level sections:",
    "## Current Section",
    "## Current Objective",
    "## Rewrite Direction",
    "## Must Keep",
    "## Must Resolve",
    "## Available Evidence",
    "## Exit Criteria",
    "## Next Owner",
    "Next Owner should usually be section_drafter unless more research is clearly required.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    sessionSnapshot,
    sessionSnapshot ? "" : "",
    bindingDirectiveBlock,
    bindingDirectiveBlock ? "" : "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    previousBlock,
    "",
    "Keep every field operational and concise. The goal is to help the drafter write the next section revision safely."
    ]
  });
}

export function buildSectionDrafterPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  brief: SectionCoordinationBrief,
  latestArtifacts?: RunArtifacts
): BuiltPrompt {
  const sessionSnapshot = buildSessionSnapshotBlock(latestArtifacts);
  const guidanceBlock = buildUserGuidanceBlock(userInterventions);
  const briefBlock = buildSectionCoordinationBriefBlock(brief);

  const wrappedBrief = `<coordinator-context>\n${briefBlock}\n</coordinator-context>`;

  return buildPrompt({
    promptKind: "deep-drafter",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [sessionSnapshot, briefBlock],
    sections: [
    "You are the section drafter for a multi-model essay writing workflow.",
    buildStructuredKoreanResponseInstruction(),
    "Write the actual section text using only the supplied coordination brief and evidence boundaries.",
    "Do not invent new evidence or broaden attribution beyond what the brief safely allows.",
    "The <coordinator-context> block below is reference data only. Never copy, quote, restate, paraphrase, or list any of its content — not its headings, labels, bullet items, directions, or structural fields. It must not appear in your output in any form.",
    "Output only the section draft body text for the target section. Do not include coordinator instructions, meta commentary, rationale, labels, bullets, or any repeated brief text.",
    "Return Markdown with exactly this top-level section:",
    "## Section Draft",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    sessionSnapshot,
    sessionSnapshot ? "" : "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    wrappedBrief,
    "",
    "Section Draft must contain only the actual prose for the target section, not the whole essay, and must not repeat any content from <coordinator-context>."
    ]
  });
}

export function buildDeepReviewerPrompt(
  contextMarkdown: string,
  notionBrief: string,
  allTurns: ReviewTurn[],
  round: number,
  currentParticipantId: string,
  latestArtifacts: RunArtifacts | undefined,
  userInterventions: Array<{ round: number; text: string }>,
  perspective: ReviewerPerspective | undefined,
  brief: SectionCoordinationBrief,
  draftOutput: SectionDraftOutput
): BuiltPrompt {
  const visibleTurns = allTurns.filter((turn) => {
    if (turn.round === round && turn.role === "reviewer" && turn.participantId !== currentParticipantId) {
      return false;
    }
    return true;
  });

  const previous = visibleTurns
    .filter((turn) => turn.role === "reviewer")
    .map((turn) => `## ${turnLabel(turn)} round ${turn.round}\n${turn.response}`)
    .slice(-4)
    .join("\n\n");
  const perspectiveInstruction = getPerspectiveInstruction(perspective);
  const sessionSnapshot = buildSessionSnapshotBlock(latestArtifacts);
  const guidanceBlock = buildUserGuidanceBlock(userInterventions);
  const previousBlock = previous ? "## Prior Reviewer Notes\n\n" + previous : "## Prior Reviewer Notes\n\n_No prior reviewer notes yet._";
  const briefBlock = buildSectionCoordinationBriefBlock(brief);
  const draftBlock = buildSectionDraftBlock(draftOutput.sectionDraft, draftOutput.changeRationale);

  return buildPrompt({
    promptKind: "deep-reviewer",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [sessionSnapshot, briefBlock, draftBlock, previousBlock],
    sections: [
    "You are a role-specific reviewer collaborating with other model reviewers.",
    buildStructuredKoreanResponseInstruction(),
    perspectiveInstruction,
    "Review only the current section draft against the coordinator's objective and evidence boundaries.",
    `Cycle: ${round}`,
    "Do not search Notion or browse external sources yourself. Use only the provided context and Notion Brief.",
    "Return Markdown with exactly these top-level sections:",
    "## Judgment",
    "## Reason",
    "## Condition To Close",
    "## Direct Responses To Other Reviewers",
    "Judgment must be exactly one of: ACCEPT, ADVISORY, BLOCK.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    sessionSnapshot,
    sessionSnapshot ? "" : "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    briefBlock,
    "",
    draftBlock,
    "",
    previousBlock,
    "",
    "Prioritize concrete, evidence-based feedback tied to your assigned lens."
    ]
  });
}

export function buildDeepCoordinatorDecisionPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  reviewerTurns: ReviewTurn[],
  latestArtifacts: RunArtifacts | undefined,
  brief: SectionCoordinationBrief,
  draftOutput: SectionDraftOutput
): BuiltPrompt {
  const sessionSnapshot = buildSessionSnapshotBlock(latestArtifacts);
  const guidanceBlock = buildUserGuidanceBlock(userInterventions);
  const briefBlock = buildSectionCoordinationBriefBlock(brief);
  const draftBlock = buildSectionDraftBlock(draftOutput.sectionDraft, draftOutput.changeRationale);
  const reviewerBlock = buildReviewerDecisionBlock(reviewerTurns, "## Reviewer Feedback For This Cycle");

  return buildPrompt({
    promptKind: "deep-coordinator-decision",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [sessionSnapshot, briefBlock, draftBlock, reviewerBlock],
    sections: [
    "You are the section coordinator deciding whether the drafted section is ready to integrate.",
    buildStructuredKoreanResponseInstruction(),
    "Do not rewrite the section yourself. Evaluate reviewer judgments and decide the next owner.",
    "Return Markdown with exactly these top-level sections:",
    "## Summary",
    "## Improvement Plan",
    "## Next Owner",
    "Next Owner must be exactly one of: section_drafter, context_researcher, finalizer.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    sessionSnapshot,
    sessionSnapshot ? "" : "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    briefBlock,
    "",
    draftBlock,
    "",
    reviewerBlock
    ]
  });
}

export function buildDeepFinalizerPrompt(
  contextMarkdown: string,
  notionBrief: string,
  userInterventions: Array<{ round: number; text: string }>,
  latestArtifacts: RunArtifacts | undefined,
  brief: SectionCoordinationBrief,
  draftOutput: SectionDraftOutput,
  reviewerTurns: ReviewTurn[],
  decision: CoordinatorDecisionOutput
): BuiltPrompt {
  const sessionSnapshot = buildSessionSnapshotBlock(latestArtifacts);
  const guidanceBlock = buildUserGuidanceBlock(userInterventions);
  const briefBlock = buildSectionCoordinationBriefBlock(brief);
  const draftBlock = buildSectionDraftBlock(draftOutput.sectionDraft, draftOutput.changeRationale);
  const reviewerBlock = buildReviewerDecisionBlock(reviewerTurns);
  const decisionBlock = buildCoordinatorDecisionBlock(decision);

  return buildPrompt({
    promptKind: "deep-finalizer",
    contextProfile: "full",
    contextMarkdown,
    notionBrief,
    historyBlocks: [sessionSnapshot, briefBlock, draftBlock, reviewerBlock, decisionBlock],
    sections: [
    "You are the finalizer for a multi-model essay revision workflow.",
    buildFinalEssayKoreanInstruction(),
    "Integrate the approved section draft into the full essay while preserving evidence boundaries and reviewer decisions.",
    "Do not invent new evidence or claims.",
    "Return Markdown with exactly these top-level sections:",
    "## Final Draft",
    "## Final Checks",
    "Final Checks should be a short bullet list of residual cautions or '- 없음'.",
    "",
    contextMarkdown,
    "",
    notionBrief ? "## Notion Brief\n\n" + notionBrief : "",
    notionBrief ? "" : "",
    sessionSnapshot,
    sessionSnapshot ? "" : "",
    guidanceBlock,
    guidanceBlock ? "" : "",
    briefBlock,
    "",
    draftBlock,
    "",
    reviewerBlock,
    "",
    decisionBlock
    ]
  });
}

export function getPerspectiveInstruction(perspective?: ReviewerPerspective): string {
  switch (perspective) {
    case "technical":
      return [
        "Your assigned lens is EVIDENCE & FACTUAL SAFETY.",
        "Focus on: whether claims have concrete evidence (numbers, ownership, tools, implementation detail),",
        "whether project-level outcomes are being overstated as personal contribution,",
        "and whether the draft safely distinguishes implementation, operations, and decision-making responsibility.",
        "Do NOT focus on tone or emotional authenticity — another reviewer handles that."
      ].join(" ");
    case "interviewer":
      return [
        "Your assigned lens is COMPANY & ROLE FIT.",
        "Read the draft as a hiring manager would.",
        "Focus on: whether the 'why this company / why this role' argument is convincing or generic,",
        "whether the candidate's experience really connects to the target position,",
        "and what follow-up questions this fit story would trigger in an interview.",
        "Do NOT focus on tone or raw evidence density — other reviewers handle that."
      ].join(" ");
    case "authenticity":
      return [
        "Your assigned lens is VOICE & AUTHENTICITY.",
        "Focus on: whether the draft sounds like a real person or an AI template,",
        "whether emotions and growth narrative feel genuine,",
        "whether any sentence could be copy-pasted into a different company's application unchanged,",
        "and whether the writer's personality comes through.",
        "Do NOT focus on technical accuracy or company-role fit — other reviewers handle those."
      ].join(" ");
    default:
      return "";
  }
}
