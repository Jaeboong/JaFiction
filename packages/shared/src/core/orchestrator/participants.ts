import { providerLabel } from "./chatEvents";
import { EssayRoleId, ProviderId, ReviewerPerspective, RoleAssignment, ReviewTurn } from "../types";

export interface ReviewParticipant {
  participantId: string;
  participantLabel: string;
  providerId: ProviderId;
  role: ReviewTurn["role"];
  assignment: RoleAssignment;
  roleId?: EssayRoleId;
  perspective?: ReviewerPerspective;
}

export function turnLabel(turn: ReviewTurn): string {
  return turn.participantLabel || providerLabel(turn.providerId);
}

export function buildResearchParticipant(assignment: RoleAssignment): ReviewParticipant {
  return {
    participantId: "context-researcher",
    participantLabel: `${providerLabel(assignment.providerId)} context researcher`,
    providerId: assignment.providerId,
    role: "researcher",
    assignment,
    roleId: "context_researcher"
  };
}

export function buildCoordinatorParticipant(assignment: RoleAssignment): ReviewParticipant {
  return {
    participantId: "coordinator",
    participantLabel: `${providerLabel(assignment.providerId)} section coordinator`,
    providerId: assignment.providerId,
    role: "coordinator",
    assignment,
    roleId: "section_coordinator"
  };
}

export function buildDrafterParticipant(assignment: RoleAssignment): ReviewParticipant {
  return {
    participantId: "section-drafter",
    participantLabel: `${providerLabel(assignment.providerId)} section drafter`,
    providerId: assignment.providerId,
    role: "drafter",
    assignment,
    roleId: "section_drafter"
  };
}

export function buildFinalizerParticipant(assignment: RoleAssignment): ReviewParticipant {
  return {
    participantId: "finalizer",
    participantLabel: `${providerLabel(assignment.providerId)} finalizer`,
    providerId: assignment.providerId,
    role: "finalizer",
    assignment,
    roleId: "finalizer"
  };
}

export function buildReviewerParticipants(
  roles: Record<"fit_reviewer" | "evidence_reviewer" | "voice_reviewer", RoleAssignment>
): ReviewParticipant[] {
  return [
    {
      participantId: "reviewer-1",
      participantLabel: `${providerLabel(roles.evidence_reviewer.providerId)} evidence reviewer`,
      providerId: roles.evidence_reviewer.providerId,
      role: "reviewer",
      assignment: roles.evidence_reviewer,
      roleId: "evidence_reviewer",
      perspective: "technical"
    },
    {
      participantId: "reviewer-2",
      participantLabel: `${providerLabel(roles.fit_reviewer.providerId)} fit reviewer`,
      providerId: roles.fit_reviewer.providerId,
      role: "reviewer",
      assignment: roles.fit_reviewer,
      roleId: "fit_reviewer",
      perspective: "interviewer"
    },
    {
      participantId: "reviewer-3",
      participantLabel: `${providerLabel(roles.voice_reviewer.providerId)} voice reviewer`,
      providerId: roles.voice_reviewer.providerId,
      role: "reviewer",
      assignment: roles.voice_reviewer,
      roleId: "voice_reviewer",
      perspective: "authenticity"
    }
  ];
}
