import { truncateContinuationText } from "../continuation";
import { ReviewParticipant } from "../participants";
import {
  collectRealtimeReviewerStatuses,
  extractRealtimeReviewerChallengeAction,
  extractRealtimeReviewerObjection,
  extractRealtimeReviewerStatus,
  RealtimeReviewerStatus
} from "../parsing/responseParsers";
import { DiscussionLedger, ReviewTurn, SectionOutcome } from "../../types";
import { getLedgerTargetSectionKey, getLedgerTickets, pickNextTargetSectionCluster } from "./discussionLedger";

export interface RealtimeReviewerVerdictSummary {
  approveCount: number;
  reviseCount: number;
  blockCount: number;
  majority: RealtimeReviewerStatus | "NONE";
  majorityApproved: boolean;
  majorityRevise: boolean;
  majorityReviseNeedsHold: boolean;
  minorityRevise?: {
    reviewer: string;
    summary: string;
  };
}

export function summarizeRealtimeReviewerVerdicts(
  turns: ReviewTurn[],
  activeReviewers: ReviewParticipant[]
): RealtimeReviewerVerdictSummary {
  const statuses = collectRealtimeReviewerStatuses(turns, activeReviewers);
  let approveCount = 0;
  let reviseCount = 0;
  let blockCount = 0;

  for (const reviewer of activeReviewers) {
    const status = statuses.get(reviewer.participantId);
    if (status === "PASS") {
      approveCount += 1;
      continue;
    }
    if (status === "BLOCK") {
      blockCount += 1;
      continue;
    }
    if (status === "REVISE") {
      reviseCount += 1;
    }
  }

  const majorityThreshold = Math.floor(activeReviewers.length / 2);
  const majorityApproved = blockCount === 0 && approveCount > majorityThreshold;
  const majorityRevise = blockCount === 0 && reviseCount > majorityThreshold;
  const majorityReviseNeedsHold = majorityRevise && turns
    .filter((turn) => extractRealtimeReviewerStatus(turn.response) === "REVISE")
    .some((turn) => extractRealtimeReviewerChallengeAction(turn.response) === "keep-open");
  const minorityReviseTurn = !majorityRevise && reviseCount > 0
    ? turns.find((turn) => {
        const reviewer = activeReviewers.find((participant) => participant.participantId === turn.participantId);
        return Boolean(reviewer) && extractRealtimeReviewerStatus(turn.response) === "REVISE";
      })
    : undefined;

  return {
    approveCount,
    reviseCount,
    blockCount,
    majority: blockCount > 0 ? "BLOCK" : majorityRevise ? "REVISE" : majorityApproved ? "PASS" : "NONE",
    majorityApproved,
    majorityRevise,
    majorityReviseNeedsHold,
    minorityRevise: minorityReviseTurn
      ? {
          reviewer: minorityReviseTurn.participantLabel || "reviewer",
          summary: truncateContinuationText(extractRealtimeReviewerObjection(minorityReviseTurn.response), 180)
        }
      : undefined
  };
}

export function hasAllApprovingRealtimeReviewers(
  activeReviewers: ReviewParticipant[],
  statuses: Map<string, RealtimeReviewerStatus>
): boolean {
  return activeReviewers.length > 0 && activeReviewers.every((reviewer) => statuses.get(reviewer.participantId) === "PASS");
}

export function hasBlockingRealtimeReviewer(
  activeReviewers: ReviewParticipant[],
  statuses: Map<string, RealtimeReviewerStatus>
): boolean {
  return activeReviewers.some((reviewer) => statuses.get(reviewer.participantId) === "BLOCK");
}

export function isCurrentSectionReady(
  ledger: DiscussionLedger | undefined,
  activeReviewers: ReviewParticipant[],
  statuses: Map<string, RealtimeReviewerStatus>
): boolean {
  if (!ledger) {
    return false;
  }

  const targetSectionKey = getLedgerTargetSectionKey(ledger);
  const hasOpenBlockingTickets = getLedgerTickets(ledger).some(
    (ticket) => ticket.status === "open" && ticket.sectionKey === targetSectionKey && ticket.severity === "blocking"
  );
  return !hasOpenBlockingTickets && !hasBlockingRealtimeReviewer(activeReviewers, statuses);
}

export function isWholeDocumentReady(
  ledger: DiscussionLedger | undefined,
  activeReviewers: ReviewParticipant[],
  statuses: Map<string, RealtimeReviewerStatus>,
  options?: {
    requestedSectionOutcome?: SectionOutcome;
    allReviewersApprove?: boolean;
  }
): boolean {
  if (!isCurrentSectionReady(ledger, activeReviewers, statuses)) {
    return false;
  }

  if (!pickNextTargetSectionCluster(ledger)) {
    return true;
  }

  return !options?.requestedSectionOutcome && options?.allReviewersApprove === true;
}

export function validateSectionOutcome(
  requestedOutcome: SectionOutcome | undefined,
  options: { currentSectionReady: boolean; wholeDocumentReady: boolean; hasNextCluster: boolean }
): SectionOutcome {
  if (options.wholeDocumentReady) {
    return "write-final";
  }
  if (requestedOutcome === "deferred-close") {
    if (options.currentSectionReady && options.hasNextCluster) {
      return "deferred-close";
    }
    return options.currentSectionReady ? "close-section" : "keep-open";
  }
  if (options.currentSectionReady && options.hasNextCluster) {
    return "handoff-next-section";
  }
  if (options.currentSectionReady) {
    return requestedOutcome === "keep-open" ? "keep-open" : "close-section";
  }
  return "keep-open";
}

export function forceSectionClosureOutcome(options: {
  wholeDocumentReady: boolean;
  hasNextCluster: boolean;
}): SectionOutcome {
  if (options.wholeDocumentReady || !options.hasNextCluster) {
    return "write-final";
  }

  return "handoff-next-section";
}

export function shouldRunWeakConsensusPolish(
  activeReviewers: ReviewParticipant[],
  statuses: Map<string, RealtimeReviewerStatus>,
  currentSectionKey: string,
  polishRoundsUsed: Set<string>
): boolean {
  if (polishRoundsUsed.has(currentSectionKey) || activeReviewers.length === 0) {
    return false;
  }

  let reviseCount = 0;
  for (const reviewer of activeReviewers) {
    if (statuses.get(reviewer.participantId) === "REVISE") {
      reviseCount += 1;
    }
  }

  return reviseCount > Math.floor(activeReviewers.length / 2);
}

export function normalizeMaxRoundsPerSection(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(10, Math.max(1, Math.trunc(value ?? 1)));
}
