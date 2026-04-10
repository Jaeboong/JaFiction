import { z } from "zod";
import {
  AuthModeSchema,
  OpenDartCandidateSchema,
  ProviderIdSchema,
  ReviewModeSchema,
  RoleAssignmentsSchema,
  RunEventSchema
} from "./schemas";
import { RunSessionStateSchema, SidebarStateSchema } from "./viewModels";

export const UploadedFileSchema = z.object({
  fileName: z.string().min(1),
  contentBase64: z.string().min(1)
});

export type UploadedFile = z.infer<typeof UploadedFileSchema>;

export const ContinuationPresetSchema = z.object({
  projectSlug: z.string().min(1),
  runId: z.string().min(1),
  projectQuestionIndex: z.number().int().min(0).optional(),
  question: z.string(),
  draft: z.string(),
  reviewMode: ReviewModeSchema,
  notionRequest: z.string(),
  roleAssignments: RoleAssignmentsSchema.optional(),
  coordinatorProvider: ProviderIdSchema,
  reviewerProviders: z.array(ProviderIdSchema),
  maxRoundsPerSection: z.number().int().min(1).max(10).default(1),
  selectedDocumentIds: z.array(z.string())
});

export type ContinuationPreset = z.infer<typeof ContinuationPresetSchema>;

export const ProjectDocumentEditorPresetSchema = z.object({
  projectSlug: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string(),
  note: z.string(),
  pinnedByDefault: z.boolean(),
  sourceType: z.string(),
  content: z.string(),
  contentEditable: z.boolean()
});

export type ProjectDocumentEditorPreset = z.infer<typeof ProjectDocumentEditorPresetSchema>;

export const ProfileDocumentPreviewPayloadSchema = z.object({
  documentId: z.string().min(1),
  title: z.string(),
  note: z.string(),
  sourceType: z.string().min(1),
  extractionStatus: z.string().min(1),
  rawPath: z.string().min(1),
  normalizedPath: z.string(),
  previewSource: z.enum(["normalized", "raw", "none"]),
  content: z.string()
});

export type ProfileDocumentPreviewPayload = z.infer<typeof ProfileDocumentPreviewPayloadSchema>;

export const BannerPayloadSchema = z.object({
  kind: z.enum(["info", "error"]).default("info"),
  message: z.string().min(1)
});

export type BannerPayload = z.infer<typeof BannerPayloadSchema>;

const ProjectInsightFieldsSchema = z.object({
  roleName: z.string().optional(),
  mainResponsibilities: z.string().optional(),
  qualifications: z.string().optional(),
  preferredQualifications: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  jobPostingUrl: z.string().optional(),
  jobPostingText: z.string().optional(),
  essayQuestions: z.array(z.string()).optional(),
  openDartCorpCode: z.string().optional()
});

const WebviewClientSourceSchema = z.enum(["sidebar", "insightWorkspace"]);

