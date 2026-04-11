import { z } from "zod";
import {
  type EssayRoleId,
  authModes,
  essayRoleIds,
  essayQuestionStatuses,
  compileContextProfiles,
  extractionStatuses,
  insightStatuses,
  providerAuthStatuses,
  providerIds,
  reviewModes,
  runStatuses,
  sourceTypes
} from "./types";

const reviewRoles = ["reviewer", "coordinator", "researcher", "drafter", "finalizer"] as const;
const runEventTypes = [
  "run-started",
  "compiled-context",
  "prompt-metrics",
  "turn-started",
  "provider-stdout",
  "provider-stderr",
  "chat-message-started",
  "chat-message-delta",
  "chat-message-completed",
  "awaiting-user-input",
  "user-input-received",
  "turn-completed",
  "turn-failed",
  "discussion-ledger-updated",
  "run-completed",
  "run-aborted",
  "run-failed"
] as const;
const runChatSpeakerRoles = [...reviewRoles, "system", "user"] as const;

export const ProviderIdSchema = z.enum(providerIds);
export const AuthModeSchema = z.enum(authModes);
export const ProviderAuthStatusSchema = z.enum(providerAuthStatuses);
export const SourceTypeSchema = z.enum(sourceTypes);
export const ExtractionStatusSchema = z.enum(extractionStatuses);
export const RunStatusSchema = z.enum(runStatuses);
export const ReviewModeSchema = z.enum(reviewModes);
export const CompileContextProfileSchema = z.enum(compileContextProfiles);
export const InsightStatusSchema = z.enum(insightStatuses);
export const EssayRoleIdSchema = z.enum(essayRoleIds);
export const EssayQuestionStatusSchema = z.enum(essayQuestionStatuses);
export const ChallengeSeveritySchema = z.enum(["blocking", "advisory"] as const);
export const ChallengeStatusSchema = z.enum(["open", "deferred", "closed"] as const);
export const ChallengeSourceSchema = z.enum(["coordinator", "reviewer", "user", "system"] as const);
export const SectionOutcomeSchema = z.enum(["keep-open", "close-section", "handoff-next-section", "write-final", "deferred-close"] as const);
export const RoleAssignmentSchema = z.object({
  role: EssayRoleIdSchema,
  providerId: ProviderIdSchema,
  useProviderDefaults: z.boolean().default(true),
  modelOverride: z.string().optional(),
  effortOverride: z.string().optional()
});
export const RoleAssignmentsSchema = z.array(RoleAssignmentSchema);
export const AgentDefaultConfigSchema = z.object({
  providerId: ProviderIdSchema,
  useProviderDefaults: z.boolean().default(true),
  modelOverride: z.string().default(""),
  effortOverride: z.string().default("")
});
const agentDefaultsShape = Object.fromEntries(
  essayRoleIds.map((roleId) => [roleId, AgentDefaultConfigSchema.optional()])
) as Record<EssayRoleId, z.ZodOptional<typeof AgentDefaultConfigSchema>>;
export const AgentDefaultsSchema = z.object(agentDefaultsShape);
export const ChallengeTicketSchema = z.object({
  id: z.string(),
  text: z.string(),
  sectionKey: z.string(),
  sectionLabel: z.string(),
  severity: ChallengeSeveritySchema,
  status: ChallengeStatusSchema,
  source: ChallengeSourceSchema,
  introducedAtRound: z.number().int().min(0),
  lastUpdatedAtRound: z.number().int().min(0),
  handoffPriority: z.number().int(),
  evidenceNeeded: z.string().optional(),
  closeCondition: z.string().optional()
});
export const DiscussionLedgerSchema = z.object({
  currentFocus: z.string(),
  miniDraft: z.string(),
  rewriteDirection: z.string().optional(),
  currentObjective: z.string().optional(),
  mustKeep: z.array(z.string()).optional(),
  mustResolve: z.array(z.string()).optional(),
  availableEvidence: z.array(z.string()).optional(),
  exitCriteria: z.array(z.string()).optional(),
  nextOwner: EssayRoleIdSchema.optional(),
  sectionDraft: z.string().optional(),
  changeRationale: z.string().optional(),
  acceptedDecisions: z.array(z.string()),
  openChallenges: z.array(z.string()),
  deferredChallenges: z.array(z.string()),
  targetSection: z.string(),
  targetSectionKey: z.string().optional(),
  tickets: z.array(ChallengeTicketSchema).optional(),
  sectionOutcome: SectionOutcomeSchema.optional(),
  updatedAtRound: z.number().int().min(0)
});
export const RunLedgerEntrySchema = z.object({
  participantId: z.string().optional(),
  round: z.number().int().min(0).optional(),
  messageId: z.string().optional(),
  ledger: DiscussionLedgerSchema
});
export const PromptMetricsSchema = z.object({
  promptKind: z.string(),
  contextProfile: CompileContextProfileSchema,
  promptChars: z.number().int().min(0),
  estimatedPromptTokens: z.number().int().min(0),
  contextChars: z.number().int().min(0),
  historyChars: z.number().int().min(0),
  notionBriefChars: z.number().int().min(0),
  discussionLedgerChars: z.number().int().min(0)
});

export const ProviderStatusSchema = z.object({
  providerId: ProviderIdSchema,
  installed: z.boolean(),
  authMode: AuthModeSchema,
  authStatus: ProviderAuthStatusSchema,
  version: z.string().optional(),
  lastCheckAt: z.string().optional(),
  lastError: z.string().optional()
});

