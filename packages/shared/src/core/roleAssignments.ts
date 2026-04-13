import { AgentDefaults, EssayRoleId, ProviderId, RoleAssignment, essayRoleIds } from "./types";

export const reviewRoleOrder: readonly EssayRoleId[] = ["evidence_reviewer", "fit_reviewer", "voice_reviewer"] as const;

export interface ResolvedRoleAssignments {
  all: RoleAssignment[];
  byRole: Record<EssayRoleId, RoleAssignment>;
}

export interface LegacyParticipantSelection {
  coordinatorProvider: ProviderId;
  reviewerProviders: ProviderId[];
}

function normalizeRoleAssignment(role: EssayRoleId, providerId: ProviderId, source?: RoleAssignment): RoleAssignment {
  return {
    role,
    providerId,
    useProviderDefaults: source?.useProviderDefaults ?? true,
    modelOverride: source?.modelOverride,
    effortOverride: source?.effortOverride
  };
}

function fallbackReviewer(
  reviewerProviders: ProviderId[],
  primaryIndex: number,
  coordinatorProvider: ProviderId
): ProviderId {
  return reviewerProviders[primaryIndex]
    ?? reviewerProviders[0]
    ?? reviewerProviders[reviewerProviders.length - 1]
    ?? coordinatorProvider;
}

export function resolveRoleAssignments(
  roleAssignments: RoleAssignment[] | undefined,
  coordinatorProvider: ProviderId,
  reviewerProviders: ProviderId[]
): ResolvedRoleAssignments {
  const sourceMap = new Map((roleAssignments ?? []).map((assignment) => [assignment.role, assignment]));
  const resolvedOrder: EssayRoleId[] = [
    "context_researcher",
    "section_coordinator",
    "section_drafter",
    "fit_reviewer",
    "evidence_reviewer",
    "voice_reviewer",
    "finalizer"
  ];

  const resolvedByRole: Record<EssayRoleId, RoleAssignment> = {
    context_researcher: normalizeRoleAssignment(
      "context_researcher",
      sourceMap.get("context_researcher")?.providerId ?? coordinatorProvider,
      sourceMap.get("context_researcher")
    ),
    section_coordinator: normalizeRoleAssignment(
      "section_coordinator",
      sourceMap.get("section_coordinator")?.providerId ?? coordinatorProvider,
      sourceMap.get("section_coordinator")
    ),
    section_drafter: normalizeRoleAssignment(
      "section_drafter",
      sourceMap.get("section_drafter")?.providerId ?? coordinatorProvider,
      sourceMap.get("section_drafter")
    ),
    fit_reviewer: normalizeRoleAssignment(
      "fit_reviewer",
      sourceMap.get("fit_reviewer")?.providerId ?? fallbackReviewer(reviewerProviders, 1, coordinatorProvider),
      sourceMap.get("fit_reviewer")
    ),
    evidence_reviewer: normalizeRoleAssignment(
      "evidence_reviewer",
      sourceMap.get("evidence_reviewer")?.providerId ?? fallbackReviewer(reviewerProviders, 0, coordinatorProvider),
      sourceMap.get("evidence_reviewer")
    ),
    voice_reviewer: normalizeRoleAssignment(
      "voice_reviewer",
      sourceMap.get("voice_reviewer")?.providerId ?? fallbackReviewer(reviewerProviders, 2, coordinatorProvider),
      sourceMap.get("voice_reviewer")
    ),
    finalizer: normalizeRoleAssignment(
      "finalizer",
      sourceMap.get("finalizer")?.providerId ?? coordinatorProvider,
      sourceMap.get("finalizer")
    ),
    insight_analyst: normalizeRoleAssignment(
      "insight_analyst",
      sourceMap.get("insight_analyst")?.providerId ?? coordinatorProvider,
      sourceMap.get("insight_analyst")
    )
  };

  return {
    all: resolvedOrder.map((role) => resolvedByRole[role]),
    byRole: resolvedByRole
  };
}

export function deriveLegacyParticipantsFromRoles(
  roleAssignments: RoleAssignment[] | undefined,
  coordinatorProvider: ProviderId,
  reviewerProviders: ProviderId[]
): LegacyParticipantSelection {
  const resolved = resolveRoleAssignments(roleAssignments, coordinatorProvider, reviewerProviders);
  return {
    coordinatorProvider: resolved.byRole.section_coordinator.providerId,
    reviewerProviders: reviewRoleOrder.map((role) => resolved.byRole[role].providerId)
  };
}

const orchestrationRoleIds = essayRoleIds.filter((role) => role !== "insight_analyst");

export function buildRoleAssignmentsFromDefaults(agentDefaults: AgentDefaults): RoleAssignment[] {
  return orchestrationRoleIds.flatMap((role) => {
    const config = agentDefaults[role];
    if (!config) {
      return [];
    }

    return [{
      role,
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
