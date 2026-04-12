import { z } from "zod";
import {
  ProviderIdSchema,
  ReviewModeSchema,
  RunEventSchema,
  RoleAssignmentsSchema,
  ProviderRuntimeStateSchema,
  ContextDocumentSchema,
  RunRecordSchema,
  RunChatMessageSchema,
  RunLedgerEntrySchema,
  AgentDefaultsSchema
} from "./schemas";
import { SidebarStateSchema } from "./viewModels";

// SidebarState and RunEvent types are already exported from viewModels.ts and schemas.ts
// respectively. We import them here for use in this file only.
export type { SidebarState } from "./viewModels";
export type { RunEvent } from "./types";

// ---------------------------------------------------------------------------
// Shared error schema
// ---------------------------------------------------------------------------
export const RpcErrorSchema = z.object({
  code: z.string(),
  message: z.string()
}).strict();

export type RpcError = z.infer<typeof RpcErrorSchema>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
export function assertNever(x: never): never {
  throw new Error(`assertNever: unexpected value ${String(x)}`);
}

// ---------------------------------------------------------------------------
// ProjectSummary / ProjectDetail — mirrors ProjectRecord exactly
// ---------------------------------------------------------------------------
const ProjectDetailSchema = z.object({
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
  rubric: z.string(),
  pinnedDocumentIds: z.array(z.string()),
  charLimit: z.number().int().min(1).optional(),
  notionPageIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict();

const ProjectSummarySchema = ProjectDetailSchema;

const RunSummarySchema = RunRecordSchema;

// WorkspaceFileEntry for file RPC
const WorkspaceFileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  isDirectory: z.boolean(),
  sizeBytes: z.number().int().min(0).optional()
}).strict();

// ProjectPatch: partial update for save_project.
// Only fields that updateProjectInfo() already persists are accepted here.
// rubric, pinnedDocumentIds, charLimit, notionPageIds are intentionally excluded —
// TODO: add dedicated ops (save_project_rubric, save_project_char_limit, etc.) in a
// later phase when the web UI needs them. Using .strict() so callers receive a clear
// bad_request instead of a silent no-op for unsupported fields.
const ProjectPatchSchema = z.object({
  companyName: z.string().optional(),
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
  openDartCorpCode: z.string().optional()
}).strict();

// ProviderConfig for save_provider_config
const ProviderConfigSchema = z.object({
  authMode: z.enum(["cli", "apiKey"]).optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  command: z.string().optional()
}).strict();

// ---------------------------------------------------------------------------
// Op payload + result schemas — one pair per op
// ---------------------------------------------------------------------------

// get_state
export const GetStatePayloadSchema = z.object({}).strict();
export const GetStateResultSchema = SidebarStateSchema;
export type GetStatePayload = z.infer<typeof GetStatePayloadSchema>;
export type GetStateResult = z.infer<typeof GetStateResultSchema>;

// list_projects
export const ListProjectsPayloadSchema = z.object({}).strict();
export const ListProjectsResultSchema = z.object({
  projects: z.array(ProjectSummarySchema)
}).strict();
export type ListProjectsPayload = z.infer<typeof ListProjectsPayloadSchema>;
export type ListProjectsResult = z.infer<typeof ListProjectsResultSchema>;

// get_project
export const GetProjectPayloadSchema = z.object({
  slug: z.string()
}).strict();
export const GetProjectResultSchema = ProjectDetailSchema;
export type GetProjectPayload = z.infer<typeof GetProjectPayloadSchema>;
export type GetProjectResult = z.infer<typeof GetProjectResultSchema>;

// save_project
export const SaveProjectPayloadSchema = z.object({
  slug: z.string(),
  patch: ProjectPatchSchema
}).strict();
export const SaveProjectResultSchema = ProjectDetailSchema;
export type SaveProjectPayload = z.infer<typeof SaveProjectPayloadSchema>;
export type SaveProjectResult = z.infer<typeof SaveProjectResultSchema>;

// upload_document — base64 encoded file content
export const UploadDocumentPayloadSchema = z.object({
  slug: z.string(),
  filename: z.string(),
  contentBase64: z.string()
}).strict();
export const UploadDocumentResultSchema = z.object({
  docId: z.string()
}).strict();
export type UploadDocumentPayload = z.infer<typeof UploadDocumentPayloadSchema>;
export type UploadDocumentResult = z.infer<typeof UploadDocumentResultSchema>;

// delete_document
export const DeleteDocumentPayloadSchema = z.object({
  slug: z.string(),
  docId: z.string()
}).strict();
export const DeleteDocumentResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type DeleteDocumentPayload = z.infer<typeof DeleteDocumentPayloadSchema>;
export type DeleteDocumentResult = z.infer<typeof DeleteDocumentResultSchema>;

