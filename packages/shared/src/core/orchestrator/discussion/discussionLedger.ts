import { createHash } from "node:crypto";
import { formatDiscussionLedgerItems } from "../prompts/promptBlocks";
import {
  ChallengeSeverity,
  ChallengeSource,
  ChallengeStatus,
  ChallengeTicket,
  DiscussionLedger
} from "../../types";

export interface ParsedChallengeDecision {
  ticketId: string;
  action: "close" | "keep-open" | "defer" | "promote";
}

export interface ParsedChallengeAddDecision {
  ticketId: "new";
  action: "add";
  sectionKey?: string;
  sectionLabel?: string;
  severity?: ChallengeSeverity;
  text?: string;
}

export interface ChallengeTicketCluster {
  sectionKey: string;
  sectionLabel: string;
  tickets: ChallengeTicket[];
}

export interface InterventionCoordinatorDecision {
  decision: "accept" | "redirect" | "clarify";
  reason: string;
  clarifyingQuestion?: string;
  ledger?: DiscussionLedger;
}

export interface InterventionPartialSnapshot {
  round: number;
  currentDraft: string;
  directiveMessages: string[];
  completedTurns: Array<{ round: number }>;
  completedChatMessages: Array<{ id: string }>;
  currentSection?: {
    targetSection: string;
    targetSectionKey: string;
    currentFocus: string;
    currentObjective?: string;
    rewriteDirection?: string;
    sectionOutcome?: DiscussionLedger["sectionOutcome"];
    openChallenges: string[];
    deferredChallenges: string[];
    mustResolve: string[];
  };
}

export function normalizeSectionKey(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "section";
}

export function seedTicketsFromLegacyLedger(input: {
  targetSection: string;
  targetSectionKey: string;
  openChallenges: string[];
  deferredChallenges: string[];
  updatedAtRound: number;
}): ChallengeTicket[] {
  const tickets: ChallengeTicket[] = [];
  const seenKeys = new Set<string>();
  const addTicket = (
    text: string,
    status: ChallengeStatus,
    severity: ChallengeSeverity,
    sectionKey: string,
    sectionLabel: string,
    source: ChallengeSource,
    handoffPriority: number
  ) => {
    const ticketId = buildChallengeTicketId(sectionKey, text);
    if (!text || seenKeys.has(ticketId)) {
      return;
    }
    seenKeys.add(ticketId);
    tickets.push({
      id: ticketId,
      text,
      sectionKey,
      sectionLabel,
      severity,
      status,
      source,
      introducedAtRound: input.updatedAtRound,
      lastUpdatedAtRound: input.updatedAtRound,
      handoffPriority
    });
  };

  input.openChallenges.forEach((challenge, index) => {
    addTicket(
      challenge,
      "open",
      "blocking",
      input.targetSectionKey,
      input.targetSection,
      "system",
      100 - index
    );
  });

  input.deferredChallenges.forEach((challenge, index) => {
    const deferredSectionKey = normalizeSectionKey(challenge);
    addTicket(
      challenge,
      "deferred",
      "advisory",
      deferredSectionKey,
      challenge,
      "system",
      50 - index
    );
  });

  return tickets;
}

export function buildChallengeTicketId(sectionKey: string, text: string): string {
  const normalizedSection = normalizeSectionKey(sectionKey).slice(0, 16);
  const hash = createHash("sha1")
    .update(`${sectionKey}|${text}`)
    .digest("hex")
    .slice(0, 6);
  return `t-${normalizedSection || "sec"}-${hash}`;
}

