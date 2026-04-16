import * as crypto from "node:crypto";
import {
  GetProjectPayload,
  GetProjectResult,
  ListProjectsPayload,
  ListProjectsResult,
  type ProjectInsightInput,
  SaveProjectPayload,
  SaveProjectResult,
  UploadDocumentPayload,
  UploadDocumentResult,
  DeleteDocumentPayload,
  DeleteDocumentResult,
  CreateProjectPayload,
  CreateProjectResult,
  DeleteProjectPayload,
  DeleteProjectResult,
  SaveDocumentPayload,
  SaveDocumentResult,
  SaveEssayDraftPayload,
  SaveEssayDraftResult,
  AnalyzePostingPayload,
  AnalyzePostingResult,
  GetProjectInsightsPayload,
  GetProjectInsightsResult,
  AnalyzeInsightsPayload,
  AnalyzeInsightsResult,
  GenerateInsightsPayload,
  GenerateInsightsResult,
  UploadDocumentChunkPayload,
  UploadDocumentChunkResult,
  UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES,
  fetchAndExtractJobPosting
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";
import {
  analyzeProjectInsightsService,
  buildInsightWorkspaceStateService,
  generateProjectInsightsService
} from "./insightsHandlers";

export async function listProjects(
  ctx: RunnerContext,
  _payload: ListProjectsPayload
): Promise<ListProjectsResult> {
  const projects = await ctx.storage().listProjects();
  return { projects };
}

export async function getProject(
  ctx: RunnerContext,
  payload: GetProjectPayload
): Promise<GetProjectResult> {
  return ctx.storage().getProject(payload.slug);
}

export async function saveProject(
  ctx: RunnerContext,
  payload: SaveProjectPayload
): Promise<SaveProjectResult> {
  const { slug, patch } = payload;
  await ctx.runBusy("프로젝트 정보를 업데이트하는 중...", async () => {
    const current = await ctx.storage().getProject(slug);
    await ctx.storage().updateProjectInfo(slug, normalizeProjectPatch(current.companyName, patch));
    await ctx.stateStore.refreshProjects(slug);
  });
  return ctx.storage().getProject(slug);
}

export async function uploadDocument(
  ctx: RunnerContext,
  payload: UploadDocumentPayload
): Promise<UploadDocumentResult> {
  const { slug, filename, contentBase64 } = payload;
  const buffer = Buffer.from(contentBase64, "base64");
  let documentId = "";
  await ctx.runBusy("프로젝트 파일을 가져오는 중...", async () => {
    await ctx.storage().importProjectUpload(slug, filename, buffer);
    await ctx.stateStore.refreshProjects(slug);
  });
  const documents = await ctx.storage().listProjectDocuments(slug);
  const match = documents.find((doc) => doc.title === filename || doc.title.endsWith(filename));
  documentId = match?.id ?? documents[documents.length - 1]?.id ?? "";
  return { docId: documentId };
}

export async function deleteDocument(
  ctx: RunnerContext,
  payload: DeleteDocumentPayload
): Promise<DeleteDocumentResult> {
  const { slug, docId } = payload;
  await ctx.runBusy("프로젝트 문서를 삭제하는 중...", async () => {
    await ctx.storage().deleteProjectDocument(slug, docId);
    await ctx.stateStore.refreshProjects(slug);
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stage 11.2 — project CRUD + insights parity
// ---------------------------------------------------------------------------

export async function createProject(
  ctx: RunnerContext,
  payload: CreateProjectPayload
): Promise<CreateProjectResult> {
  let slug = "";
  await ctx.runBusy("프로젝트를 만드는 중...", async () => {
    const project = await ctx.storage().createProject(payload);
    slug = project.slug;
    await ctx.stateStore.refreshProjects();
  });
  return ctx.storage().getProject(slug);
}

export async function deleteProject(
  ctx: RunnerContext,
  payload: DeleteProjectPayload
): Promise<DeleteProjectResult> {
  const { slug } = payload;
  await ctx.runBusy("프로젝트를 삭제하는 중...", async () => {
    await ctx.storage().deleteProject(slug);
    await ctx.stateStore.refreshProjects();
  });
  return { ok: true };
}

export async function saveDocument(
  ctx: RunnerContext,
  payload: SaveDocumentPayload
): Promise<SaveDocumentResult> {
  const { slug, title, content, note, pinnedByDefault } = payload;
  // NOTE: document body may contain PII — never log `content` at info level.
  let docId = "";
  await ctx.runBusy("프로젝트 텍스트를 저장하는 중...", async () => {
    const document = await ctx.storage().saveProjectTextDocument(
      slug,
      title,
      content,
      Boolean(pinnedByDefault),
      note
    );
    docId = document.id;
    await ctx.stateStore.refreshProjects(slug);
  });
  return { docId };
}

export async function saveEssayDraft(
  ctx: RunnerContext,
  payload: SaveEssayDraftPayload
): Promise<SaveEssayDraftResult> {
  const { slug, questionIndex, draft } = payload;
  // NOTE: draft may contain PII — never log `draft` at info level.
  await ctx.runBusy("초안을 저장하는 중...", async () => {
    const project = await ctx.storage().getProject(slug);
    const question = project.essayQuestions?.[questionIndex];
    if (!question) {
      const err = new Error("선택한 문항을 찾을 수 없습니다.");
      (err as { code?: string }).code = "invalid_input";
      throw err;
    }
    await ctx.storage().saveCompletedEssayAnswer(slug, questionIndex, question, draft);
    await ctx.stateStore.refreshProjects(slug);
    await ctx.pushState();
  });
  return { questionIndex };
}

export async function analyzePosting(
  _ctx: RunnerContext,
  payload: AnalyzePostingPayload
): Promise<AnalyzePostingResult> {
  const result = await fetchAndExtractJobPosting({
    jobPostingUrl: payload.jobPostingUrl,
    jobPostingText: payload.jobPostingText,
    seedCompanyName: payload.companyName,
    seedRoleName: payload.roleName
  });
  // Strip undefined fields so the strict schema round-trips cleanly.
  return JSON.parse(JSON.stringify(result)) as AnalyzePostingResult;
}

export async function getProjectInsights(
  ctx: RunnerContext,
  payload: GetProjectInsightsPayload
): Promise<GetProjectInsightsResult> {
  const state = await buildInsightWorkspaceStateService(ctx, payload.slug);
  return JSON.parse(JSON.stringify(state)) as GetProjectInsightsResult;
}

/**
 * LLM kickoff pattern (plan Decisions #5): return jobId immediately, run the
 * long-running analysis in the background, and broadcast a state_snapshot
 * event via ctx.pushState() when finished.
 */
export async function analyzeInsights(
  ctx: RunnerContext,
  payload: AnalyzeInsightsPayload
): Promise<AnalyzeInsightsResult> {
  const jobId = `insights-analyze-${crypto.randomUUID()}`;
  const slug = payload.slug;
  void (async () => {
    try {
      await analyzeProjectInsightsService(ctx, {
        projectSlug: slug,
        patch: payload.patch as Record<string, unknown> | undefined
      });
    } catch {
      // Errors are persisted onto the project record (insightLastError).
      // Rethrowing here has no caller — just swallow after logging.
    } finally {
      try {
        await ctx.stateStore.refreshProjects(slug);
        await ctx.pushState();
      } catch {
        // push failure is non-fatal for the kickoff contract
      }
    }
  })();
  return { jobId };
}

export async function generateInsights(
  ctx: RunnerContext,
  payload: GenerateInsightsPayload
): Promise<GenerateInsightsResult> {
  const jobId = `insights-generate-${crypto.randomUUID()}`;
  const slug = payload.slug;
  void (async () => {
    try {
      await generateProjectInsightsService(ctx, {
        projectSlug: slug,
        patch: payload.patch as Record<string, unknown> | undefined
      });
    } catch (err) {
      try {
        const message = err instanceof Error ? err.message : String(err);
        const storage = ctx.storage();
        const current = await storage.getProject(slug);
        await storage.updateProject({ ...current, insightStatus: "error", insightLastError: message });
      } catch {
        // storage write failure is non-fatal
      }
    } finally {
      try {
        await ctx.stateStore.refreshProjects(slug);
        await ctx.pushState();
      } catch {
        // non-fatal
      }
    }
  })();
  return { jobId };
}

// ---------------------------------------------------------------------------
// Chunked upload — reassembly state
//
// Clients stream a file in 1MB base64 chunks. The runner holds an in-memory
// buffer keyed by (userId/sessionToken, uploadId). On the final chunk, the
// assembled bytes are hashed and compared against the client-supplied sha256.
// Out-of-order chunks are rejected (bad_request).
//
// State is scoped to this module — the RunnerContext has one dispatcher per
// device, so there is no cross-user bleed. If the process restarts mid-upload
// the client must restart from chunk 0.
// ---------------------------------------------------------------------------

interface UploadSession {
  readonly slug: string;
  readonly filename: string;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly expectedSha256: string;
  readonly chunks: Buffer[];
  nextChunkIndex: number;
  receivedBytes: number;
}

const uploadSessions = new Map<string, UploadSession>();

function taggedError(code: string, message: string): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

export async function uploadDocumentChunk(
  ctx: RunnerContext,
  payload: UploadDocumentChunkPayload
): Promise<UploadDocumentChunkResult> {
  // NOTE: never log `chunkBase64` — it may contain PII from user documents.
  const {
    slug,
    uploadId,
    filename,
    chunkIndex,
    totalChunks,
    totalBytes,
    sha256,
    chunkBase64
  } = payload;

  if (totalBytes > UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES) {
    throw taggedError(
      "invalid_input",
      `파일이 최대 업로드 한도(${UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES} bytes)를 초과했습니다.`
    );
  }

  let session = uploadSessions.get(uploadId);
  if (chunkIndex === 0 && !session) {
    session = {
      slug,
      filename,
      totalChunks,
      totalBytes,
      expectedSha256: sha256,
      chunks: [],
      nextChunkIndex: 0,
      receivedBytes: 0
    };
    uploadSessions.set(uploadId, session);
  }
  if (!session) {
    throw taggedError("invalid_input", `알 수 없는 uploadId: ${uploadId}`);
  }
  if (session.slug !== slug || session.filename !== filename || session.totalChunks !== totalChunks) {
    throw taggedError("invalid_input", "업로드 세션 메타데이터가 일치하지 않습니다.");
  }
  if (chunkIndex !== session.nextChunkIndex) {
    throw taggedError(
      "invalid_input",
      `청크 순서 불일치: expected ${session.nextChunkIndex}, got ${chunkIndex}`
    );
  }

  const buf = Buffer.from(chunkBase64, "base64");
  session.receivedBytes += buf.byteLength;
  if (session.receivedBytes > session.totalBytes) {
    uploadSessions.delete(uploadId);
    throw taggedError("invalid_input", "청크 합계가 totalBytes 를 초과했습니다.");
  }
  session.chunks.push(buf);
  session.nextChunkIndex += 1;

  if (session.nextChunkIndex < session.totalChunks) {
    return {
      status: "accepted",
      uploadId,
      nextChunkIndex: session.nextChunkIndex
    };
  }

  // Final chunk — reassemble, verify hash, commit.
  uploadSessions.delete(uploadId);
  const full = Buffer.concat(session.chunks, session.receivedBytes);
  if (full.byteLength !== session.totalBytes) {
    throw taggedError(
      "invalid_input",
      `업로드 크기 불일치: expected ${session.totalBytes}, got ${full.byteLength}`
    );
  }
  const actualHash = crypto.createHash("sha256").update(full).digest("hex");
  if (actualHash !== session.expectedSha256) {
    throw taggedError("invalid_input", "업로드 체크섬이 일치하지 않습니다.");
  }

  let docId = "";
  try {
    await ctx.runBusy("프로젝트 파일을 가져오는 중...", async () => {
      const document = await ctx.storage().importProjectUpload(slug, filename, full);
      docId = document.id;
      await ctx.stateStore.refreshProjects(slug);
    });
  } catch (error) {
    uploadSessions.delete(uploadId);
    const err = error as { code?: string; message?: string };
    if (!err.code) {
      (error as { code?: string }).code = "extraction_failed";
    }
    throw error;
  }

  return { status: "complete", uploadId, docId };
}

function normalizeProjectPatch(
  companyName: string,
  patch: SaveProjectPayload["patch"]
): ProjectInsightInput {
  const normalized: ProjectInsightInput = {
    companyName: patch.companyName ?? companyName
  };
  const stringFields = [
    "roleName",
    "deadline",
    "overview",
    "mainResponsibilities",
    "qualifications",
    "preferredQualifications",
    "benefits",
    "hiringProcess",
    "insiderView",
    "otherInfo",
    "jobPostingUrl",
    "jobPostingText",
    "openDartCorpCode"
  ] as const;

  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      normalized[field] = patch[field] ?? undefined;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "keywords")) {
    normalized.keywords = patch.keywords ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "essayQuestions")) {
    normalized.essayQuestions = patch.essayQuestions ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "openDartCandidates")) {
    normalized.openDartCandidates = patch.openDartCandidates ?? undefined;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "openDartSkipRequested")) {
    normalized.openDartSkipRequested = patch.openDartSkipRequested ?? undefined;
  }

  return normalized;
}
