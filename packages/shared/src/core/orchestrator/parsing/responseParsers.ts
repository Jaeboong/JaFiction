import {
  ChallengeSeverity,
  DiscussionLedger,
  EssayRoleId,
  essayRoleIds,
  RunArtifacts,
  SectionOutcome
} from "../../types";
import {
  applyCoordinatorChallengeDecisions,
  deriveLedgerViewsFromTickets,
  InterventionCoordinatorDecision,
  normalizeSectionKey,
  ParsedChallengeAddDecision,
  ParsedChallengeDecision,
  seedTicketsFromLegacyLedger
} from "../discussion/discussionLedger";
import {
  collectRealtimeReviewerSections,
  parseReviewerChallengeHeader,
  type ParsedRealtimeReviewerSection
} from "../../reviewerCard";

export interface SectionCoordinationBrief {
  currentSection: string;
  currentObjective: string;
  rewriteDirection: string;
  mustKeep: string[];
  mustResolve: string[];
  availableEvidence: string[];
  exitCriteria: string[];
  nextOwner: EssayRoleId;
}

export interface SectionDraftOutput {
  sectionDraft: string;
  changeRationale: string;
}

export interface CoordinatorDecisionOutput {
  summary: string;
  improvementPlan: string;
  nextOwner?: EssayRoleId;
}

export interface FinalizerOutput {
  finalDraft: string;
  finalChecks?: string;
}

export interface ParsedReviewerChallengeVerdict {
  ticketId: string;
  action: "close" | "keep-open" | "defer";
  reason: string;
}

export type RealtimeReviewerStatus = "PASS" | "REVISE" | "BLOCK";

export interface RealtimeReviewerFeedbackPacket {
  participantId?: string;
  participantLabel: string;
  status: RealtimeReviewerStatus;
  miniDraft?: string;
  challengeAction?: ParsedReviewerChallengeVerdict["action"];
  challengeSummary?: string;
  crossFeedbackSummary?: string;
  objectionSummary: string;
}

export function normalizeEssayRoleId(raw: string, fallback: EssayRoleId): EssayRoleId {
  const normalized = normalizeLedgerSingleLine(raw) as EssayRoleId;
  return essayRoleIds.includes(normalized) ? normalized : fallback;
}

export function splitSectionCoordinationBrief(output: string): SectionCoordinationBrief {
  const currentSection = normalizeLedgerSingleLine(extractMarkdownSection(output, "Current Section"))
    || normalizeLedgerSingleLine(extractMarkdownSection(output, "Target Section"))
    || "핵심 문단";
  const currentObjective = normalizeLedgerParagraph(extractMarkdownSection(output, "Current Objective"))
    || normalizeLedgerSingleLine(extractMarkdownSection(output, "Current Focus"))
    || "현재 section의 설득력을 높일 것";
  const rewriteDirection = normalizeLedgerParagraph(extractMarkdownSection(output, "Rewrite Direction"))
    || normalizeLedgerParagraph(extractMarkdownSection(output, "Mini Draft"))
    || currentObjective;

  return {
    currentSection,
    currentObjective,
    rewriteDirection,
    mustKeep: parseDiscussionLedgerItems(extractMarkdownSection(output, "Must Keep")),
    mustResolve: parseDiscussionLedgerItems(extractMarkdownSection(output, "Must Resolve")),
    availableEvidence: parseDiscussionLedgerItems(extractMarkdownSection(output, "Available Evidence")),
    exitCriteria: parseDiscussionLedgerItems(extractMarkdownSection(output, "Exit Criteria")),
    nextOwner: normalizeEssayRoleId(extractMarkdownSection(output, "Next Owner"), "section_drafter")
  };
}

export function splitSectionDraftOutput(output: string, fallbackDraft: string): SectionDraftOutput {
  const sectionDraft = normalizeLedgerParagraph(extractMarkdownSection(output, "Section Draft")) || fallbackDraft;
  const changeRationale = normalizeLedgerParagraph(extractMarkdownSection(output, "Change Rationale"));
  return {
    sectionDraft,
    changeRationale
  };
}