export function applyCoordinatorChallengeDecisions(input: {
  baseTickets: ChallengeTicket[];
  decisions: Array<ParsedChallengeDecision | ParsedChallengeAddDecision>;
  targetSection: string;
  targetSectionKey: string;
  round: number;
}): ChallengeTicket[] {
  const tickets = new Map(input.baseTickets.map((ticket) => [ticket.id, { ...ticket }]));
  for (const decision of input.decisions) {
    if (decision.action === "add") {
      if (!decision.text) {
        continue;
      }
      const sectionKey = decision.sectionKey ? normalizeSectionKey(decision.sectionKey) : input.targetSectionKey;
      const sectionLabel = decision.sectionLabel?.trim() || input.targetSection;
      const id = buildChallengeTicketId(sectionKey, decision.text);
      tickets.set(id, {
        id,
        text: decision.text,
        sectionKey,
        sectionLabel,
        severity: decision.severity ?? "advisory",
        status: sectionKey === input.targetSectionKey ? "open" : "deferred",
        source: "coordinator",
        introducedAtRound: input.round,
        lastUpdatedAtRound: input.round,
        handoffPriority: 100
      });
      continue;
    }

    const ticket = tickets.get(decision.ticketId);
    if (!ticket) {
      continue;
    }

    if (decision.action === "close") {
      ticket.status = "closed";
    } else if (decision.action === "defer") {
      ticket.status = "deferred";
    } else {
      ticket.status = "open";
      ticket.sectionKey = input.targetSectionKey;
      ticket.sectionLabel = input.targetSection;
    }
    ticket.lastUpdatedAtRound = input.round;
    tickets.set(ticket.id, ticket);
  }

  return [...tickets.values()];
}

export function deriveLedgerViewsFromTickets(
  tickets: ChallengeTicket[],
  targetSectionKey: string
): { openChallenges: string[]; deferredChallenges: string[] } {
  const openChallenges = tickets
    .filter((ticket) => ticket.status === "open" && ticket.sectionKey === targetSectionKey)
    .map((ticket) => ticket.text);
  const deferredChallenges = tickets
    .filter((ticket) => ticket.status === "deferred" || (ticket.status === "open" && ticket.sectionKey !== targetSectionKey))
    .map((ticket) => ticket.text);
  return {
    openChallenges: dedupeStrings(openChallenges),
    deferredChallenges: dedupeStrings(deferredChallenges)
  };
}

export function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    deduped.push(item);
  }
  return deduped;
}

export function getLedgerTargetSectionKey(ledger?: DiscussionLedger): string {
  return ledger?.targetSectionKey || (ledger ? normalizeSectionKey(ledger.targetSection) : "section");
}

export function getLedgerTickets(ledger?: DiscussionLedger): ChallengeTicket[] {
  if (!ledger) {
    return [];
  }
  if (ledger.tickets && ledger.tickets.length > 0) {
    return ledger.tickets;
  }
  return seedTicketsFromLegacyLedger({
    targetSection: ledger.targetSection,
    targetSectionKey: getLedgerTargetSectionKey(ledger),
    openChallenges: ledger.openChallenges,
    deferredChallenges: ledger.deferredChallenges,
    updatedAtRound: ledger.updatedAtRound
  });
}

export function pickNextTargetSectionCluster(ledger?: DiscussionLedger): ChallengeTicketCluster | undefined {
  if (!ledger) {
    return undefined;
  }

  const currentSectionKey = getLedgerTargetSectionKey(ledger);
  const tickets = getLedgerTickets(ledger).filter(
    (ticket) => ticket.status !== "closed" && ticket.sectionKey !== currentSectionKey
  );
  if (tickets.length === 0) {
    return undefined;
  }

  const clusters = new Map<string, ChallengeTicketCluster>();
  for (const ticket of tickets) {
    const existing = clusters.get(ticket.sectionKey);
    if (existing) {
      existing.tickets.push(ticket);
      if (ticket.lastUpdatedAtRound >= existing.tickets[0].lastUpdatedAtRound) {
        existing.sectionLabel = ticket.sectionLabel;
      }
      continue;
    }
    clusters.set(ticket.sectionKey, {
      sectionKey: ticket.sectionKey,
      sectionLabel: ticket.sectionLabel,
      tickets: [ticket]
    });
  }

  return [...clusters.values()].sort((left, right) => {
    const leftHasBlocking = left.tickets.some((ticket) => ticket.severity === "blocking") ? 1 : 0;
    const rightHasBlocking = right.tickets.some((ticket) => ticket.severity === "blocking") ? 1 : 0;
    if (leftHasBlocking !== rightHasBlocking) {
      return rightHasBlocking - leftHasBlocking;
    }

    const leftPriority = Math.max(...left.tickets.map((ticket) => ticket.handoffPriority));
    const rightPriority = Math.max(...right.tickets.map((ticket) => ticket.handoffPriority));
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftRound = Math.min(...left.tickets.map((ticket) => ticket.introducedAtRound));
    const rightRound = Math.min(...right.tickets.map((ticket) => ticket.introducedAtRound));
    if (leftRound !== rightRound) {
      return leftRound - rightRound;
    }

    return right.tickets.length - left.tickets.length;
  })[0];
}