// list_runs
export const ListRunsPayloadSchema = z.object({
  slug: z.string()
}).strict();
export const ListRunsResultSchema = z.object({
  runs: z.array(RunSummarySchema)
}).strict();
export type ListRunsPayload = z.infer<typeof ListRunsPayloadSchema>;
export type ListRunsResult = z.infer<typeof ListRunsResultSchema>;

// get_run_messages — mirrors runsRouter GET /:runId/messages
export const GetRunMessagesPayloadSchema = z.object({
  runId: z.string(),
  cursor: z.string().optional()
}).strict();
export const GetRunMessagesResultSchema = z.object({
  messages: z.array(RunChatMessageSchema),
  ledgers: z.array(RunLedgerEntrySchema),
  nextCursor: z.string().optional()
}).strict();
export type GetRunMessagesPayload = z.infer<typeof GetRunMessagesPayloadSchema>;
export type GetRunMessagesResult = z.infer<typeof GetRunMessagesResultSchema>;

// start_run — mirrors runsRouter POST / body fields
export const StartRunPayloadSchema = z.object({
  slug: z.string(),
  question: z.string(),
  draft: z.string(),
  reviewMode: ReviewModeSchema,
  projectQuestionIndex: z.number().int().min(0).optional(),
  notionRequest: z.string().optional(),
  continuationFromRunId: z.string().optional(),
  continuationNote: z.string().optional(),
  roleAssignments: RoleAssignmentsSchema.optional(),
  coordinatorProvider: ProviderIdSchema,
  reviewerProviders: z.array(ProviderIdSchema),
  rounds: z.number().int().min(1),
  maxRoundsPerSection: z.number().int().min(1).max(10).optional(),
  selectedDocumentIds: z.array(z.string()),
  charLimit: z.number().int().min(1).optional()
}).strict();
export const StartRunResultSchema = z.object({
  runId: z.string()
}).strict();
export type StartRunPayload = z.infer<typeof StartRunPayloadSchema>;
export type StartRunResult = z.infer<typeof StartRunResultSchema>;

// resume_run — mirrors runsRouter POST /:runId/resume
// Stage 11.4 breaking schema expansion (plan Decisions #2): result now carries
// `runId` (the new/resumed run) and `resumedFromRunId` (the prior run). In the
// current runner implementation the two are equal because resume reuses the
// existing runId slot, but downstream callers treat them as independent fields
// to allow a future split. Both required — strict schema by design so an old
// runner cannot silently drop a missing field.
export const ResumeRunPayloadSchema = z.object({
  runId: z.string(),
  message: z.string().optional()
}).strict();
export const ResumeRunResultSchema = z.object({
  runId: z.string(),
  resumedFromRunId: z.string()
}).strict();
export type ResumeRunPayload = z.infer<typeof ResumeRunPayloadSchema>;
export type ResumeRunResult = z.infer<typeof ResumeRunResultSchema>;

// abort_run — mirrors createRunInterventionRouter POST /:runId/abort
export const AbortRunPayloadSchema = z.object({
  runId: z.string(),
  reason: z.string().optional()
}).strict();
export const AbortRunResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type AbortRunPayload = z.infer<typeof AbortRunPayloadSchema>;
export type AbortRunResult = z.infer<typeof AbortRunResultSchema>;

// complete_run — mirrors runsRouter POST /:runId/complete
export const CompleteRunPayloadSchema = z.object({
  runId: z.string()
}).strict();
export const CompleteRunResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type CompleteRunPayload = z.infer<typeof CompleteRunPayloadSchema>;
export type CompleteRunResult = z.infer<typeof CompleteRunResultSchema>;

// submit_intervention — mirrors createRunInterventionRouter POST /:runId/intervention
// Stage 11.4 breaking schema expansion (plan Decisions #2): result now carries
// the RunSessionManager outcome (mirrors the local REST shape returned by
// createRunInterventionRouter) plus the target runId and optional nextRunId for
// the "continuation" path. `outcome` union is sourced directly from
// RunSessionManager.submitIntervention's return type.
export const SubmitInterventionPayloadSchema = z.object({
  runId: z.string(),
  text: z.string()
}).strict();
export const SubmitInterventionOutcomeSchema = z.enum(["queued", "resumed", "continuation"]);
export const SubmitInterventionResultSchema = z.object({
  outcome: SubmitInterventionOutcomeSchema,
  runId: z.string(),
  nextRunId: z.string().optional()
}).strict();
export type SubmitInterventionPayload = z.infer<typeof SubmitInterventionPayloadSchema>;
export type SubmitInterventionResult = z.infer<typeof SubmitInterventionResultSchema>;
export type SubmitInterventionOutcome = z.infer<typeof SubmitInterventionOutcomeSchema>;