export function extractSectionDraft(output: string): SectionDraftOutput | undefined {
  const sectionDraft = normalizeLedgerParagraph(extractMarkdownSection(output, "Section Draft"));
  if (!sectionDraft) {
    return undefined;
  }

  return {
    sectionDraft,
    changeRationale: normalizeLedgerParagraph(extractMarkdownSection(output, "Change Rationale"))
  };
}

export function splitCoordinatorDecisionOutput(output: string): CoordinatorDecisionOutput {
  return {
    summary: extractMarkdownSection(output, "Summary") || output.trim(),
    improvementPlan: extractMarkdownSection(output, "Improvement Plan") || "구조화된 개선안이 반환되지 않았습니다.",
    nextOwner: normalizeLedgerSingleLine(extractMarkdownSection(output, "Next Owner"))
      ? normalizeEssayRoleId(extractMarkdownSection(output, "Next Owner"), "finalizer")
      : undefined
  };
}

export function splitFinalizerOutput(output: string, fallbackDraft: string): FinalizerOutput {
  const finalDraft = extractMarkdownSection(output, "Final Draft") || output.trim() || fallbackDraft;
  const finalChecks = extractMarkdownSection(output, "Final Checks") || undefined;
  return {
    finalDraft,
    finalChecks
  };
}

export function extractNotionBrief(response: string): string {
  const extracted = extractMarkdownSection(response, "Notion Brief");
  return extracted || response.trim();
}

export function extractMarkdownSection(markdown: string, sectionTitle: string): string {
  const lines = markdown.split(/\r?\n/);
  const normalizedTitle = sectionTitle.trim().toLowerCase();
  const collected: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      const headingTitle = heading[1].trim().toLowerCase();
      if (capturing) {
        break;
      }
      if (headingTitle === normalizedTitle) {
        capturing = true;
        continue;
      }
    }

    if (capturing) {
      collected.push(line);
    }
  }

  return collected.join("\n").trim();
}

export function splitCoordinatorSections(output: string, fallbackDraft: string): RunArtifacts {
  const sections = new Map<string, string>();
  let current = "summary";
  sections.set(current, "");

  for (const line of output.split(/\r?\n/)) {
    const normalized = line.trim().toLowerCase();
    if (normalized === "## summary" || normalized === "# summary") {
      current = "summary";
      sections.set(current, "");
      continue;
    }
    if (normalized === "## improvement plan" || normalized === "# improvement plan") {
      current = "improvementPlan";
      sections.set(current, "");
      continue;
    }
    if (normalized === "## revised draft" || normalized === "# revised draft") {
      current = "revisedDraft";
      sections.set(current, "");
      continue;
    }

    sections.set(current, `${sections.get(current) ?? ""}${line}\n`);
  }

  const summary = sections.get("summary")?.trim() || output.trim();
  const improvementPlan = sections.get("improvementPlan")?.trim() || "No structured improvement plan was returned.";
  const revisedDraft = sections.get("revisedDraft")?.trim() || fallbackDraft;

  return { summary, improvementPlan, revisedDraft };
}