export function transitionDiscussionLedgerToNextCluster(
  ledger: DiscussionLedger,
  cluster: ChallengeTicketCluster,
  round: number
): DiscussionLedger {
  const tickets = getLedgerTickets(ledger).map((ticket) => {
    if (ticket.sectionKey !== cluster.sectionKey || ticket.status === "closed") {
      return ticket;
    }
    return {
      ...ticket,
      status: "open" as const,
      lastUpdatedAtRound: round
    };
  });
  const derivedViews = deriveLedgerViewsFromTickets(tickets, cluster.sectionKey);
  return {
    ...ledger,
    currentFocus: `${cluster.sectionLabel} 섹션으로 handoff해 남은 쟁점을 정리합니다.`,
    currentObjective: `${cluster.sectionLabel} 섹션의 남은 쟁점을 해결합니다.`,
    targetSection: cluster.sectionLabel,
    targetSectionKey: cluster.sectionKey,
    rewriteDirection: `${cluster.sectionLabel} 섹션의 핵심 논점을 다시 정렬합니다.`,
    miniDraft: `${cluster.sectionLabel} 미니 초안을 다음 라운드에서 새로 정리합니다.`,
    sectionDraft: undefined,
    changeRationale: undefined,
    mustKeep: [],
    mustResolve: cluster.tickets.map((ticket) => ticket.text),
    availableEvidence: [],
    exitCriteria: [],
    nextOwner: "section_drafter",
    openChallenges: derivedViews.openChallenges,
    deferredChallenges: derivedViews.deferredChallenges,
    tickets,
    sectionOutcome: "handoff-next-section",
    updatedAtRound: round
  };
}

export function deferCurrentSectionTickets(
  ledger: DiscussionLedger,
  round: number
): DiscussionLedger {
  const currentSectionKey = getLedgerTargetSectionKey(ledger);
  const tickets = getLedgerTickets(ledger).map((ticket) => {
    if (ticket.sectionKey !== currentSectionKey || ticket.status !== "open") {
      return ticket;
    }
    return {
      ...ticket,
      status: "deferred" as const,
      lastUpdatedAtRound: round
    };
  });
  const derivedViews = deriveLedgerViewsFromTickets(tickets, currentSectionKey);
  return {
    ...ledger,
    openChallenges: derivedViews.openChallenges,
    deferredChallenges: derivedViews.deferredChallenges,
    tickets,
    updatedAtRound: round
  };
}

export function transitionDiscussionLedgerAfterDeferredClose(
  ledger: DiscussionLedger,
  cluster: ChallengeTicketCluster,
  round: number
): DiscussionLedger {
  const deferredLedger = deferCurrentSectionTickets(ledger, round);
  return transitionDiscussionLedgerToNextCluster({
    ...deferredLedger,
    acceptedDecisions: dedupeStrings([
      ...deferredLedger.acceptedDecisions,
      `${deferredLedger.targetSection} 섹션의 남은 advisory 과제를 다음 섹션으로 위임합니다.`
    ]),
    sectionOutcome: "deferred-close"
  }, cluster, round);
}

export function normalizeRealtimeInterventionMessages(messages: string[], directive?: string): string[] {
  const normalized = [
    ...messages,
    directive ?? ""
  ]
    .map((message) => message.trim())
    .filter(Boolean);
  return dedupeStrings(normalized);
}

