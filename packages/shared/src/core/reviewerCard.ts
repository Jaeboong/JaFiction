export interface ParsedRealtimeReviewerSection {
  headerValue: string;
  body: string;
}

export interface ReviewerCardContent {
  miniDraft?: string;
  challenges: string[];
  crossFeedback: string[];
  status?: string;
}

type ReviewerChallengeAction = "close" | "keep-open" | "defer";

export function collectRealtimeReviewerSections(response: string): Map<string, ParsedRealtimeReviewerSection[]> {
  const normalized = response.replace(/\r\n?/g, "\n");
  const sections = new Map<string, ParsedRealtimeReviewerSection[]>();
  let currentLabel: string | undefined;
  let currentHeaderValue = "";
  let currentBodyLines: string[] = [];

  const flushCurrentSection = () => {
    if (!currentLabel) {
      return;
    }

    const entries = sections.get(currentLabel) ?? [];
    entries.push({
      headerValue: currentHeaderValue.trim(),
      body: currentBodyLines.join("\n").trim()
    });
    sections.set(currentLabel, entries);
  };

  for (const rawLine of normalized.split("\n")) {
    const trimmed = rawLine.trim();
    const headerMatch = trimmed.match(/^(Mini Draft|Challenge|Cross-feedback|Status):\s*(.*)$/);
    if (headerMatch) {
      flushCurrentSection();
      currentLabel = headerMatch[1];
      currentHeaderValue = headerMatch[2].trim();
      currentBodyLines = [];
      continue;
    }

    if (!currentLabel) {
      continue;
    }

    if (!trimmed) {
      if (currentBodyLines.length > 0 && currentBodyLines[currentBodyLines.length - 1] !== "") {
        currentBodyLines.push("");
      }
      continue;
    }

    currentBodyLines.push(trimmed);
  }

  flushCurrentSection();
  return sections;
}

export function parseReviewerChallengeHeader(headerValue: string): {
  ticketId?: string;
  action?: ReviewerChallengeAction;
  reason?: string;
} | undefined {
  const { challengeClause, reason } = splitReviewerChallengeHeader(headerValue);
  if (!challengeClause) {
    return undefined;
  }

  const bracketedMatch = challengeClause.match(/^\[(.+?)\]\s+(close|keep-open|defer)$/i);
  if (bracketedMatch) {
    return {
      ticketId: bracketedMatch[1].trim(),
      action: bracketedMatch[2].toLowerCase() as ReviewerChallengeAction,
      reason
    };
  }

  const bareTicketMatch = challengeClause.match(/^(.+?)\s+(close|keep-open|defer)$/i);
  if (bareTicketMatch) {
    return {
      ticketId: bareTicketMatch[1].trim(),
      action: bareTicketMatch[2].toLowerCase() as ReviewerChallengeAction,
      reason
    };
  }

  const recovered = recoverReviewerChallengeTicketId(challengeClause);
  return recovered ? { ...recovered, reason } : undefined;
}

export function parseReviewerCardContent(content: string): ReviewerCardContent | null {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  const sections = collectRealtimeReviewerSections(normalized);
  if (sections.size === 0) {
    return null;
  }

  const miniDraftEntries = sections.get("Mini Draft") ?? [];
  const miniDraft = [...miniDraftEntries]
    .reverse()
    .map((section) => normalizeParagraph(joinReviewerSectionParts(section)))
    .find(Boolean);
  const challenges = (sections.get("Challenge") ?? [])
    .map((section) => extractReviewerCardChallengeText(section))
    .filter(Boolean);
  const crossFeedback = (sections.get("Cross-feedback") ?? [])
    .map((section) => extractReviewerCardCrossFeedbackText(section))
    .filter(Boolean);
  const status = extractReviewerCardStatus(sections.get("Status") ?? []);

  if (!miniDraft && challenges.length === 0 && crossFeedback.length === 0 && !status) {
    return null;
  }

  return {
    miniDraft: miniDraft || undefined,
    challenges,
    crossFeedback,
    status
  };
}