export function extractDiscussionLedger(output: string, round: number): DiscussionLedger | undefined {
  const currentFocus = normalizeLedgerSingleLine(extractMarkdownSection(output, "Current Focus"));
  const targetSection = normalizeLedgerSingleLine(extractMarkdownSection(output, "Target Section"));
  const rewriteDirection = normalizeLedgerParagraph(extractMarkdownSection(output, "Rewrite Direction"));
  const currentObjective = normalizeLedgerParagraph(extractMarkdownSection(output, "Current Objective"));
  const miniDraft = normalizeLedgerParagraph(extractMarkdownSection(output, "Mini Draft")) || rewriteDirection;
  if (!currentFocus || !targetSection || !miniDraft) {
    return undefined;
  }

  const targetSectionKey =
    normalizeLedgerSingleLine(extractMarkdownSection(output, "Target Section Key")) || normalizeSectionKey(targetSection);
  const openChallenges = parseDiscussionLedgerItems(extractMarkdownSection(output, "Open Challenges"));
  const deferredChallenges = parseDiscussionLedgerItems(extractMarkdownSection(output, "Deferred Challenges"));
  const sectionOutcome = extractSectionOutcome(output);
  const baseTickets = seedTicketsFromLegacyLedger({
    targetSection,
    targetSectionKey,
    openChallenges,
    deferredChallenges,
    updatedAtRound: round
  });
  const challengeDecisions = extractChallengeDecisions(output);
  const tickets = challengeDecisions.length > 0
    ? applyCoordinatorChallengeDecisions({
        baseTickets,
        decisions: challengeDecisions,
        targetSection,
        targetSectionKey,
        round
      })
    : baseTickets;
  const derivedViews = challengeDecisions.length > 0
    ? deriveLedgerViewsFromTickets(tickets, targetSectionKey)
    : undefined;
  return {
    currentFocus,
    miniDraft,
    rewriteDirection: rewriteDirection || undefined,
    currentObjective: currentObjective || undefined,
    mustKeep: parseDiscussionLedgerItems(extractMarkdownSection(output, "Must Keep")),
    mustResolve: parseDiscussionLedgerItems(extractMarkdownSection(output, "Must Resolve")),
    availableEvidence: parseDiscussionLedgerItems(extractMarkdownSection(output, "Available Evidence")),
    exitCriteria: parseDiscussionLedgerItems(extractMarkdownSection(output, "Exit Criteria")),
    nextOwner: normalizeLedgerSingleLine(extractMarkdownSection(output, "Next Owner"))
      ? normalizeEssayRoleId(extractMarkdownSection(output, "Next Owner"), "section_drafter")
      : undefined,
    sectionDraft: normalizeLedgerParagraph(extractMarkdownSection(output, "Section Draft")) || undefined,
    changeRationale: normalizeLedgerParagraph(extractMarkdownSection(output, "Change Rationale")) || undefined,
    acceptedDecisions: parseDiscussionLedgerItems(extractMarkdownSection(output, "Accepted Decisions")),
    openChallenges: derivedViews?.openChallenges ?? openChallenges,
    deferredChallenges: derivedViews?.deferredChallenges ?? deferredChallenges,
    targetSection,
    targetSectionKey,
    tickets,
    sectionOutcome,
    updatedAtRound: round
  };
}

export function normalizeLedgerSingleLine(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function normalizeLedgerParagraph(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

export function parseDiscussionLedgerItems(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^없음$/i.test(line));
}

export function extractSectionOutcome(output: string): SectionOutcome | undefined {
  const raw = normalizeLedgerSingleLine(extractMarkdownSection(output, "Section Outcome"));
  if (raw === "keep-open" || raw === "close-section" || raw === "handoff-next-section" || raw === "write-final" || raw === "deferred-close") {
    return raw;
  }
  return undefined;
}

export function extractChallengeDecisions(output: string): Array<ParsedChallengeDecision | ParsedChallengeAddDecision> {
  const section = extractMarkdownSection(output, "Challenge Decisions");
  if (!section) {
    return [];
  }

  const decisions: Array<ParsedChallengeDecision | ParsedChallengeAddDecision> = [];
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s+/, "").trim();
    if (!line) {
      continue;
    }

    const actionMatch = line.match(/^\[(.+?)\]\s+(close|keep-open|defer|promote)\s*$/i);
    if (actionMatch) {
      decisions.push({
        ticketId: actionMatch[1],
        action: actionMatch[2].toLowerCase() as ParsedChallengeDecision["action"]
      });
      continue;
    }

    const addMatch = line.match(/^\[(new)\]\s+add\s*\|\s*(.+)$/i);
    if (!addMatch) {
      continue;
    }

    const fields = addMatch[2]
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce<Record<string, string>>((acc, part) => {
        const [key, ...rest] = part.split("=");
        if (!key || rest.length === 0) {
          return acc;
        }
        acc[key.trim()] = rest.join("=").trim();
        return acc;
      }, {});
    const severity = fields.severity === "blocking" || fields.severity === "advisory"
      ? fields.severity
      : undefined;
    decisions.push({
      ticketId: "new",
      action: "add",
      sectionKey: fields.sectionKey,
      sectionLabel: fields.sectionLabel,
      severity,
      text: fields.text
    });
  }

  return decisions;
}