// call_provider_test — mirrors providersRouter POST /:providerId/test
export const CallProviderTestPayloadSchema = z.object({
  provider: ProviderIdSchema
}).strict();
export const CallProviderTestResultSchema = z.object({
  ok: z.boolean(),
  stdoutExcerpt: z.string().optional(),
  runtimeState: ProviderRuntimeStateSchema.optional()
}).strict();
export type CallProviderTestPayload = z.infer<typeof CallProviderTestPayloadSchema>;
export type CallProviderTestResult = z.infer<typeof CallProviderTestResultSchema>;

// save_provider_config — mirrors providersRouter PUT /:providerId/config
export const SaveProviderConfigPayloadSchema = z.object({
  provider: ProviderIdSchema,
  config: ProviderConfigSchema
}).strict();
export const SaveProviderConfigResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type SaveProviderConfigPayload = z.infer<typeof SaveProviderConfigPayloadSchema>;
export type SaveProviderConfigResult = z.infer<typeof SaveProviderConfigResultSchema>;

// save_provider_api_key — mirrors providersRouter POST /:providerId/apikey
export const SaveProviderApiKeyPayloadSchema = z.object({
  provider: ProviderIdSchema,
  key: z.string().min(1)
}).strict();
export const SaveProviderApiKeyResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type SaveProviderApiKeyPayload = z.infer<typeof SaveProviderApiKeyPayloadSchema>;
export type SaveProviderApiKeyResult = z.infer<typeof SaveProviderApiKeyResultSchema>;

// notion_connect — mirrors providersRouter POST /:providerId/notion/connect
// Hosted-mode inputs: token is the Notion integration secret, dbId is
// reserved for future per-database scoping and is optional today (the
// runner ignores dbId for now and always connects the claude MCP surface).
// Making dbId optional keeps the existing token-only UX working without
// blocking future expansion.
export const NotionConnectPayloadSchema = z.object({
  provider: ProviderIdSchema.optional(),
  token: z.string().min(1).optional(),
  dbId: z.string().min(1).optional()
}).strict();
export const NotionConnectResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type NotionConnectPayload = z.infer<typeof NotionConnectPayloadSchema>;
export type NotionConnectResult = z.infer<typeof NotionConnectResultSchema>;

// notion_disconnect — mirrors providersRouter POST /:providerId/notion/disconnect
export const NotionDisconnectPayloadSchema = z.object({
  provider: ProviderIdSchema.optional()
}).strict();
export const NotionDisconnectResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type NotionDisconnectPayload = z.infer<typeof NotionDisconnectPayloadSchema>;
export type NotionDisconnectResult = z.infer<typeof NotionDisconnectResultSchema>;

// opendart_save_key — mirrors openDartRouter POST /apikey
export const OpendartSaveKeyPayloadSchema = z.object({
  key: z.string().min(1)
}).strict();
export const OpendartSaveKeyResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type OpendartSaveKeyPayload = z.infer<typeof OpendartSaveKeyPayloadSchema>;
export type OpendartSaveKeyResult = z.infer<typeof OpendartSaveKeyResultSchema>;

// opendart_test — mirrors openDartRouter POST /test
// Existing route takes no body; plan adds corpName for a named lookup.
export const OpendartTestPayloadSchema = z.object({
  corpName: z.string().optional()
}).strict();
export const OpendartTestResultSchema = z.object({
  ok: z.boolean(),
  sample: z.string().optional()
}).strict();
export type OpendartTestPayload = z.infer<typeof OpendartTestPayloadSchema>;
export type OpendartTestResult = z.infer<typeof OpendartTestResultSchema>;

// read_file — new file RPC (root-jail enforced in Phase 8)
export const ReadFilePayloadSchema = z.object({
  path: z.string()
}).strict();
export const ReadFileResultSchema = z.object({
  contentBase64: z.string()
}).strict();
export type ReadFilePayload = z.infer<typeof ReadFilePayloadSchema>;
export type ReadFileResult = z.infer<typeof ReadFileResultSchema>;

// write_file — new file RPC (root-jail enforced in Phase 8)
export const WriteFilePayloadSchema = z.object({
  path: z.string(),
  contentBase64: z.string()
}).strict();
export const WriteFileResultSchema = z.object({
  ok: z.literal(true),
  bytes: z.number().int().min(0)
}).strict();
export type WriteFilePayload = z.infer<typeof WriteFilePayloadSchema>;
export type WriteFileResult = z.infer<typeof WriteFileResultSchema>;

// ---------------------------------------------------------------------------
// Stage 11.2 ops — project CRUD + insights parity
// ---------------------------------------------------------------------------

// create_project — mirrors projectsRouter POST /
// Accepts the same field set as updateProject (plus companyName is required),
// but all fields are optional here because the storage layer derives defaults.
// buildProjectInput-style wide-but-strict shape.
const ProjectCreateInputSchema = z.object({
  companyName: z.string().min(1),
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
  openDartCorpCode: z.string().optional()
}).strict();

