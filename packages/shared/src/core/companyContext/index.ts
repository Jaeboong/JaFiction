import { ProjectRecord } from "../types";
import { WebSearchProvider } from "../webSearch/provider";
import { nowIso } from "../utils";
import { CompanySourceCoverage } from "../companySourceModel";
import { fetchDartSource } from "./dartSource";
import { fetchWebSource } from "./webSource";
import { derivePostingSource } from "./postingSource";
import { CompanyContextBundle, CompanyContextHints } from "./types";

export type { CompanyContextBundle, CompanyContextHints, DartSourcePayload, PostingSourcePayload, WebSourceEntry, WebSourcePayload } from "./types";

export interface CollectCompanyContextOptions {
  project: ProjectRecord;
  hints: CompanyContextHints;
  storageRoot?: string;
  dartApiKey?: string;
  webProvider?: WebSearchProvider;
  webCacheTtlDays?: number;
}

export async function collectCompanyContext(options: CollectCompanyContextOptions): Promise<CompanyContextBundle> {
  const { project, hints, storageRoot, dartApiKey, webProvider, webCacheTtlDays = 7 } = options;
  const collectedAt = nowIso();

  const [dartResult, webPayload] = await Promise.all([
    dartApiKey && storageRoot
      ? fetchDartSource(project.companyName, project.openDartCorpCode, storageRoot, dartApiKey)
      : Promise.resolve({ kind: "skipped" as const }),
    fetchWebSource(hints, webProvider, webCacheTtlDays, storageRoot)
  ]);

  const postingPayload = derivePostingSource(project);

  if (dartResult.kind === "ambiguous") {
    return {
      collectedAt,
      companyName: project.companyName,
      sources: {
        dart: undefined,
        web: webPayload,
        posting: postingPayload
      },
      coverage: buildContextCoverage(false, webPayload.entries.length > 0, postingPayload.snippets.length > 0),
      reviewNeeded: {
        reason: "openDartAmbiguous",
        candidates: dartResult.candidates
      }
    };
  }

  const dartPayload = dartResult.kind === "resolved" ? dartResult.payload : undefined;

  return {
    collectedAt,
    companyName: project.companyName,
    sources: {
      dart: dartPayload,
      web: webPayload,
      posting: postingPayload
    },
    coverage: buildContextCoverage(
      Boolean(dartPayload),
      webPayload.entries.length > 0,
      postingPayload.snippets.length > 0
    )
  };
}

function buildContextCoverage(hasDart: boolean, hasWeb: boolean, hasPosting: boolean): CompanySourceCoverage {
  const sourceTypes: string[] = [];
  const omissions: string[] = [];

  if (hasDart) {
    sourceTypes.push("OpenDART");
  } else {
    omissions.push("OpenDART 기업개황/재무 자료가 충분하지 않습니다.");
  }

  if (hasWeb) {
    sourceTypes.push("웹/뉴스");
  }

  if (hasPosting) {
    sourceTypes.push("공고 파생");
  } else {
    omissions.push("공고 텍스트에서 직무 정보를 추출하지 못했습니다.");
  }

  return {
    summaryLabel: sourceTypes.length > 0 ? sourceTypes.join(" + ") : "소스 부족",
    sourceTypes,
    omissions,
    coverageNote: omissions.length === 0
      ? "회사 컨텍스트를 충분히 수집했습니다."
      : sourceTypes.length >= 2
        ? "일부 소스를 확보했지만 누락된 축은 보수적으로 해석해야 합니다."
        : "소스 커버리지가 약해 공고/기본 정보 중심으로만 보수적으로 해석해야 합니다.",
    externalEnrichmentUsed: hasWeb
  };
}