export function extractRealtimeReviewerObjection(response: string): string {
  const normalizedChallenge = extractNormalizedReviewerChallenge(response);
  if (normalizedChallenge) {
    return `[${normalizedChallenge.ticketId}] ${normalizedChallenge.action} because ${normalizedChallenge.reason}`;
  }

  const challenge = extractRealtimeLabeledLine(response, "Challenge");
  if (challenge) {
    return challenge;
  }

  const crossFeedback = extractRealtimeLabeledLine(response, "Cross-feedback");
  if (crossFeedback) {
    return crossFeedback;
  }

  return extractReviewerObjection(response);
}

export function extractRealtimeLabeledLine(response: string, label: string): string {
  const section = extractRealtimeReviewerSection(response, label);
  if (!section) {
    return "";
  }

  return section.body || section.headerValue;
}

export function extractRealtimeReviewerSection(response: string, label: string): ParsedRealtimeReviewerSection | undefined {
  const matches = collectRealtimeReviewerSections(response).get(label);
  if (!matches || matches.length === 0) {
    return undefined;
  }

  return matches[matches.length - 1];
}

function isReviewerChallengeActionToken(raw: string): raw is ParsedReviewerChallengeVerdict["action"] {
  return raw === "close" || raw === "keep-open" || raw === "defer";
}

function isSectionOutcomeToken(raw: string): raw is SectionOutcome {
  return raw === "keep-open"
    || raw === "close-section"
    || raw === "handoff-next-section"
    || raw === "write-final"
    || raw === "deferred-close";
}

export function extractNormalizedReviewerChallenge(response: string): ParsedReviewerChallengeVerdict | undefined {
  const challenge = extractRealtimeReviewerSection(response, "Challenge");
  if (!challenge) {
    return undefined;
  }

  const parsed = parseReviewerChallengeHeader(challenge.headerValue);
  if (!parsed?.ticketId || !parsed.action) {
    return undefined;
  }

  const reason = challenge.body || parsed.reason;
  if (!reason) {
    return undefined;
  }

  return {
    ticketId: parsed.ticketId,
    action: parsed.action,
    reason
  };
}

export function extractRealtimeReviewerChallengeAction(
  response: string
): ParsedReviewerChallengeVerdict["action"] | undefined {
  const challenge = extractRealtimeReviewerSection(response, "Challenge");
  if (!challenge) {
    return undefined;
  }

  return parseReviewerChallengeHeader(challenge.headerValue)?.action;
}

export function extractReviewerObjection(response: string): string {
  const preferred = [
    extractMarkdownSection(response, "Problems"),
    extractMarkdownSection(response, "Suggestions"),
    response
  ];

  for (const block of preferred) {
    const line = block
      .split(/\r?\n/)
      .map((item) => item.trim())
      .map((item) => item.replace(/^[-*]\s+/, "").trim())
      .find((item) => item.length > 0 && !/^(status|mini draft|challenge|cross-feedback):/i.test(item));
    if (line) {
      return line;
    }
  }

  return "핵심 objection이 명확히 드러나지 않았습니다.";
}

export function normalizeRealtimeReviewerStatus(raw: string | undefined): RealtimeReviewerStatus | undefined {
  const normalized = normalizeLedgerSingleLine(raw ?? "").toUpperCase();
  if (normalized === "PASS" || normalized === "APPROVE") {
    return "PASS";
  }
  if (normalized === "REVISE" || normalized === "BLOCK") {
    return normalized;
  }

  return undefined;
}

export function extractRealtimeReviewerStatus(response: string): RealtimeReviewerStatus {
  const matches = [...response.matchAll(/^\s*status:\s*(pass|approve|revise|block)\s*$/gim)];
  if (matches.length === 0) {
    return "REVISE";
  }

  return normalizeRealtimeReviewerStatus(matches[matches.length - 1][1]) ?? "REVISE";
}

export function collectRealtimeReviewerStatuses(
  turns: Array<{ participantId?: string; response: string }>,
  activeReviewers: Array<{ participantId: string }>
): Map<string, RealtimeReviewerStatus> {
  const activeReviewerIds = new Set(activeReviewers.map((reviewer) => reviewer.participantId));
  const statuses = new Map<string, RealtimeReviewerStatus>();
  for (const turn of turns) {
    if (!turn.participantId || !activeReviewerIds.has(turn.participantId)) {
      continue;
    }

    statuses.set(turn.participantId, extractRealtimeReviewerStatus(turn.response));
  }

  return statuses;
}