export const CreateProjectPayloadSchema = ProjectCreateInputSchema;
export const CreateProjectResultSchema = ProjectDetailSchema;
export type CreateProjectPayload = z.infer<typeof CreateProjectPayloadSchema>;
export type CreateProjectResult = z.infer<typeof CreateProjectResultSchema>;

// delete_project — mirrors projectsRouter DELETE /:projectSlug
export const DeleteProjectPayloadSchema = z.object({
  slug: z.string()
}).strict();
export const DeleteProjectResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type DeleteProjectPayload = z.infer<typeof DeleteProjectPayloadSchema>;
export type DeleteProjectResult = z.infer<typeof DeleteProjectResultSchema>;

// save_document — text-content document create/update (mirrors projectsRouter
// POST /:projectSlug/documents). Distinct from upload_document (binary) and
// upload_document_chunk (streamed binary).
export const SaveDocumentPayloadSchema = z.object({
  slug: z.string(),
  title: z.string().min(1),
  content: z.string(),
  note: z.string().optional(),
  pinnedByDefault: z.boolean().optional()
}).strict();
export const SaveDocumentResultSchema = z.object({
  docId: z.string()
}).strict();
export type SaveDocumentPayload = z.infer<typeof SaveDocumentPayloadSchema>;
export type SaveDocumentResult = z.infer<typeof SaveDocumentResultSchema>;

// save_essay_draft — mirrors PUT /:projectSlug/essay-draft/:questionIndex
export const SaveEssayDraftPayloadSchema = z.object({
  slug: z.string(),
  questionIndex: z.number().int().min(0),
  draft: z.string()
}).strict();
export const SaveEssayDraftResultSchema = z.object({
  questionIndex: z.number().int().min(0)
}).strict();
export type SaveEssayDraftPayload = z.infer<typeof SaveEssayDraftPayloadSchema>;
export type SaveEssayDraftResult = z.infer<typeof SaveEssayDraftResultSchema>;

// analyze_posting — mirrors projectsRouter POST /analyze-posting
// Returns immediately with the extracted fields (non-LLM; plain HTTP fetch).
const JobPostingExtractionResultSchema = z.object({
  source: z.enum(["url", "manual"]),
  fetchedAt: z.string(),
  fetchedUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  normalizedText: z.string(),
  companyName: z.string().optional(),
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
  keywords: z.array(z.string()),
  warnings: z.array(z.string())
}).strict();

export const AnalyzePostingPayloadSchema = z.object({
  jobPostingUrl: z.string().optional(),
  jobPostingText: z.string().optional(),
  companyName: z.string().optional(),
  roleName: z.string().optional()
}).strict();
export const AnalyzePostingResultSchema = JobPostingExtractionResultSchema;
export type AnalyzePostingPayload = z.infer<typeof AnalyzePostingPayloadSchema>;
export type AnalyzePostingResult = z.infer<typeof AnalyzePostingResultSchema>;

// get_project_insights — mirrors insightsRouter GET /
const ProjectInsightDocumentViewSchema = z.object({
  key: z.enum(["company", "job", "strategy", "question"]),
  tabLabel: z.string(),
  title: z.string(),
  fileName: z.string(),
  content: z.string(),
  available: z.boolean()
}).strict();

const ProjectInsightWorkspaceStateSchema = z.object({
  projectSlug: z.string(),
  companyName: z.string(),
  roleName: z.string().optional(),
  jobPostingUrl: z.string().optional(),
  postingAnalyzedAt: z.string().optional(),
  insightLastGeneratedAt: z.string().optional(),
  openDartCorpName: z.string().optional(),
  openDartStockCode: z.string().optional(),
  // companySourceManifest is a deeply nested runtime type — pass through as-is
  // rather than re-declaring the entire schema here.
  companySourceManifest: z.unknown().optional(),
  documents: z.array(ProjectInsightDocumentViewSchema)
}).strict();

export const GetProjectInsightsPayloadSchema = z.object({
  slug: z.string()
}).strict();
export const GetProjectInsightsResultSchema = ProjectInsightWorkspaceStateSchema;
export type GetProjectInsightsPayload = z.infer<typeof GetProjectInsightsPayloadSchema>;
export type GetProjectInsightsResult = z.infer<typeof GetProjectInsightsResultSchema>;

// analyze_insights — LLM kickoff pattern.
// Returns immediately with a jobId. The runner runs the analysis in the
// background and broadcasts a state_snapshot event when it finishes.
const ProjectPatchForInsightSchema = ProjectPatchSchema;

export const AnalyzeInsightsPayloadSchema = z.object({
  slug: z.string(),
  patch: ProjectPatchForInsightSchema.optional()
}).strict();
export const AnalyzeInsightsResultSchema = z.object({
  jobId: z.string()
}).strict();
export type AnalyzeInsightsPayload = z.infer<typeof AnalyzeInsightsPayloadSchema>;
export type AnalyzeInsightsResult = z.infer<typeof AnalyzeInsightsResultSchema>;

