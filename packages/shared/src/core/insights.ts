import { CompanySourceBundle } from "./companySourceModel";
import {
  buildCompanyAnalysisPrompt,
  buildSupportingInsightPrompt,
  CompanyProfile,
  parseCompanyAnalysisResponse,
  parseSupportingInsightResponse
} from "./companyInsightArtifacts";
import { OpenDartCompanyResolution } from "./openDart";
import { ProjectRecord, ProviderId, ProviderRuntimeState } from "./types";

export interface InsightGateway {
  listRuntimeStates(): Promise<ProviderRuntimeState[]>;
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

export async function generateInsightArtifacts(
  gateway: InsightGateway,
  workspaceRoot: string,
  project: ProjectRecord,
  companyResolution: OpenDartCompanyResolution | undefined,
  companySourceBundle: CompanySourceBundle,
  preferredProviderId?: ProviderId
): Promise<{ providerId: ProviderId; companyProfile: CompanyProfile; artifacts: InsightGenerationArtifacts }> {
  const provider = chooseInsightProvider(await gateway.listRuntimeStates(), preferredProviderId);
  if (!provider) {
    throw new Error("인사이트를 생성하려면 최소 한 개의 healthy provider가 필요합니다.");
  }

  const apiKey = await gateway.getApiKey(provider.providerId);
  const execute = (prompt: string) =>
    gateway.execute(provider.providerId, prompt, {
      cwd: workspaceRoot,
      authMode: provider.authMode,
      apiKey
    });

  const companyPhase = parseCompanyAnalysisResponse(
    (await execute(buildCompanyAnalysisPrompt(project, companyResolution, companySourceBundle))).text,
    project.companyName,
    companySourceBundle.manifest.coverage
  );
  const followUp = parseSupportingInsightResponse(
    (await execute(buildSupportingInsightPrompt(project, companyPhase.companyProfile, companyPhase.companyInsight))).text
  );

  return {
    providerId: provider.providerId,
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
