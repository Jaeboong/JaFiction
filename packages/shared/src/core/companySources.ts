import { normalizeJobPostingHtml, normalizeJobPostingText } from "./jobPosting";
import { OpenDartCompanyResolution } from "./openDart";
import { ProjectRecord } from "./types";
import { nowIso } from "./utils";
import {
  buildCoverage,
  buildMissingSource,
  buildOpenDartArtifacts,
  dedupeSnippets,
  extractSourceSnippets,
  renderCompanySourceCoverageMarkdown
} from "./companySourceCoverage";
import {
  buildCompanySourceId,
  CompanySourceBundle,
  CompanySourceEntry,
  CompanySourceKind,
  companySourceLabels,
  companySourceRequestHeaders
} from "./companySourceModel";

export type {
  CompanySourceBundle,
  CompanySourceCoverage,
  CompanySourceEntry,
  CompanySourceKind,
  CompanySourceManifest,
  CompanySourceSnippet
} from "./companySourceModel";
export { renderCompanySourceCoverageMarkdown } from "./companySourceCoverage";

interface CandidateSource {
  kind: CompanySourceKind;
  url: string;
  label: string;
  discoveredFrom: CompanySourceEntry["discoveredFrom"];
}

interface FetchedSourcePage {
  entry: CompanySourceEntry;
  html?: string;
  normalizedText?: string;
}