export const ProviderSettingOptionSchema = z.object({
  value: z.string(),
  label: z.string()
});

export const ProviderCapabilitiesSchema = z.object({
  modelOptions: z.array(ProviderSettingOptionSchema),
  effortOptions: z.array(ProviderSettingOptionSchema),
  supportsEffort: z.boolean()
});

export const ProviderRuntimeStateSchema = ProviderStatusSchema.extend({
  command: z.string(),
  hasApiKey: z.boolean(),
  configuredModel: z.string().optional(),
  configuredEffort: z.string().optional(),
  capabilities: ProviderCapabilitiesSchema,
  notionMcpConfigured: z.boolean().optional(),
  notionMcpConnected: z.boolean().optional(),
  notionMcpMessage: z.string().optional()
});

export const ContextDocumentSchema = z.object({
  id: z.string(),
  scope: z.enum(["profile", "project"]),
  projectSlug: z.string().optional(),
  title: z.string(),
  sourceType: SourceTypeSchema,
  rawPath: z.string(),
  normalizedPath: z.string().nullable().optional(),
  pinnedByDefault: z.boolean(),
  extractionStatus: ExtractionStatusSchema,
  note: z.string().nullable().optional(),
  createdAt: z.string()
});

export const ContextManifestSchema = z.object({
  documents: z.array(ContextDocumentSchema)
});

export const OpenDartCandidateSchema = z.object({
  corpCode: z.string(),
  corpName: z.string(),
  stockCode: z.string().optional()
});

export const ProjectEssayAnswerStateSchema = z.object({
  questionIndex: z.number().int().min(0),
  status: EssayQuestionStatusSchema,
  documentId: z.string().optional(),
  completedAt: z.string().optional(),
  lastRunId: z.string().optional()
});

export const ProjectRecordSchema = z.object({
  slug: z.string(),
  companyName: z.string(),
  roleName: z.string().optional(),
  deadline: z.string().optional(),
  overview: z.string().optional(),
  mainResponsibilities: z.string().optional(),
  qualifications: z.string().optional(),
  preferredQualifications: z.string().optional(),
  benefits: z.string().optional(),
  hiringProcess: z.string().optional(),
  insiderView: z.string().optional(),
  otherInfo: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  jobPostingUrl: z.string().optional(),
  jobPostingText: z.string().optional(),
  essayQuestions: z.array(z.string()).optional(),
  openDartCorpCode: z.string().optional(),
  openDartCorpName: z.string().optional(),
  openDartStockCode: z.string().optional(),
  openDartCandidates: z.array(OpenDartCandidateSchema).optional(),
  postingAnalyzedAt: z.string().optional(),
  jobPostingManualFallback: z.boolean().optional(),
  insightStatus: InsightStatusSchema.optional(),
  insightLastGeneratedAt: z.string().optional(),
  insightLastError: z.string().optional(),
  essayAnswerStates: z.array(ProjectEssayAnswerStateSchema).optional(),
  rubric: z.string(),
  pinnedDocumentIds: z.array(z.string()),
  charLimit: z.number().int().min(1).optional(),
  notionPageIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const AppPreferencesSchema = z.object({
  lastCoordinatorProvider: ProviderIdSchema.optional(),
  lastReviewMode: ReviewModeSchema.optional()
});

export const RunRecordSchema = z.object({
  id: z.string(),
  projectSlug: z.string(),
  projectQuestionIndex: z.number().int().min(0).optional(),
  question: z.string(),
  draft: z.string(),
  reviewMode: ReviewModeSchema.default("deepFeedback"),
  notionRequest: z.string().optional(),
  notionBrief: z.string().optional(),
  continuationFromRunId: z.string().optional(),
  continuationNote: z.string().optional(),
  roleAssignments: RoleAssignmentsSchema.optional(),
  coordinatorProvider: ProviderIdSchema,
  reviewerProviders: z.array(ProviderIdSchema),
  rounds: z.number().int().min(0),
  maxRoundsPerSection: z.number().int().min(1).max(10).default(1),
  selectedDocumentIds: z.array(z.string()),
  status: RunStatusSchema,
  startedAt: z.string(),
  lastResumedAt: z.string().optional(),
  finishedAt: z.string().optional()
});

export const ReviewTurnSchema = z.object({
  providerId: ProviderIdSchema,
  participantId: z.string().optional(),
  participantLabel: z.string().optional(),
  role: z.enum(reviewRoles),
  round: z.number().int().min(0),
  prompt: z.string(),
  promptMetrics: PromptMetricsSchema.optional(),
  response: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["completed", "failed"]),
  error: z.string().optional()
});

export const RunChatMessageSchema = z.object({
  id: z.string(),
  providerId: ProviderIdSchema.optional(),
  participantId: z.string().optional(),
  participantLabel: z.string().optional(),
  speaker: z.string(),
  speakerRole: z.enum(runChatSpeakerRoles),
  recipient: z.string().optional(),
  round: z.number().int().min(0).optional(),
  content: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["streaming", "completed"])
});

export const RunEventSchema = z.object({
  timestamp: z.string(),
  type: z.enum(runEventTypes),
  providerId: ProviderIdSchema.optional(),
  participantId: z.string().optional(),
  participantLabel: z.string().optional(),
  round: z.number().int().min(0).optional(),
  messageId: z.string().optional(),
  speakerRole: z.enum(runChatSpeakerRoles).optional(),
  recipient: z.string().optional(),
  message: z.string().optional(),
  discussionLedger: DiscussionLedgerSchema.optional(),
  promptMetrics: PromptMetricsSchema.optional()
});