// generate_insights — LLM kickoff pattern. Same shape as analyze_insights.
export const GenerateInsightsPayloadSchema = z.object({
  slug: z.string(),
  patch: ProjectPatchForInsightSchema.optional()
}).strict();
export const GenerateInsightsResultSchema = z.object({
  jobId: z.string()
}).strict();
export type GenerateInsightsPayload = z.infer<typeof GenerateInsightsPayloadSchema>;
export type GenerateInsightsResult = z.infer<typeof GenerateInsightsResultSchema>;

// upload_document_chunk — streamed binary upload.
// Client slices File into 1MB base64 chunks and sends each chunk as its own
// RPC. The runner reassembles in memory under (uploadId) and, on the final
// chunk, commits to storage and returns {docId}. Hash is sha256 over raw
// bytes of the full file, hex-encoded. Out-of-order chunks are rejected
// (chunkIndex must equal the next expected index).
export const UploadDocumentChunkPayloadSchema = z.object({
  slug: z.string(),
  uploadId: z.string().min(1),
  filename: z.string(),
  chunkIndex: z.number().int().min(0),
  totalChunks: z.number().int().min(1),
  totalBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  chunkBase64: z.string()
}).strict();
export const UploadDocumentChunkResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    uploadId: z.string(),
    nextChunkIndex: z.number().int().min(0)
  }).strict(),
  z.object({
    status: z.literal("complete"),
    uploadId: z.string(),
    docId: z.string()
  }).strict()
]);
export type UploadDocumentChunkPayload = z.infer<typeof UploadDocumentChunkPayloadSchema>;
export type UploadDocumentChunkResult = z.infer<typeof UploadDocumentChunkResultSchema>;

// get_agent_defaults — read-only mirror of configRouter GET /agent-defaults
export const GetAgentDefaultsPayloadSchema = z.object({}).strict();
export const GetAgentDefaultsResultSchema = z.object({
  agentDefaults: AgentDefaultsSchema
}).strict();
export type GetAgentDefaultsPayload = z.infer<typeof GetAgentDefaultsPayloadSchema>;
export type GetAgentDefaultsResult = z.infer<typeof GetAgentDefaultsResultSchema>;

// ---------------------------------------------------------------------------
// Stage 11.3 ops — provider / settings parity
// ---------------------------------------------------------------------------

// clear_provider_api_key — mirrors providersRouter DELETE /:providerId/apikey
export const ClearProviderApiKeyPayloadSchema = z.object({
  provider: ProviderIdSchema
}).strict();
export const ClearProviderApiKeyResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type ClearProviderApiKeyPayload = z.infer<typeof ClearProviderApiKeyPayloadSchema>;
export type ClearProviderApiKeyResult = z.infer<typeof ClearProviderApiKeyResultSchema>;

// notion_check — mirrors providersRouter GET /:providerId/notion
export const NotionCheckPayloadSchema = z.object({
  provider: ProviderIdSchema
}).strict();
export const NotionCheckResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type NotionCheckPayload = z.infer<typeof NotionCheckPayloadSchema>;
export type NotionCheckResult = z.infer<typeof NotionCheckResultSchema>;

// opendart_delete_key — mirrors openDartRouter DELETE /apikey
export const OpendartDeleteKeyPayloadSchema = z.object({}).strict();
export const OpendartDeleteKeyResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type OpendartDeleteKeyPayload = z.infer<typeof OpendartDeleteKeyPayloadSchema>;
export type OpendartDeleteKeyResult = z.infer<typeof OpendartDeleteKeyResultSchema>;

// save_agent_defaults — mirrors configRouter PUT /agent-defaults
// Deferred from Stage 11.1 — lives here because 11.3 owns the Settings plane.
export const SaveAgentDefaultsPayloadSchema = z.object({
  agentDefaults: AgentDefaultsSchema
}).strict();
export const SaveAgentDefaultsResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type SaveAgentDefaultsPayload = z.infer<typeof SaveAgentDefaultsPayloadSchema>;
export type SaveAgentDefaultsResult = z.infer<typeof SaveAgentDefaultsResultSchema>;

// list_workspace_files — new file RPC (root-jail enforced in Phase 8)
export const ListWorkspaceFilesPayloadSchema = z.object({
  subdir: z.string().optional()
}).strict();
export const ListWorkspaceFilesResultSchema = z.object({
  entries: z.array(WorkspaceFileEntrySchema)
}).strict();
export type ListWorkspaceFilesPayload = z.infer<typeof ListWorkspaceFilesPayloadSchema>;
export type ListWorkspaceFilesResult = z.infer<typeof ListWorkspaceFilesResultSchema>;

// ---------------------------------------------------------------------------
// Stage 11.4 ops — run lifecycle parity
// ---------------------------------------------------------------------------

