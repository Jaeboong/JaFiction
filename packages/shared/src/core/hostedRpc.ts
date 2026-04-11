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
  RunLedgerEntrySchema
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
export const ResumeRunPayloadSchema = z.object({
  runId: z.string(),
  message: z.string().optional()
}).strict();
export const ResumeRunResultSchema = z.object({
  ok: z.literal(true)
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
export const SubmitInterventionPayloadSchema = z.object({
  runId: z.string(),
  text: z.string()
}).strict();
export const SubmitInterventionResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type SubmitInterventionPayload = z.infer<typeof SubmitInterventionPayloadSchema>;
export type SubmitInterventionResult = z.infer<typeof SubmitInterventionResultSchema>;

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
// The plan says { token, dbId } but the existing route takes a providerId;
// token and dbId are the new hosted-mode inputs the runner will need to connect Notion.
export const NotionConnectPayloadSchema = z.object({
  token: z.string().min(1),
  dbId: z.string().min(1)
}).strict();
export const NotionConnectResultSchema = z.object({
  ok: z.literal(true)
}).strict();
export type NotionConnectPayload = z.infer<typeof NotionConnectPayloadSchema>;
export type NotionConnectResult = z.infer<typeof NotionConnectResultSchema>;

// notion_disconnect — mirrors providersRouter POST /:providerId/notion/disconnect
export const NotionDisconnectPayloadSchema = z.object({}).strict();
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
  "list_workspace_files"
] as const satisfies readonly [string, ...string[]];

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
  RpcRequestBaseSchema.extend({ op: z.literal("list_workspace_files"), payload: ListWorkspaceFilesPayloadSchema }).strict()
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