export async function collectCompanySourceBundle(
  project: ProjectRecord,
  companyResolution: OpenDartCompanyResolution | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<CompanySourceBundle> {
  const collectedAt = nowIso();
  const baseArtifacts = buildOpenDartArtifacts(companyResolution, collectedAt);
  const sources = [...baseArtifacts.sources];
  const snippets = [...baseArtifacts.snippets];
  const candidates = new Map<CompanySourceKind, CandidateSource>();

  const homepageUrl = companyResolution?.status === "resolved" ? normalizeAbsoluteUrl(companyResolution.overview.homepageUrl) : undefined;
  if (homepageUrl) {
    const homepage = await fetchCompanyPage({
      kind: "officialHomepage",
      url: homepageUrl,
      label: companySourceLabels.officialHomepage,
      discoveredFrom: "openDart"
    }, fetchImpl, collectedAt);
    sources.push(homepage.entry);
    snippets.push(...extractSourceSnippets(homepage.entry.id, homepage.entry.kind, homepage.normalizedText));
    if (homepage.html) {
      for (const candidate of discoverCandidates(homepage.html, homepageUrl)) {
        setCandidate(candidates, candidate);
      }
    }
  } else {
    sources.push(buildMissingSource("officialHomepage", collectedAt, "OpenDART 홈페이지 주소가 없어 공식 사이트 탐색을 생략했습니다."));
  }

  const officialHiringUrl = resolveOfficialHiringUrl(project.jobPostingUrl, homepageUrl);
  if (officialHiringUrl) {
    setCandidate(candidates, {
      kind: "officialHiring",
      url: officialHiringUrl,
      label: companySourceLabels.officialHiring,
      discoveredFrom: "jobPosting"
    });
  }

  if (companyResolution?.status === "resolved") {
    const irUrl = normalizeAbsoluteUrl(companyResolution.overview.irUrl);
    if (irUrl) {
      setCandidate(candidates, {
        kind: "officialIr",
        url: irUrl,
        label: companySourceLabels.officialIr,
        discoveredFrom: "openDart"
      });
    }
  }

  for (const kind of ["companyIntro", "businessIntro", "officialHiring", "officialIr", "officialPress", "officialTechBlog"] as const) {
    const candidate = candidates.get(kind);
    if (!candidate) {
      sources.push(buildMissingSource(kind, collectedAt));
      continue;
    }

    if (homepageUrl && normalizeUrlKey(candidate.url) === normalizeUrlKey(homepageUrl)) {
      sources.push(buildMissingSource(kind, collectedAt, "공식 홈페이지와 동일한 주소라 별도 수집을 생략했습니다."));
      continue;
    }

    const page = await fetchCompanyPage(candidate, fetchImpl, collectedAt);
    sources.push(page.entry);
    snippets.push(...extractSourceSnippets(page.entry.id, page.entry.kind, page.normalizedText));
  }

  return {
    manifest: {
      collectedAt,
      companyName: project.companyName,
      sources,
      coverage: buildCoverage(sources)
    },
    snippets: dedupeSnippets(snippets)
  };
}

async function fetchCompanyPage(
  candidate: CandidateSource,
  fetchImpl: typeof fetch,
  collectedAt: string
): Promise<FetchedSourcePage> {
  try {
    const response = await fetchImpl(candidate.url, { headers: companySourceRequestHeaders });
    const html = await response.text();
    if (!response.ok) {
      return { entry: buildSourceEntry(candidate, collectedAt, "failed", undefined, `HTTP ${response.status}`) };
    }

    return {
      entry: buildSourceEntry(candidate, collectedAt, "fetched", extractTitle(html)),
      html,
      normalizedText: normalizeJobPostingHtml(html)
    };
  } catch (error) {
    return {
      entry: buildSourceEntry(candidate, collectedAt, "failed", undefined, error instanceof Error ? error.message : String(error))
    };
  }
}

function discoverCandidates(html: string, homepageUrl: string): CandidateSource[] {
  const candidates = new Map<CompanySourceKind, CandidateSource>();
  const anchorPattern = /<a\b[^>]*href=(["'])([^"'#]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const url = normalizeAbsoluteUrl(match[2], homepageUrl);
    if (!url || !sharesOrigin(homepageUrl, url)) {
      continue;
    }
    const candidateText = `${normalizeJobPostingText(match[3].replace(/<[^>]+>/g, " "))} ${new URL(url).pathname}`;
    const kind = classifyDiscoveredLink(candidateText);
    if (!kind) {
      continue;
    }
    setCandidate(candidates, { kind, url, label: companySourceLabels[kind], discoveredFrom: "homepage" });
  }

  return [...candidates.values()];
}

function classifyDiscoveredLink(text: string): CompanySourceKind | undefined {
  const normalized = text.toLowerCase();
  if (/(회사소개|기업소개|about|company|overview|who we are)/i.test(normalized)) return "companyIntro";
  if (/(사업소개|서비스|business|solution|platform|brand|product)/i.test(normalized)) return "businessIntro";
  if (/(채용|recruit|career|jobs|join)/i.test(normalized)) return "officialHiring";
  if (/(^|[^a-z])(ir|investor)([^a-z]|$)|투자정보|공시/i.test(normalized)) return "officialIr";
  if (/(보도자료|뉴스|news|press)/i.test(normalized)) return "officialPress";
  if (/(tech|engineering|blog|dev)/i.test(normalized)) return "officialTechBlog";
  return undefined;
}

function buildSourceEntry(
  candidate: CandidateSource,
  collectedAt: string,
  status: CompanySourceEntry["status"],
  title?: string,
  note?: string
): CompanySourceEntry {
  return {
    id: buildCompanySourceId(candidate.kind),
    tier: "official",
    kind: candidate.kind,
    label: candidate.label,
    status,
    url: candidate.url,
    title,
    fetchedAt: collectedAt,
    note,
    discoveredFrom: candidate.discoveredFrom
  };
}

function setCandidate(target: Map<CompanySourceKind, CandidateSource>, candidate: CandidateSource): void {
  const existing = target.get(candidate.kind);
  if (!existing || candidate.discoveredFrom === "jobPosting" || candidate.url.length < existing.url.length) {
    target.set(candidate.kind, candidate);
  }
}

function resolveOfficialHiringUrl(jobPostingUrl?: string, homepageUrl?: string): string | undefined {
  const normalizedJobPosting = normalizeAbsoluteUrl(jobPostingUrl);
  return normalizedJobPosting && homepageUrl && sharesOrigin(homepageUrl, normalizedJobPosting) ? normalizedJobPosting : undefined;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? normalizeJobPostingText(match[1].replace(/<[^>]+>/g, " ")) : undefined;
}

function normalizeAbsoluteUrl(value?: string, base?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).toString();
    }
    if (base) {
      return new URL(trimmed, base).toString();
    }
    return new URL(`https://${trimmed.replace(/^\/+/, "")}`).toString();
  } catch {
    return undefined;
  }
}

function sharesOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value;
  }
}