// delete_run — mirrors projectsRouter DELETE /:projectSlug/runs/:runId
// New op (no prior REST/RPC equivalent on the hosted path). The runner handler
// scopes the delete by slug+runId against ctx.storage() which is already a
// per-user store via the device routing layer, so there is no cross-user path.
export const DeleteRunPayloadSchema = z.object({
  slug: z.string(),
  runId: z.string()
}).strict();
export const DeleteRunResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type DeleteRunPayload = z.infer<typeof DeleteRunPayloadSchema>;
export type DeleteRunResult = z.infer<typeof DeleteRunResultSchema>;

// ---------------------------------------------------------------------------
// Stage 11.8 — profile document hosted parity
//
// Mirrors the deleted packages/runner/src/routes/profileRouter.ts. The runner
// previously exposed five REST endpoints for profile documents; we restore
// each as a typed RPC op so hosted web can create/upload/edit/pin/preview.
// ---------------------------------------------------------------------------

// profile_list_documents
export const ProfileListDocumentsPayloadSchema = z.object({}).strict();
export const ProfileListDocumentsResultSchema = z.object({
  documents: z.array(ContextDocumentSchema)
}).strict();
export type ProfileListDocumentsPayload = z.infer<typeof ProfileListDocumentsPayloadSchema>;
export type ProfileListDocumentsResult = z.infer<typeof ProfileListDocumentsResultSchema>;

// profile_save_text_document
export const ProfileSaveTextDocumentPayloadSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string(),
  note: z.string().optional(),
  pinnedByDefault: z.boolean().optional()
}).strict();
export const ProfileSaveTextDocumentResultSchema = z.object({
  document: ContextDocumentSchema
}).strict();
export type ProfileSaveTextDocumentPayload = z.infer<typeof ProfileSaveTextDocumentPayloadSchema>;
export type ProfileSaveTextDocumentResult = z.infer<typeof ProfileSaveTextDocumentResultSchema>;

// profile_upload_document_chunk — mirrors upload_document_chunk but scoped to
// the profile manifest instead of a project slug. Reuses the same 1MB chunk
// size + 100MB total cap constants defined above.
export const ProfileUploadDocumentChunkPayloadSchema = z.object({
  uploadId: z.string().min(1),
  fileName: z.string().min(1),
  chunkIndex: z.number().int().min(0),
  totalChunks: z.number().int().min(1),
  totalBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  chunkBase64: z.string(),
  pinnedByDefault: z.boolean().optional(),
  note: z.string().optional()
}).strict();
export const ProfileUploadDocumentChunkResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    uploadId: z.string(),
    nextChunkIndex: z.number().int().min(0)
  }).strict(),
  z.object({
    status: z.literal("completed"),
    uploadId: z.string(),
    document: ContextDocumentSchema
  }).strict()
]);
export type ProfileUploadDocumentChunkPayload = z.infer<typeof ProfileUploadDocumentChunkPayloadSchema>;
export type ProfileUploadDocumentChunkResult = z.infer<typeof ProfileUploadDocumentChunkResultSchema>;

// profile_set_document_pinned
export const ProfileSetDocumentPinnedPayloadSchema = z.object({
  documentId: z.string().min(1),
  pinned: z.boolean()
}).strict();
export const ProfileSetDocumentPinnedResultSchema = z.object({
  document: ContextDocumentSchema
}).strict();
export type ProfileSetDocumentPinnedPayload = z.infer<typeof ProfileSetDocumentPinnedPayloadSchema>;
export type ProfileSetDocumentPinnedResult = z.infer<typeof ProfileSetDocumentPinnedResultSchema>;

// profile_get_document_preview — mirrors GET /documents/:id/preview response
// from the deleted profileRouter. The runner storage layer returns a richer
// shape than the original REST route (normalized vs raw source marker); we
// surface all of it since the schema is additive.
export const ProfileGetDocumentPreviewPayloadSchema = z.object({
  documentId: z.string().min(1)
}).strict();
export const ProfileGetDocumentPreviewResultSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  note: z.string(),
  sourceType: z.string(),
  extractionStatus: z.string(),
  rawPath: z.string(),
  normalizedPath: z.string(),
  previewSource: z.enum(["normalized", "raw", "none"]),
  content: z.string()
}).strict();
export type ProfileGetDocumentPreviewPayload = z.infer<typeof ProfileGetDocumentPreviewPayloadSchema>;
export type ProfileGetDocumentPreviewResult = z.infer<typeof ProfileGetDocumentPreviewResultSchema>;

// ---------------------------------------------------------------------------
// Provider CLI auth — 설치/인증 상태 확인 및 인증 플로우
// ---------------------------------------------------------------------------
const ProviderCliIdSchema = z.enum(["claude", "codex", "gemini"]);