export function extractRealtimeReviewerMiniDraft(response: string): string | undefined {
  const section = extractRealtimeReviewerSection(response, "Mini Draft");
  if (!section) {
    return undefined;
  }

  return normalizeLedgerParagraph(section.body || section.headerValue) || undefined;
}

export function extractRealtimeReviewerCrossFeedbackSummary(response: string): string | undefined {
  const section = extractRealtimeReviewerSection(response, "Cross-feedback");
  if (!section) {
    return undefined;
  }

  const combined = [section.headerValue, section.body].filter(Boolean).join("\n");
  return normalizeLedgerParagraph(combined) || undefined;
}

export function extractRealtimeReviewerChallengeSummary(response: string): string | undefined {
  const normalizedChallenge = extractNormalizedReviewerChallenge(response);
  if (normalizedChallenge) {
    return normalizedChallenge.reason;
  }

  const section = extractRealtimeReviewerSection(response, "Challenge");
  if (!section) {
    return undefined;
  }

  return normalizeLedgerParagraph(section.body || section.headerValue) || undefined;
}

export function buildRealtimeReviewerFeedbackPacket(
  turn: { participantId?: string; participantLabel?: string; response: string }
): RealtimeReviewerFeedbackPacket {
  return {
    participantId: turn.participantId,
    participantLabel: turn.participantLabel || turn.participantId || "reviewer",
    status: extractRealtimeReviewerStatus(turn.response),
    miniDraft: extractRealtimeReviewerMiniDraft(turn.response),
    challengeAction: extractRealtimeReviewerChallengeAction(turn.response),
    challengeSummary: extractRealtimeReviewerChallengeSummary(turn.response),
    crossFeedbackSummary: extractRealtimeReviewerCrossFeedbackSummary(turn.response),
    objectionSummary: extractRealtimeReviewerObjection(turn.response)
  };
}

export function collectRealtimeReviewerFeedbackPackets(
  turns: Array<{ participantId?: string; participantLabel?: string; response: string }>,
  activeReviewers: Array<{ participantId: string }>
): RealtimeReviewerFeedbackPacket[] {
  const activeReviewerIds = new Set(activeReviewers.map((reviewer) => reviewer.participantId));
  return turns
    .filter((turn) => Boolean(turn.participantId) && activeReviewerIds.has(turn.participantId ?? ""))
    .map((turn) => buildRealtimeReviewerFeedbackPacket(turn));
}

export function extractRealtimeBlockerUserQuestion(response: string): string | undefined {
  return normalizeLedgerParagraph(extractMarkdownSection(response, "User Question"))
    || normalizeLedgerParagraph(extractMarkdownSection(response, "Question"))
    || undefined;
}

export function extractInterventionCoordinatorDecision(output: string, round: number): InterventionCoordinatorDecision {
  const rawDecision = normalizeLedgerSingleLine(extractMarkdownSection(output, "Decision")).toLowerCase();
  const decision: InterventionCoordinatorDecision["decision"] =
    rawDecision === "accept" || rawDecision === "redirect" || rawDecision === "clarify"
      ? rawDecision
      : "clarify";
  const reason = normalizeLedgerParagraph(extractMarkdownSection(output, "Reason")) || "No coordinator reason was returned.";
  const clarifyingQuestion = normalizeLedgerParagraph(extractMarkdownSection(output, "Clarifying Question"));
  return {
    decision,
    reason,
    clarifyingQuestion: clarifyingQuestion && !/^[-*]?\s*없음$/i.test(clarifyingQuestion) ? clarifyingQuestion : undefined,
    ledger: decision === "clarify" ? undefined : extractDiscussionLedger(output, round)
  };
}

export function extractCoordinatorEscalationQuestion(ledger?: DiscussionLedger): string | undefined {
  if (!ledger || !/^\[AWAITING USER INPUT\]/i.test(ledger.currentFocus.trim())) {
    return undefined;
  }

  const firstQuestion = ledger.mustResolve?.find((item) => item.trim().length > 0);
  if (firstQuestion) {
    return firstQuestion.trim();
  }

  return ledger.currentFocus.replace(/^\[AWAITING USER INPUT\]\s*/i, "").trim() || "추가 지시를 한 문장으로 알려 주세요.";
}
