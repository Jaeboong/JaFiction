import { CompanySourceBundle } from "./companySourceModel";
import {
  buildCompanyAnalysisPrompt,
  buildSupportingInsightPrompt,
  CompanyProfile,
  parseCompanyAnalysisResponse,
  parseSupportingInsightResponse,
  SupportingInsightArtifacts
} from "./companyInsightArtifacts";
import type { CompanyContextBundle } from "./companyContext/types";
import { OpenDartCompanyResolution } from "./openDart";
import { ProjectRecord, ProviderId, ProviderRuntimeState } from "./types";

export interface InsightGateway {
  listRuntimeStates(options?: { refresh?: boolean }): Promise<ProviderRuntimeState[]>;
  execute(
    providerId: ProviderId,
    prompt: string,
    options: {
      cwd: string;
      authMode: ProviderRuntimeState["authMode"];
      apiKey?: string;
      modelOverride?: string;
      effortOverride?: string;
    }
  ): Promise<{ text: string }>;
  getApiKey(providerId: ProviderId): Promise<string | undefined>;
}

export interface InsightGenerationArtifacts {
  "company-insight.md": string;
  "job-insight.md": string;
  "application-strategy.md": string;
  "question-analysis.md": string;
}

export interface CompanyAnalysisPhaseResult {
  providerId: ProviderId;
  companyProfile: CompanyProfile;
  companyInsight: string;
}

export async function generateCompanyAnalysisPhase(
  gateway: InsightGateway,
  workspaceRoot: string,
  project: ProjectRecord,
  companyResolution: OpenDartCompanyResolution | undefined,
  companySourceBundle: CompanySourceBundle,
  preferredProviderId?: ProviderId,
  modelOverride?: string,
  effortOverride?: string,
  companyContext?: CompanyContextBundle
): Promise<CompanyAnalysisPhaseResult> {
  const provider = chooseInsightProvider(await gateway.listRuntimeStates({ refresh: true }), preferredProviderId);
  if (!provider) {
    throw new Error("인사이트를 생성하려면 최소 한 개의 healthy provider가 필요합니다.");
  }

  const apiKey = await gateway.getApiKey(provider.providerId);
  const result = parseCompanyAnalysisResponse(
    (await gateway.execute(provider.providerId, buildCompanyAnalysisPrompt(project, companyResolution, companySourceBundle, companyContext), {
      cwd: workspaceRoot,
      authMode: provider.authMode,
      apiKey,
      modelOverride,
      effortOverride
    })).text,
    project.companyName,
    companySourceBundle.manifest.coverage
  );

  return {
    providerId: provider.providerId,
    companyProfile: result.companyProfile,
    companyInsight: result.companyInsight
  };
}

export async function generateSupportingInsightPhase(
  gateway: InsightGateway,
  workspaceRoot: string,
  project: ProjectRecord,
  companyAnalysis: CompanyAnalysisPhaseResult,
  modelOverride?: string,
  effortOverride?: string
): Promise<SupportingInsightArtifacts> {
  const provider = chooseInsightProvider(await gateway.listRuntimeStates(), companyAnalysis.providerId);
  if (!provider) {
    throw new Error("인사이트를 생성하려면 최소 한 개의 healthy provider가 필요합니다.");
  }

  const apiKey = await gateway.getApiKey(provider.providerId);
  return parseSupportingInsightResponse(
    (await gateway.execute(provider.providerId, buildSupportingInsightPrompt(project, companyAnalysis.companyProfile, companyAnalysis.companyInsight), {
      cwd: workspaceRoot,
      authMode: provider.authMode,
      apiKey,
      modelOverride,
      effortOverride
    })).text
  );
}

export async function generateInsightArtifacts(
  gateway: InsightGateway,
  workspaceRoot: string,
  project: ProjectRecord,
  companyResolution: OpenDartCompanyResolution | undefined,
  companySourceBundle: CompanySourceBundle,
  preferredProviderId?: ProviderId
): Promise<{ providerId: ProviderId; companyProfile: CompanyProfile; artifacts: InsightGenerationArtifacts }> {
  const companyPhase = await generateCompanyAnalysisPhase(gateway, workspaceRoot, project, companyResolution, companySourceBundle, preferredProviderId);
  const followUp = await generateSupportingInsightPhase(gateway, workspaceRoot, project, companyPhase);

  return {
    providerId: companyPhase.providerId,
    companyProfile: companyPhase.companyProfile,
    artifacts: {
      "company-insight.md": companyPhase.companyInsight,
      ...followUp
    }
  };
}

export function chooseInsightProvider(
  states: ProviderRuntimeState[],
  preferredProviderId?: ProviderId
): ProviderRuntimeState | undefined {
  const healthy = states.filter((state) => state.authStatus === "healthy");
  if (!preferredProviderId) {
    return healthy[0];
  }

  return healthy.find((state) => state.providerId === preferredProviderId) ?? healthy[0];
}