function joinReviewerSectionParts(section: ParsedRealtimeReviewerSection): string {
  return [section.headerValue, section.body].filter(Boolean).join("\n");
}

function normalizeParagraph(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

function stripReviewerCardInternalPrefix(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function extractReviewerCardChallengeText(section: ParsedRealtimeReviewerSection): string {
  const body = normalizeParagraph(section.body);
  if (body) {
    return stripReviewerCardInternalPrefix(body);
  }

  const parsed = parseReviewerChallengeHeader(section.headerValue);
  if (parsed?.reason) {
    return stripReviewerCardInternalPrefix(parsed.reason);
  }

  if (parsed) {
    return "";
  }

  return stripReviewerCardInternalPrefix(normalizeParagraph(section.headerValue));
}

function extractReviewerCardCrossFeedbackText(section: ParsedRealtimeReviewerSection): string {
  const body = normalizeParagraph(section.body);
  if (body) {
    return stripReviewerCardInternalPrefix(body);
  }

  const inline = normalizeReviewerCardCrossFeedbackInline(section.headerValue);
  return inline ? stripReviewerCardInternalPrefix(inline) : "";
}

function normalizeReviewerCardCrossFeedbackInline(headerValue: string): string {
  const normalized = normalizeParagraph(headerValue);
  if (!normalized) {
    return "";
  }

  const withoutReference = normalized.replace(/^\[[^\]]+\]\s*/, "").trim();
  const verdictMatch = withoutReference.match(/^(agree|disagree)\b[\s:,-]*(.*)$/i);
  if (!verdictMatch) {
    return withoutReference;
  }

  return verdictMatch[2].trim();
}

function extractReviewerCardStatus(sections: ParsedRealtimeReviewerSection[]): string | undefined {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const candidate = normalizeSingleLine(joinReviewerSectionParts(sections[index]));
    const statusMatch = candidate.match(/\b(approve|revise|block)\b/i);
    if (statusMatch) {
      return statusMatch[1].toUpperCase();
    }
  }

  return undefined;
}

function normalizeSingleLine(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function splitReviewerChallengeHeader(headerValue: string): {
  challengeClause: string;
  reason?: string;
} {
  const normalized = headerValue.replace(/\s+/g, " ").trim();
  const becauseMatch = normalized.match(/\s+because\s+/i);
  if (!becauseMatch || becauseMatch.index === undefined) {
    return { challengeClause: normalized };
  }

  const challengeClause = normalized.slice(0, becauseMatch.index).trim();
  const reason = normalized.slice(becauseMatch.index + becauseMatch[0].length).trim();
  return {
    challengeClause,
    reason: reason || undefined
  };
}

function recoverReviewerChallengeTicketId(challengeClause: string): {
  ticketId: string;
  action?: ReviewerChallengeAction;
} | undefined {
  const lastSpaceIndex = challengeClause.lastIndexOf(" ");
  if (lastSpaceIndex <= 0) {
    return undefined;
  }

  const ticketIdCandidate = challengeClause.slice(0, lastSpaceIndex).trim();
  const trailingToken = challengeClause.slice(lastSpaceIndex + 1).trim().toLowerCase();
  if (!ticketIdCandidate || !isSectionOutcomeToken(trailingToken)) {
    return undefined;
  }

  const bracketedTicketMatch = ticketIdCandidate.match(/^\[(.+?)\]$/);
  const ticketId = (bracketedTicketMatch ? bracketedTicketMatch[1] : ticketIdCandidate).trim();
  if (!ticketId) {
    return undefined;
  }

  return {
    ticketId,
    action: isReviewerChallengeActionToken(trailingToken) ? trailingToken : undefined
  };
}

function isReviewerChallengeActionToken(raw: string): raw is ReviewerChallengeAction {
  return raw === "close" || raw === "keep-open" || raw === "defer";
}

function isSectionOutcomeToken(raw: string): boolean {
  return raw === "keep-open"
    || raw === "close-section"
    || raw === "handoff-next-section"
    || raw === "write-final"
    || raw === "deferred-close";
}