export const WebviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("refresh") }),
  z.object({ type: z.literal("testProvider"), providerId: ProviderIdSchema }),
  z.object({ type: z.literal("setAuthMode"), providerId: ProviderIdSchema, authMode: AuthModeSchema }),
  z.object({ type: z.literal("setProviderModel"), providerId: ProviderIdSchema, model: z.string() }),
  z.object({ type: z.literal("setProviderEffort"), providerId: ProviderIdSchema, effort: z.string() }),
  z.object({ type: z.literal("saveApiKey"), providerId: ProviderIdSchema, apiKey: z.string() }),
  z.object({ type: z.literal("clearApiKey"), providerId: ProviderIdSchema }),
  z.object({ type: z.literal("checkNotionMcp"), providerId: ProviderIdSchema }),
  z.object({ type: z.literal("connectNotionMcp"), providerId: ProviderIdSchema }),
  z.object({ type: z.literal("disconnectNotionMcp"), providerId: ProviderIdSchema }),
  z.object({ type: z.literal("pickProfileFiles") }),
  z.object({ type: z.literal("pickProjectFiles"), projectSlug: z.string().min(1) }),
  z.object({ type: z.literal("uploadProfileFiles"), files: z.array(UploadedFileSchema) }),
  z.object({ type: z.literal("uploadProjectFiles"), projectSlug: z.string().min(1), files: z.array(UploadedFileSchema) }),
  z.object({
    type: z.literal("saveProfileText"),
    title: z.string(),
    content: z.string(),
    note: z.string().optional(),
    pinnedByDefault: z.boolean().optional()
  }),
  z.object({
    type: z.literal("createProject"),
    companyName: z.string(),
    roleName: z.string().optional(),
    mainResponsibilities: z.string().optional(),
    qualifications: z.string().optional(),
    preferredQualifications: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    jobPostingUrl: z.string().optional(),
    jobPostingText: z.string().optional(),
    essayQuestions: z.array(z.string()).optional(),
    openDartCorpCode: z.string().optional()
  }),
  z.object({
    type: z.literal("updateProjectInfo"),
    projectSlug: z.string().min(1),
    companyName: z.string(),
    roleName: z.string().optional(),
    mainResponsibilities: z.string().optional(),
    qualifications: z.string().optional(),
    preferredQualifications: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    jobPostingUrl: z.string().optional(),
    jobPostingText: z.string().optional(),
    essayQuestions: z.array(z.string()).optional(),
    openDartCorpCode: z.string().optional()
  }),
  z.object({ type: z.literal("saveOpenDartApiKey"), apiKey: z.string() }),
  z.object({ type: z.literal("clearOpenDartApiKey") }),
  z.object({ type: z.literal("testOpenDartConnection") }),
  z.object({
    type: z.literal("analyzeProjectInsights"),
    projectSlug: z.string().min(1),
    companyName: z.string(),
    ...ProjectInsightFieldsSchema.shape
  }),
  z.object({
    type: z.literal("generateProjectInsights"),
    projectSlug: z.string().min(1),
    companyName: z.string(),
    ...ProjectInsightFieldsSchema.shape
  }),
  z.object({
    type: z.literal("webviewClientError"),
    source: WebviewClientSourceSchema,
    message: z.string().min(1),
    stack: z.string().optional(),
    href: z.string().optional(),
    phase: z.string().optional()
  }),
  z.object({ type: z.literal("openInsightWorkspace"), projectSlug: z.string().min(1) }),
  z.object({ type: z.literal("deleteProject"), projectSlug: z.string().min(1) }),
  z.object({
    type: z.literal("saveProjectText"),
    projectSlug: z.string().min(1),
    title: z.string(),
    content: z.string(),
    note: z.string().optional(),
    pinnedByDefault: z.boolean().optional()
  }),
  z.object({
    type: z.literal("loadProjectDocumentEditor"),
    projectSlug: z.string().min(1),
    documentId: z.string().min(1)
  }),
  z.object({
    type: z.literal("updateProjectDocument"),
    projectSlug: z.string().min(1),
    documentId: z.string().min(1),
    title: z.string(),
    note: z.string().optional(),
    pinnedByDefault: z.boolean(),
    content: z.string().optional()
  }),
  z.object({
    type: z.literal("deleteProjectDocument"),
    projectSlug: z.string().min(1),
    documentId: z.string().min(1)
  }),
  z.object({
    type: z.literal("saveProjectRubric"),
    projectSlug: z.string().min(1),
    rubric: z.string()
  }),
  z.object({
    type: z.literal("toggleProfilePinned"),
    documentId: z.string().min(1),
    pinned: z.boolean()
  }),
  z.object({
    type: z.literal("openProfileDocumentPreview"),
    documentId: z.string().min(1)
  }),
  z.object({
    type: z.literal("toggleProjectPinned"),
    projectSlug: z.string().min(1),
    documentId: z.string().min(1),
    pinned: z.boolean()
  }),
  z.object({
    type: z.literal("runReview"),
    projectSlug: z.string().min(1),
    projectQuestionIndex: z.number().int().min(0).optional(),
    question: z.string(),
    draft: z.string(),
    reviewMode: ReviewModeSchema,
    notionRequest: z.string().optional(),
    continuationFromRunId: z.string().optional(),
    continuationNote: z.string().optional(),
    roleAssignments: RoleAssignmentsSchema.optional(),
    coordinatorProvider: ProviderIdSchema,
    reviewerProviders: z.array(ProviderIdSchema),
    rounds: z.number().int().min(1),
    maxRoundsPerSection: z.number().int().min(1).max(10).default(1),
    selectedDocumentIds: z.array(z.string()),
    charLimit: z.number().int().min(1).optional()
  }),
  z.object({
    type: z.literal("completeEssayQuestion"),
    projectSlug: z.string().min(1),
    questionIndex: z.number().int().min(0),
    question: z.string(),
    answer: z.string(),
    runId: z.string().optional()
  }),
  z.object({
    type: z.literal("submitRoundIntervention"),
    message: z.string().optional()
  }),
  z.object({
    type: z.literal("openArtifact"),
    projectSlug: z.string().min(1),
    runId: z.string().min(1),
    fileName: z.string().min(1)
  }),
  z.object({
    type: z.literal("loadRunContinuation"),
    projectSlug: z.string().min(1),
    runId: z.string().min(1)
  }),
  z.object({
    type: z.literal("continueRunDiscussion"),
    projectSlug: z.string().min(1),
    runId: z.string().min(1),
    message: z.string().optional()
  }),
  z.object({ type: z.literal("openStorageRoot") })
]);

export type WebviewToExtensionMessage = z.infer<typeof WebviewToExtensionMessageSchema>;

export const ExtensionToWebviewMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), payload: SidebarStateSchema }),
  z.object({
    type: z.literal("openDartCandidates"),
    payload: z.object({
      projectSlug: z.string().min(1),
      candidates: z.array(OpenDartCandidateSchema)
    })
  }),
  z.object({ type: z.literal("continuationPreset"), payload: ContinuationPresetSchema }),
  z.object({ type: z.literal("runEvent"), payload: RunEventSchema }),
  z.object({ type: z.literal("banner"), payload: BannerPayloadSchema }),
  z.object({ type: z.literal("projectDocumentEditorPreset"), payload: ProjectDocumentEditorPresetSchema }),
  z.object({ type: z.literal("profileDocumentPreview"), payload: ProfileDocumentPreviewPayloadSchema }),
  z.object({ type: z.literal("runState"), payload: RunSessionStateSchema })
]);

export type ExtensionToWebviewMessage = z.infer<typeof ExtensionToWebviewMessageSchema>;