export const CheckProviderCliStatusPayloadSchema = z.object({
  providerId: ProviderCliIdSchema.optional()
}).strict();
export type CheckProviderCliStatusPayload = z.infer<typeof CheckProviderCliStatusPayloadSchema>;

export const StartProviderCliAuthPayloadSchema = z.object({
  providerId: ProviderCliIdSchema
}).strict();
export type StartProviderCliAuthPayload = z.infer<typeof StartProviderCliAuthPayloadSchema>;

export const SubmitProviderCliCodePayloadSchema = z.object({
  providerId: ProviderCliIdSchema,
  code: z.string().min(1)
}).strict();
export type SubmitProviderCliCodePayload = z.infer<typeof SubmitProviderCliCodePayloadSchema>;

export const CallProviderLogoutPayloadSchema = z.object({
  providerId: ProviderCliIdSchema
}).strict();
export const CallProviderLogoutResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional()
}).strict();
export type CallProviderLogoutPayload = z.infer<typeof CallProviderLogoutPayloadSchema>;
export type CallProviderLogoutResult = z.infer<typeof CallProviderLogoutResultSchema>;

// ---------------------------------------------------------------------------
// Exhaustive op name list
// ---------------------------------------------------------------------------
export const OP_NAMES = [
  "get_state",
  "list_projects",
  "get_project",
  "save_project",
  "upload_document",
  "delete_document",
  "list_runs",
  "get_run_messages",
  "start_run",
  "resume_run",
  "abort_run",
  "complete_run",
  "submit_intervention",
  "call_provider_test",
  "save_provider_config",
  "save_provider_api_key",
  "notion_connect",
  "notion_disconnect",
  "opendart_save_key",
  "opendart_test",
  "read_file",
  "write_file",
  "list_workspace_files",
  "get_agent_defaults",
  "create_project",
  "delete_project",
  "save_document",
  "save_essay_draft",
  "analyze_posting",
  "get_project_insights",
  "analyze_insights",
  "generate_insights",
  "upload_document_chunk",
  "clear_provider_api_key",
  "notion_check",
  "opendart_delete_key",
  "save_agent_defaults",
  "delete_run",
  "profile_list_documents",
  "profile_save_text_document",
  "profile_upload_document_chunk",
  "profile_set_document_pinned",
  "profile_get_document_preview",
  "check_provider_cli_status",
  "start_provider_cli_auth",
  "submit_provider_cli_code",
  "call_provider_logout"
] as const satisfies readonly [string, ...string[]];

// Hard cap for chunked upload assembly (server-enforced in handler).
// Matches plan Decisions #3 — 100MB single-file limit.
export const UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const UPLOAD_DOCUMENT_CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

export type OpName = (typeof OP_NAMES)[number];

// ---------------------------------------------------------------------------
// RPC Request — discriminated union on op
// ---------------------------------------------------------------------------
const RpcRequestBaseSchema = z.object({
  v: z.literal(1),
  id: z.string()
});

export const RpcRequestSchema = z.discriminatedUnion("op", [
  RpcRequestBaseSchema.extend({ op: z.literal("get_state"), payload: GetStatePayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("list_projects"), payload: ListProjectsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("get_project"), payload: GetProjectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_project"), payload: SaveProjectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("upload_document"), payload: UploadDocumentPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("delete_document"), payload: DeleteDocumentPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("list_runs"), payload: ListRunsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("get_run_messages"), payload: GetRunMessagesPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("start_run"), payload: StartRunPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("resume_run"), payload: ResumeRunPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("abort_run"), payload: AbortRunPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("complete_run"), payload: CompleteRunPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("submit_intervention"), payload: SubmitInterventionPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("call_provider_test"), payload: CallProviderTestPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_provider_config"), payload: SaveProviderConfigPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_provider_api_key"), payload: SaveProviderApiKeyPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("notion_connect"), payload: NotionConnectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("notion_disconnect"), payload: NotionDisconnectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("opendart_save_key"), payload: OpendartSaveKeyPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("opendart_test"), payload: OpendartTestPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("read_file"), payload: ReadFilePayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("write_file"), payload: WriteFilePayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("list_workspace_files"), payload: ListWorkspaceFilesPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("get_agent_defaults"), payload: GetAgentDefaultsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("create_project"), payload: CreateProjectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("delete_project"), payload: DeleteProjectPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_document"), payload: SaveDocumentPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_essay_draft"), payload: SaveEssayDraftPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("analyze_posting"), payload: AnalyzePostingPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("get_project_insights"), payload: GetProjectInsightsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("analyze_insights"), payload: AnalyzeInsightsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("generate_insights"), payload: GenerateInsightsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("upload_document_chunk"), payload: UploadDocumentChunkPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("clear_provider_api_key"), payload: ClearProviderApiKeyPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("notion_check"), payload: NotionCheckPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("opendart_delete_key"), payload: OpendartDeleteKeyPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("save_agent_defaults"), payload: SaveAgentDefaultsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("delete_run"), payload: DeleteRunPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("profile_list_documents"), payload: ProfileListDocumentsPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("profile_save_text_document"), payload: ProfileSaveTextDocumentPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("profile_upload_document_chunk"), payload: ProfileUploadDocumentChunkPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("profile_set_document_pinned"), payload: ProfileSetDocumentPinnedPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("profile_get_document_preview"), payload: ProfileGetDocumentPreviewPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("check_provider_cli_status"), payload: CheckProviderCliStatusPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("start_provider_cli_auth"), payload: StartProviderCliAuthPayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("submit_provider_cli_code"), payload: SubmitProviderCliCodePayloadSchema }).strict(),
  RpcRequestBaseSchema.extend({ op: z.literal("call_provider_logout"), payload: CallProviderLogoutPayloadSchema }).strict()
]);

