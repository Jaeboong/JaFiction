import type { SourceTier } from "./sourceTier";
import type { JobPostingFieldKey } from "./jobPosting";

export const REVIEW_NEEDED_REASONS = [
  "lowConfidenceExtraction",
  "extractionError",
  "postingAmbiguous"
] as const;
export type ReviewNeededReason = (typeof REVIEW_NEEDED_REASONS)[number];

export const providerIds = ["codex", "claude", "gemini"] as const;
export type ProviderId = (typeof providerIds)[number];

export const reviewerPerspectives = ["technical", "interviewer", "authenticity"] as const;
export type ReviewerPerspective = (typeof reviewerPerspectives)[number];

export const authModes = ["cli", "apiKey"] as const;
export type AuthMode = (typeof authModes)[number];

export const providerAuthStatuses = ["untested", "healthy", "unhealthy", "missing"] as const;
export type ProviderAuthStatus = (typeof providerAuthStatuses)[number];

export const sourceTypes = ["text", "txt", "md", "pdf", "pptx", "image", "other"] as const;
export type SourceType = (typeof sourceTypes)[number];

export const extractionStatuses = ["normalized", "rawOnly", "failed"] as const;
export type ExtractionStatus = (typeof extractionStatuses)[number];

export const runStatuses = ["running", "awaiting-user-input", "completed", "failed", "aborted"] as const;
export type RunStatus = (typeof runStatuses)[number];

export const reviewModes = ["realtime", "deepFeedback"] as const;
export type ReviewMode = (typeof reviewModes)[number];

export const compileContextProfiles = ["full", "compact", "minimal"] as const;
export type CompileContextProfile = (typeof compileContextProfiles)[number];
export const insightStatuses = ["idle", "reviewNeeded", "generating", "ready", "error"] as const;
export type InsightStatus = (typeof insightStatuses)[number];
export const essayQuestionStatuses = ["idle", "drafting", "completed"] as const;
export type EssayQuestionStatus = (typeof essayQuestionStatuses)[number];

export const essayRoleIds = [
  "context_researcher",
  "section_coordinator",
  "section_drafter",
  "fit_reviewer",
  "evidence_reviewer",
  "voice_reviewer",
  "finalizer",
  "insight_analyst"
] as const;
export type EssayRoleId = (typeof essayRoleIds)[number];

export const essayRoleLabels: Record<EssayRoleId, string> = {
  context_researcher: "컨텍스트 연구원",
  section_coordinator: "섹션 코디네이터",
  section_drafter: "섹션 작성자",
  fit_reviewer: "적합성 리뷰어",
  evidence_reviewer: "근거 리뷰어",
  voice_reviewer: "어조 리뷰어",
  finalizer: "완성자",
  insight_analyst: "인사이트 분석"
};

export interface RoleAssignment {
  role: EssayRoleId;
  providerId: ProviderId;
  useProviderDefaults: boolean;
  modelOverride?: string;
  effortOverride?: string;
}

export interface AgentDefaultConfig {
  providerId: ProviderId;
  useProviderDefaults: boolean;
  modelOverride: string;
  effortOverride: string;
}

export type AgentDefaults = Partial<Record<EssayRoleId, AgentDefaultConfig>>;

export interface RealtimeSectionDefinition {
  key: string;
  label: string;
  responsibilities?: readonly string[];
  deferredTo?: readonly string[];
}

export type DocumentScope = "profile" | "project";
export type ChallengeSeverity = "blocking" | "advisory";
export type ChallengeStatus = "open" | "deferred" | "closed";
export type ChallengeSource = "coordinator" | "reviewer" | "user" | "system";
export type SectionOutcome =
  | "keep-open"
  | "close-section"
  | "handoff-next-section"
  | "write-final"
  | "deferred-close";
export type RunActorRole = "reviewer" | "coordinator" | "researcher" | "drafter" | "finalizer";

export interface ChallengeTicket {
  id: string;
  text: string;
  sectionKey: string;
  sectionLabel: string;
  severity: ChallengeSeverity;
  status: ChallengeStatus;
  source: ChallengeSource;
  introducedAtRound: number;
  lastUpdatedAtRound: number;
  handoffPriority: number;
  evidenceNeeded?: string;
  closeCondition?: string;
}