export function hasForceCloseDirective(messages: string[]): boolean {
  return messages.some((message) => /(?:\/close\b|넘어가|확정)/i.test(message));
}

export function forceAcceptCurrentSection(ledger: DiscussionLedger, round: number): DiscussionLedger {
  const currentSectionKey = getLedgerTargetSectionKey(ledger);
  const tickets = getLedgerTickets(ledger).map((ticket) => {
    if (ticket.status !== "open" || ticket.sectionKey !== currentSectionKey) {
      return ticket;
    }
    return {
      ...ticket,
      status: "deferred" as const,
      lastUpdatedAtRound: round
    };
  });
  const derivedViews = deriveLedgerViewsFromTickets(tickets, currentSectionKey);
  const acceptedLedger: DiscussionLedger = {
    ...ledger,
    acceptedDecisions: dedupeStrings([...ledger.acceptedDecisions, "사용자 개입으로 현재 섹션을 확정하고 다음 단계로 진행합니다."]),
    openChallenges: derivedViews.openChallenges,
    deferredChallenges: derivedViews.deferredChallenges,
    tickets,
    sectionOutcome: "write-final",
    updatedAtRound: round
  };
  const nextCluster = pickNextTargetSectionCluster(acceptedLedger);
  if (!nextCluster) {
    return acceptedLedger;
  }
  return transitionDiscussionLedgerToNextCluster(acceptedLedger, nextCluster, round);
}

export function buildDiscussionLedgerArtifact(ledger: DiscussionLedger): string {
  const tickets = getLedgerTickets(ledger);
  return [
    "# Discussion Ledger",
    "",
    `- Updated At Round: ${ledger.updatedAtRound}`,
    `- Target Section: ${ledger.targetSection}`,
    ...(ledger.targetSectionKey ? [`- Target Section Key: ${ledger.targetSectionKey}`] : []),
    ...(ledger.sectionOutcome ? [`- Section Outcome: ${ledger.sectionOutcome}`] : []),
    ...(ledger.nextOwner ? [`- Next Owner: ${ledger.nextOwner}`] : []),
    "",
    "## Current Focus",
    ledger.currentFocus,
    "",
    ...(ledger.currentObjective ? ["## Current Objective", ledger.currentObjective, ""] : []),
    ...(ledger.rewriteDirection ? ["## Rewrite Direction", ledger.rewriteDirection, ""] : []),
    "## Mini Draft",
    ledger.miniDraft,
    "",
    ...(ledger.sectionDraft ? ["## Section Draft", ledger.sectionDraft, ""] : []),
    ...(ledger.changeRationale ? ["## Change Rationale", ledger.changeRationale, ""] : []),
    ...(ledger.mustKeep ? ["## Must Keep", ...formatDiscussionLedgerItems(ledger.mustKeep), ""] : []),
    ...(ledger.mustResolve ? ["## Must Resolve", ...formatDiscussionLedgerItems(ledger.mustResolve), ""] : []),
    ...(ledger.availableEvidence ? ["## Available Evidence", ...formatDiscussionLedgerItems(ledger.availableEvidence), ""] : []),
    ...(ledger.exitCriteria ? ["## Exit Criteria", ...formatDiscussionLedgerItems(ledger.exitCriteria), ""] : []),
    "## Accepted Decisions",
    ...formatDiscussionLedgerItems(ledger.acceptedDecisions),
    "",
    "## Open Challenges",
    ...formatDiscussionLedgerItems(ledger.openChallenges),
    "",
    "## Deferred Challenges",
    ...formatDiscussionLedgerItems(ledger.deferredChallenges),
    ...(tickets.length > 0
      ? [
          "",
          "## Challenge Tickets",
          ...tickets.map((ticket) =>
            `- [${ticket.id}] ${ticket.severity} | ${ticket.status} | ${ticket.sectionKey} | ${ticket.text}`
          )
        ]
      : [])
  ].join("\n");
}