export type RpcRequest = z.infer<typeof RpcRequestSchema>;

// ---------------------------------------------------------------------------
// RPC Response
// ---------------------------------------------------------------------------
const RpcResponseOkSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  ok: z.literal(true),
  result: z.record(z.string(), z.unknown())
}).strict();

const RpcResponseErrSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  ok: z.literal(false),
  error: RpcErrorSchema
}).strict();

export const RpcResponseSchema = z.discriminatedUnion("ok", [
  RpcResponseOkSchema,
  RpcResponseErrSchema
]);

export type RpcResponse = z.infer<typeof RpcResponseSchema>;

// ---------------------------------------------------------------------------
// Runner → Backend WS wire frames
// ---------------------------------------------------------------------------
// The runner wraps every outbound frame with a `type` discriminator so the
// backend's DeviceHub can dispatch without guessing from the schema shape.
// These helpers are the single source of truth for that wire format — both
// the runner (outboundClient) and backend test fakes import them to prevent
// drift. If the wrapper shape ever changes, update here and both sides stay
// in lockstep.

export type RunnerRpcResponseFrame = RpcResponse & { readonly type: "rpc_response" };

export interface RunnerEventFrame {
  readonly type: "event";
  readonly v: 1;
  readonly event: string;
  readonly payload: unknown;
}

export function wrapRpcResponse(response: RpcResponse): RunnerRpcResponseFrame {
  return { type: "rpc_response", ...response } as RunnerRpcResponseFrame;
}

export function wrapEvent(envelope: { v: 1; event: string; payload: unknown }): RunnerEventFrame {
  return { type: "event", ...envelope };
}

// ---------------------------------------------------------------------------
// Event schemas — 4 events from plan section 4
// ---------------------------------------------------------------------------

// state_snapshot
export const StateSnapshotEventPayloadSchema = z.object({
  state: SidebarStateSchema
}).strict();
export type StateSnapshotEventPayload = z.infer<typeof StateSnapshotEventPayloadSchema>;

// run_event
export const RunEventPayloadSchema = z.object({
  runId: z.string(),
  event: RunEventSchema
}).strict();
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;

// intervention_request
export const InterventionRequestPayloadSchema = z.object({
  runId: z.string(),
  prompt: z.string()
}).strict();
export type InterventionRequestPayload = z.infer<typeof InterventionRequestPayloadSchema>;

// run_finished
export const RunFinishedPayloadSchema = z.object({
  runId: z.string(),
  status: z.enum(["completed", "aborted", "failed"]),
  summary: z.string().optional()
}).strict();
export type RunFinishedPayload = z.infer<typeof RunFinishedPayloadSchema>;

// Event name exhaustive list
export const EVENT_NAMES = [
  "state_snapshot",
  "run_event",
  "intervention_request",
  "run_finished"
] as const satisfies readonly [string, ...string[]];

export type EventName = (typeof EVENT_NAMES)[number];

// ---------------------------------------------------------------------------
// EventEnvelope — discriminated union on event
// ---------------------------------------------------------------------------
export const EventEnvelopeSchema = z.discriminatedUnion("event", [
  z.object({
    v: z.literal(1),
    event: z.literal("state_snapshot"),
    payload: StateSnapshotEventPayloadSchema
  }).strict(),
  z.object({
    v: z.literal(1),
    event: z.literal("run_event"),
    payload: RunEventPayloadSchema
  }).strict(),
  z.object({
    v: z.literal(1),
    event: z.literal("intervention_request"),
    payload: InterventionRequestPayloadSchema
  }).strict(),
  z.object({
    v: z.literal(1),
    event: z.literal("run_finished"),
    payload: RunFinishedPayloadSchema
  }).strict()
]);

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Inferred types for payloads/results (re-exported for downstream consumers)
// ---------------------------------------------------------------------------
export type {
  ProjectDetailSchema,
  ProjectSummarySchema,
  RunSummarySchema,
  WorkspaceFileEntrySchema,
  ProjectPatchSchema,
  ProviderConfigSchema
};