export interface ProviderStatus {
  providerId: ProviderId;
  installed: boolean;
  authMode: AuthMode;
  authStatus: ProviderAuthStatus;
  version?: string;
  lastCheckAt?: string;
  lastError?: string;
}

export interface ProviderSettingOption {
  value: string;
  label: string;
}

export interface ProviderCapabilities {
  modelOptions: ProviderSettingOption[];
  effortOptions: ProviderSettingOption[];
  supportsEffort: boolean;
}

export interface ContextDocument {
  id: string;
  scope: DocumentScope;
  projectSlug?: string;
  title: string;
  sourceType: SourceType;
  rawPath: string;
  normalizedPath?: string | null;
  pinnedByDefault: boolean;
  extractionStatus: ExtractionStatus;
  note?: string | null;
  createdAt: string;
}

export interface ContextManifest {
  documents: ContextDocument[];
}

export interface OpenDartCandidate {
  corpCode: string;
  corpName: string;
  stockCode?: string;
}

export interface ProjectInsightInput {
  companyName: string;
  roleName?: string;
  deadline?: string;
  overview?: string;
  mainResponsibilities?: string;
  qualifications?: string;
  preferredQualifications?: string;
  benefits?: string;
  hiringProcess?: string;
  insiderView?: string;
  otherInfo?: string;
  keywords?: string[];
  jobPostingUrl?: string;
  jobPostingText?: string;
  essayQuestions?: string[];
  openDartCorpCode?: string;
  openDartCandidates?: OpenDartCandidate[];
  openDartSkipRequested?: boolean;
}

export interface ProjectEssayAnswerState {
  questionIndex: number;
  status: EssayQuestionStatus;
  documentId?: string;
  completedAt?: string;
  lastRunId?: string;
}

export interface ProjectRecord {
  slug: string;
  companyName: string;
  roleName?: string;
  deadline?: string;
  overview?: string;
  mainResponsibilities?: string;
  qualifications?: string;
  preferredQualifications?: string;
  benefits?: string;
  hiringProcess?: string;
  insiderView?: string;
  otherInfo?: string;
  keywords?: string[];
  jobPostingUrl?: string;
  jobPostingText?: string;
  essayQuestions?: string[];
  openDartCorpCode?: string;
  openDartCorpName?: string;
  openDartStockCode?: string;
  openDartCandidates?: OpenDartCandidate[];
  openDartSkipRequested?: boolean;
  postingAnalyzedAt?: string;
  jobPostingManualFallback?: boolean;
  insightStatus?: InsightStatus;
  insightLastGeneratedAt?: string;
  insightLastError?: string;
  essayAnswerStates?: ProjectEssayAnswerState[];
  rubric: string;
  pinnedDocumentIds: string[];
  charLimit?: number;
  notionPageIds?: string[];
  createdAt: string;
  updatedAt: string;
  postingReviewReasons: readonly ReviewNeededReason[];
  jobPostingFieldConfidence: Partial<Record<JobPostingFieldKey, SourceTier>>;
}

export interface AppPreferences {
  lastCoordinatorProvider?: ProviderId;
  lastReviewMode?: ReviewMode;
}

export interface RunRecord {
  id: string;
  projectSlug: string;
  projectQuestionIndex?: number;
  question: string;
  draft: string;
  reviewMode: ReviewMode;
  notionRequest?: string;
  notionBrief?: string;
  continuationFromRunId?: string;
  continuationNote?: string;
  roleAssignments?: RoleAssignment[];
  coordinatorProvider: ProviderId;
  reviewerProviders: ProviderId[];
  rounds: number;
  maxRoundsPerSection: number;
  selectedDocumentIds: string[];
  status: RunStatus;
  startedAt: string;
  lastResumedAt?: string;
  finishedAt?: string;
}

export interface ReviewTurn {
  providerId: ProviderId;
  participantId?: string;
  participantLabel?: string;
  role: RunActorRole;
  round: number;
  prompt: string;
  promptMetrics?: PromptMetrics;
  response: string;
  startedAt: string;
  finishedAt?: string;
  status: "completed" | "failed";
  error?: string;
}

