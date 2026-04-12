import {
  RpcRequest,
  RpcResponse,
  RpcRequestSchema,
  assertNever
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

import { getState, getAgentDefaults, saveAgentDefaults } from "../routes/stateHandlers";
import {
  listProjects,
  getProject,
  saveProject,
  uploadDocument,
  deleteDocument,
  createProject,
  deleteProject,
  saveDocument,
  saveEssayDraft,
  analyzePosting,
  getProjectInsights,
  analyzeInsights,
  generateInsights,
  uploadDocumentChunk
} from "../routes/projectsHandlers";
import { listRuns, getRunMessages, startRun, resumeRun, abortRun, completeRun, submitIntervention, deleteRun } from "../routes/runsHandlers";
import {
  callProviderTest,
  saveProviderConfig,
  saveProviderApiKey,
  clearProviderApiKey,
  notionConnect,
  notionDisconnect,
  notionCheck
} from "../routes/providersHandlers";
import { opendartSaveKey, opendartTest, opendartDeleteKey } from "../routes/openDartHandlers";
import { readFile, writeFile, listWorkspaceFiles } from "../routes/fileHandlers";
import {
  profileListDocuments,
  profileSaveTextDocument,
  profileUploadDocumentChunk,
  profileSetDocumentPinned,
  profileGetDocumentPreview
} from "../routes/profileHandlers";
import {
  checkProviderCliStatus,
  startProviderCliAuth,
  submitProviderCliCode
} from "../routes/providerCliHandlers";

// ---------------------------------------------------------------------------
// Logger interface — narrow surface so callers can provide console or pino
// ---------------------------------------------------------------------------
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  info: (msg, meta) => console.info(msg, meta ?? ""),
  warn: (msg, meta) => console.warn(msg, meta ?? ""),
  error: (msg, meta) => console.error(msg, meta ?? "")
};

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------
type ErrorCode = "bad_request" | "not_found" | "invalid_input" | "internal" | "unauthorized" | "unknown_op" | "busy";

function classifyError(error: unknown): { code: ErrorCode; message: string } {
  if (error && typeof error === "object") {
    const tagged = error as { code?: string; message?: string };
    const code = tagged.code;
    if (
      code === "not_found" ||
      code === "invalid_input" ||
      code === "unauthorized" ||
      code === "busy"
    ) {
      return { code, message: tagged.message ?? String(error) };
    }
  }
  if (error instanceof Error) {
    return { code: "internal", message: error.message };
  }
  return { code: "internal", message: String(error) };
}

// ---------------------------------------------------------------------------
// Secret redaction for logging
// ---------------------------------------------------------------------------
export function redactForLog(op: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (op === "save_provider_api_key") {
    const { key: _key, ...rest } = payload as { key?: string } & Record<string, unknown>;
    return { ...rest, key: "***" };
  }
  if (op === "notion_connect") {
    const { token: _token, ...rest } = payload as { token?: string } & Record<string, unknown>;
    return { ...rest, token: "***" };
  }
  if (op === "opendart_save_key") {
    const { key: _key, ...rest } = payload as { key?: string } & Record<string, unknown>;
    return { ...rest, key: "***" };
  }
  if (op === "profile_save_text_document") {
    const { content: _c, note: _n, ...rest } = payload as {
      content?: string;
      note?: string;
    } & Record<string, unknown>;
    return { ...rest, content: "<redacted>", note: _n !== undefined ? "<redacted>" : undefined };
  }
  if (op === "save_document") {
    // Document body may contain PII — never log the raw content.
    const { content: _c, note: _n, ...rest } = payload as {
      content?: string;
      note?: string;
    } & Record<string, unknown>;
    return { ...rest, content: "<redacted>", note: _n !== undefined ? "<redacted>" : undefined };
  }
  if (op === "save_essay_draft") {
    const { draft: _d, ...rest } = payload as { draft?: string } & Record<string, unknown>;
    return { ...rest, draft: "<redacted>" };
  }
  if (op === "upload_document" || op === "upload_document_chunk" || op === "profile_upload_document_chunk") {
    const { contentBase64: _b, chunkBase64: _cb, ...rest } = payload as {
      contentBase64?: string;
      chunkBase64?: string;
    } & Record<string, unknown>;
    return { ...rest, contentBase64: _b !== undefined ? "<redacted>" : undefined, chunkBase64: _cb !== undefined ? "<redacted>" : undefined };
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Dispatcher factory
// ---------------------------------------------------------------------------
export interface DispatcherDeps {
  readonly runnerContext: RunnerContext;
  readonly logger?: Logger;
}

export function createRpcDispatcher(
  deps: DispatcherDeps
): (req: unknown) => Promise<RpcResponse> {
  const ctx = deps.runnerContext;
  const log = deps.logger ?? defaultLogger;

  return async function dispatch(rawReq: unknown): Promise<RpcResponse> {
    // 1. Validate envelope
    const parseResult = RpcRequestSchema.safeParse(rawReq);
    if (!parseResult.success) {
      // Log only structural issue info (path + code) — never the raw input or zod message,
      // which may embed secrets from save_provider_api_key / notion_connect / opendart_save_key.
      const issues = parseResult.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code
      }));
      log.warn("rpc:bad_request", { issues });
      return {
        v: 1,
        id: typeof rawReq === "object" && rawReq !== null && "id" in rawReq ? String((rawReq as Record<string, unknown>).id) : "unknown",
        ok: false,
        error: { code: "bad_request", message: "Invalid request envelope" }
      };
    }

    const req: RpcRequest = parseResult.data;
    const start = Date.now();

    log.info(`rpc:${req.op}:start`, {
      id: req.id,
      payload: redactForLog(req.op, req.payload as Record<string, unknown>)
    });

    try {
      const result = await route(ctx, req);
      const ms = Date.now() - start;
      log.info(`rpc:${req.op}:ok`, { id: req.id, ms });
      return { v: 1, id: req.id, ok: true, result: result as Record<string, unknown> };
    } catch (error) {
      const ms = Date.now() - start;
      const { code, message } = classifyError(error);
      log.error(`rpc:${req.op}:err`, { id: req.id, ms, code, message });
      return { v: 1, id: req.id, ok: false, error: { code, message } };
    }
  };
}

