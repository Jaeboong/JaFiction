import type { AgentDefaultConfig, AgentDefaults, EssayRoleId, ProviderId, RoleAssignment } from "@jafiction/shared";

export const essayRoleIds: EssayRoleId[] = [
  "context_researcher",
  "section_coordinator",
  "section_drafter",
  "fit_reviewer",
  "evidence_reviewer",
  "voice_reviewer",
  "finalizer"
];

export const essayRoleLabels: Record<EssayRoleId, string> = {
  context_researcher: "컨텍스트 연구원",
  section_coordinator: "섹션 코디네이터",
  section_drafter: "섹션 작성자",
  fit_reviewer: "적합성 리뷰어",
  evidence_reviewer: "근거 리뷰어",
  voice_reviewer: "어조 리뷰어",
  finalizer: "완성자"
};

export const reviewerRoleOrder: EssayRoleId[] = ["evidence_reviewer", "fit_reviewer", "voice_reviewer"];

export type ResolvedAgentDefaults = Record<EssayRoleId, AgentDefaultConfig>;

export function materializeAgentDefaults(
  agentDefaults: AgentDefaults,
  providers: Array<{ providerId: ProviderId }>,
  preferredProviderId?: ProviderId
): ResolvedAgentDefaults {
  const fallbackProviderId = providers.some((provider) => provider.providerId === preferredProviderId)
    ? preferredProviderId!
    : providers[0]?.providerId ?? "codex";

  return essayRoleIds.reduce<ResolvedAgentDefaults>((accumulator, roleId) => {
    accumulator[roleId] = agentDefaults[roleId] ?? {
      providerId: fallbackProviderId,
      useProviderDefaults: false,
      modelOverride: "",
      effortOverride: ""
    };
    return accumulator;
  }, {} as ResolvedAgentDefaults);
}

export function buildRoleAssignmentsFromDefaults(agentDefaults: AgentDefaults): RoleAssignment[] {
  return essayRoleIds.flatMap((roleId) => {
    const config = agentDefaults[roleId];
    if (!config) {
      return [];
    }

    return [{
      role: roleId,
      providerId: config.providerId,
      useProviderDefaults: config.useProviderDefaults,
      modelOverride: config.useProviderDefaults ? undefined : normalizeOverride(config.modelOverride),
      effortOverride: config.useProviderDefaults ? undefined : normalizeOverride(config.effortOverride)
    }];
  });
}

function normalizeOverride(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function buildParticipantSelectionFromDefaults(agentDefaults: ResolvedAgentDefaults): {
  coordinatorProvider: ProviderId;
  reviewerProviders: ProviderId[];
} {
  return {
    coordinatorProvider: agentDefaults.section_coordinator.providerId,
    reviewerProviders: reviewerRoleOrder.map((roleId) => agentDefaults[roleId].providerId)
  };
}