export interface DiscussionLedger {
  currentFocus: string;
  miniDraft: string;
  rewriteDirection?: string;
  currentObjective?: string;
  mustKeep?: string[];
  mustResolve?: string[];
  availableEvidence?: string[];
  exitCriteria?: string[];
  nextOwner?: EssayRoleId;
  sectionDraft?: string;
  changeRationale?: string;
  acceptedDecisions: string[];
  openChallenges: string[];
  deferredChallenges: string[];
  targetSection: string;
  targetSectionKey?: string;
  tickets?: ChallengeTicket[];
  sectionOutcome?: SectionOutcome;
  updatedAtRound: number;
}

export interface RunLedgerEntry {
  participantId?: string;
  round?: number;
  messageId?: string;
  ledger: DiscussionLedger;
}

export interface PromptMetrics {
  promptKind: string;
  contextProfile: CompileContextProfile;
  promptChars: number;
  estimatedPromptTokens: number;
  contextChars: number;
  historyChars: number;
  notionBriefChars: number;
  discussionLedgerChars: number;
}

export interface RunEvent {
  timestamp: string;
  type:
    | "run-started"
    | "compiled-context"
    | "prompt-metrics"
    | "turn-started"
    | "provider-stdout"
    | "provider-stderr"
    | "chat-message-started"
    | "chat-message-delta"
    | "chat-message-completed"
    | "awaiting-user-input"
    | "user-input-received"
    | "turn-completed"
    | "turn-failed"
    | "discussion-ledger-updated"
    | "run-completed"
    | "run-aborted"
    | "run-failed";
  providerId?: ProviderId;
  participantId?: string;
  participantLabel?: string;
  round?: number;
  messageId?: string;
  speakerRole?: ReviewTurn["role"] | "system" | "user";
  recipient?: string;
  message?: string;
  discussionLedger?: DiscussionLedger;
  promptMetrics?: PromptMetrics;
}

export interface RunChatMessage {
  id: string;
  providerId?: ProviderId;
  participantId?: string;
  participantLabel?: string;
  speaker: string;
  speakerRole: ReviewTurn["role"] | "system" | "user";
  recipient?: string;
  round?: number;
  content: string;
  startedAt: string;
  finishedAt?: string;
  status: "streaming" | "completed";
}

export interface PromptExecutionOptions {
  cwd: string;
  authMode: AuthMode;
  apiKey?: string;
  modelOverride?: string;
  effortOverride?: string;
  onEvent?: (event: RunEvent) => Promise<void> | void;
  abortSignal?: AbortSignal;
  round?: number;
  speakerRole?: ReviewTurn["role"];
  messageScope?: string;
  participantId?: string;
  participantLabel?: string;
}

export class RunAbortedError extends Error {
  constructor(message = "Run aborted by user.") {
    super(message);
    this.name = "RunAbortedError";
  }
}

export class RunInterventionAbortError extends Error {
  constructor(readonly directive: string, message = "Run interrupted by user intervention.") {
    super(message);
    this.name = "RunInterventionAbortError";
  }
}

export function isRunAbortedError(error: unknown): error is RunAbortedError {
  return error instanceof RunAbortedError || (
    error instanceof Error
    && error.name === "RunAbortedError"
  );
}

export function isRunInterventionAbortError(error: unknown): error is RunInterventionAbortError {
  return error instanceof RunInterventionAbortError || (
    error instanceof Error
    && error.name === "RunInterventionAbortError"
  );
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export interface ProviderCommandResult {
  text: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProviderRuntimeState extends ProviderStatus {
  command: string;
  hasApiKey: boolean;
  hasNotionToken?: boolean;
  configuredModel?: string;
  configuredEffort?: string;
  capabilities: ProviderCapabilities;
  notionMcpConfigured?: boolean;
  notionMcpConnected?: boolean;
  notionMcpMessage?: string;
}

export interface RunArtifacts {
  summary: string;
  improvementPlan: string;
  revisedDraft: string;
  finalChecks?: string;
}

export interface RunRequest {
  projectSlug: string;
  existingRunId?: string;
  projectQuestionIndex?: number;
  question: string;
  draft: string;
  reviewMode: ReviewMode;
  notionRequest?: string;
  continuationFromRunId?: string;
  continuationNote?: string;
  roleAssignments?: RoleAssignment[];
  coordinatorProvider: ProviderId;
  reviewerProviders: ProviderId[];
  rounds: number;
  maxRoundsPerSection?: number;
  selectedDocumentIds: string[];
  charLimit?: number;
}

export interface ProjectEssayAnswerStateViewModel extends ProjectEssayAnswerState {
  content?: string;
}
