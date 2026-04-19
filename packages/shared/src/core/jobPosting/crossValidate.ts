export interface CrossValidateCandidate {
  value: string;
  source: "hostname" | "titleStrip" | "ogSiteName" | "ogTitle" | "footer" | "h1" | "nextDataRoleTitle" | "body";
}

export interface CrossValidateResult {
  value?: string;
  tier?: "factual";
  matchedSources: CrossValidateCandidate["source"][];
}

export const DEFAULT_STOP_TOKENS = [
  "채용",
  "공고",
  "공개",
  "신입",
  "경력",
  "모집",
  "idis",
  "inc",
  "corp",
  "ltd"
] as const;

const splitTokenPattern = /[\s·:|,/\-()\[\]{}【】〔〕]+/;
const trailingParticlePattern = /(?:는|은|이|가|을|를|의|와|과)$/;
const trimPunctuationPattern = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

interface TokenizeOptions {
  minTokenLen?: number;
  stopTokens?: readonly string[];
}

interface PreparedCandidate extends CrossValidateCandidate {
  index: number;
  tokenCount: number;
}

export function tokenOverlapAtLeast(
  needle: string,
  haystack: string,
  minCount: number,
  opts: TokenizeOptions = {}
): boolean {
  if (minCount <= 0) {
    return true;
  }

  const tokens = extractTokens(needle, opts);
  if (tokens.length < minCount) {
    return false;
  }

  const haystackText = haystack.toLowerCase().replace(/\s+/g, " ").trim();
  let matchedCount = 0;
  for (const token of tokens) {
    if (!haystackText.includes(token)) {
      continue;
    }
    matchedCount += 1;
    if (matchedCount >= minCount) {
      return true;
    }
  }

  return false;
}

export function crossValidateCandidates(
  candidates: readonly CrossValidateCandidate[],
  opts: {
    minAgreeCount?: number;
    minTokenOverlap?: number;
    stopTokens?: readonly string[];
  } = {}
): CrossValidateResult {
  const minAgreeCount = opts.minAgreeCount ?? 2;
  const minTokenOverlap = opts.minTokenOverlap ?? 1;
  const tokenizeOptions: TokenizeOptions = {
    stopTokens: opts.stopTokens
  };
  const prepared = candidates
    .map<PreparedCandidate | undefined>((candidate, index) => {
      const value = candidate.value.trim();
      if (!value) {
        return undefined;
      }
      return {
        ...candidate,
        value,
        index,
        tokenCount: extractTokens(value, tokenizeOptions).length
      };
    })
    .filter((candidate): candidate is PreparedCandidate => Boolean(candidate));

  let bestGroup: PreparedCandidate[] = [];
  for (const anchor of prepared) {
    const matchedBySource = new Map<CrossValidateCandidate["source"], PreparedCandidate>();
    for (const candidate of prepared) {
      if (!valuesCrossValidate(anchor.value, candidate.value, minTokenOverlap, tokenizeOptions)) {
        continue;
      }
      const existing = matchedBySource.get(candidate.source);
      if (!existing || isBetterCandidate(candidate, existing)) {
        matchedBySource.set(candidate.source, candidate);
      }
    }

    const group = [...matchedBySource.values()].sort((left, right) => left.index - right.index);
    if (group.length < minAgreeCount) {
      continue;
    }
    if (bestGroup.length === 0 || isBetterGroup(group, bestGroup)) {
      bestGroup = group;
    }
  }

  if (bestGroup.length < minAgreeCount) {
    return { matchedSources: [] };
  }

  const representative = bestGroup.reduce((best, candidate) =>
    isBetterCandidate(candidate, best) ? candidate : best
  );

  return {
    value: representative.value,
    tier: "factual",
    matchedSources: bestGroup.map((candidate) => candidate.source)
  };
}

function valuesCrossValidate(
  left: string,
  right: string,
  minTokenOverlap: number,
  opts: TokenizeOptions
): boolean {
  return tokenOverlapAtLeast(left, right, minTokenOverlap, opts)
    || tokenOverlapAtLeast(right, left, minTokenOverlap, opts);
}

function extractTokens(value: string, opts: TokenizeOptions = {}): string[] {
  const minTokenLen = opts.minTokenLen ?? 2;
  const stopTokens = new Set((opts.stopTokens ?? DEFAULT_STOP_TOKENS).map((token) => normalizeToken(token)));
  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const rawToken of value.split(splitTokenPattern)) {
    const token = normalizeToken(rawToken);
    if (!token || token.length < minTokenLen || stopTokens.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(trimPunctuationPattern, "")
    .replace(trailingParticlePattern, "")
    .trim();
}

function isBetterGroup(left: PreparedCandidate[], right: PreparedCandidate[]): boolean {
  if (left.length !== right.length) {
    return left.length > right.length;
  }

  const leftRepresentative = left.reduce((best, candidate) =>
    isBetterCandidate(candidate, best) ? candidate : best
  );
  const rightRepresentative = right.reduce((best, candidate) =>
    isBetterCandidate(candidate, best) ? candidate : best
  );
  return isBetterCandidate(leftRepresentative, rightRepresentative);
}

function isBetterCandidate(left: PreparedCandidate, right: PreparedCandidate): boolean {
  if (left.tokenCount !== right.tokenCount) {
    return left.tokenCount > right.tokenCount;
  }
  return left.index < right.index;
}