// ---------------------------------------------------------------------------
// Route switch — exhaustive discriminated union
// ---------------------------------------------------------------------------
async function route(ctx: RunnerContext, req: RpcRequest): Promise<unknown> {
  switch (req.op) {
    case "get_state":
      return getState(ctx, req.payload);

    case "list_projects":
      return listProjects(ctx, req.payload);

    case "get_project":
      return getProject(ctx, req.payload);

    case "save_project":
      return saveProject(ctx, req.payload);

    case "upload_document":
      return uploadDocument(ctx, req.payload);

    case "delete_document":
      return deleteDocument(ctx, req.payload);

    case "list_runs":
      return listRuns(ctx, req.payload);

    case "get_run_messages":
      return getRunMessages(ctx, req.payload);

    case "start_run":
      return startRun(ctx, req.payload);

    case "resume_run":
      return resumeRun(ctx, req.payload);

    case "abort_run":
      return abortRun(ctx, req.payload);

    case "complete_run":
      return completeRun(ctx, req.payload);

    case "submit_intervention":
      return submitIntervention(ctx, req.payload);

    case "call_provider_test":
      return callProviderTest(ctx, req.payload);

    case "save_provider_config":
      return saveProviderConfig(ctx, req.payload);

    case "save_provider_api_key":
      return saveProviderApiKey(ctx, req.payload);

    case "notion_connect":
      return notionConnect(ctx, req.payload);

    case "notion_disconnect":
      return notionDisconnect(ctx, req.payload);

    case "opendart_save_key":
      return opendartSaveKey(ctx, req.payload);

    case "opendart_test":
      return opendartTest(ctx, req.payload);

    case "read_file":
      return readFile(ctx, req.payload);

    case "write_file":
      return writeFile(ctx, req.payload);

    case "list_workspace_files":
      return listWorkspaceFiles(ctx, req.payload);

    case "get_agent_defaults":
      return getAgentDefaults(ctx, req.payload);

    case "create_project":
      return createProject(ctx, req.payload);

    case "delete_project":
      return deleteProject(ctx, req.payload);

    case "save_document":
      return saveDocument(ctx, req.payload);

    case "save_essay_draft":
      return saveEssayDraft(ctx, req.payload);

    case "analyze_posting":
      return analyzePosting(ctx, req.payload);

    case "get_project_insights":
      return getProjectInsights(ctx, req.payload);

    case "analyze_insights":
      return analyzeInsights(ctx, req.payload);

    case "generate_insights":
      return generateInsights(ctx, req.payload);

    case "upload_document_chunk":
      return uploadDocumentChunk(ctx, req.payload);

    case "clear_provider_api_key":
      return clearProviderApiKey(ctx, req.payload);

    case "notion_check":
      return notionCheck(ctx, req.payload);

    case "opendart_delete_key":
      return opendartDeleteKey(ctx, req.payload);

    case "save_agent_defaults":
      return saveAgentDefaults(ctx, req.payload);

    case "delete_run":
      return deleteRun(ctx, req.payload);

    case "profile_list_documents":
      return profileListDocuments(ctx, req.payload);

    case "profile_save_text_document":
      return profileSaveTextDocument(ctx, req.payload);

    case "profile_upload_document_chunk":
      return profileUploadDocumentChunk(ctx, req.payload);

    case "profile_set_document_pinned":
      return profileSetDocumentPinned(ctx, req.payload);

    case "profile_get_document_preview":
      return profileGetDocumentPreview(ctx, req.payload);

    case "check_provider_cli_status":
      return checkProviderCliStatus(ctx, req.payload);

    case "start_provider_cli_auth":
      return startProviderCliAuth(ctx, req.payload);

    case "submit_provider_cli_code":
      return submitProviderCliCode(ctx, req.payload);

    default:
      // Compile-time exhaustiveness guard + runtime defense
      return assertNever(req);
  }
}
