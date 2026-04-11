import * as crypto from "node:crypto";
import {
  ProfileListDocumentsPayload,
  ProfileListDocumentsResult,
  ProfileSaveTextDocumentPayload,
  ProfileSaveTextDocumentResult,
  ProfileUploadDocumentChunkPayload,
  ProfileUploadDocumentChunkResult,
  ProfileSetDocumentPinnedPayload,
  ProfileSetDocumentPinnedResult,
  ProfileGetDocumentPreviewPayload,
  ProfileGetDocumentPreviewResult,
  UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

// ---------------------------------------------------------------------------
// Stage 11.8 — profile document hosted parity
//
// Restores the behavior of the deleted packages/runner/src/routes/profileRouter.ts.
// Five RPC ops matching the old REST surface, plus a chunked upload adapter
// that mirrors projectsHandlers.uploadDocumentChunk but targets the profile
// manifest instead of a project slug.
// ---------------------------------------------------------------------------

function taggedError(code: string, message: string): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

export async function profileListDocuments(
  ctx: RunnerContext,
  _payload: ProfileListDocumentsPayload
): Promise<ProfileListDocumentsResult> {
  const documents = await ctx.storage().listProfileDocuments();
  return { documents };
}

export async function profileSaveTextDocument(
  ctx: RunnerContext,
  payload: ProfileSaveTextDocumentPayload
): Promise<ProfileSaveTextDocumentResult> {
  // NOTE: payload.content may contain PII — never log at info level.
  const { title, content, note, pinnedByDefault } = payload;
  let documentId = "";
  await ctx.runBusy("프로필 텍스트를 저장하는 중...", async () => {
    const document = await ctx.storage().saveProfileTextDocument(
      title,
      content,
      Boolean(pinnedByDefault),
      note
    );
    documentId = document.id;
    await ctx.stateStore.refreshProfileDocuments();
  });
  const document = await ctx.storage().getProfileDocument(documentId);
  await ctx.pushState();
  return { document };
}

export async function profileSetDocumentPinned(
  ctx: RunnerContext,
  payload: ProfileSetDocumentPinnedPayload
): Promise<ProfileSetDocumentPinnedResult> {
  const { documentId, pinned } = payload;
  await ctx.runBusy("기본 포함 상태를 업데이트하는 중...", async () => {
    await ctx.storage().setProfileDocumentPinned(documentId, pinned);
    await ctx.stateStore.refreshProfileDocuments();
  });
  const document = await ctx.storage().getProfileDocument(documentId);
  await ctx.pushState();
  return { document };
}

export async function profileGetDocumentPreview(
  ctx: RunnerContext,
  payload: ProfileGetDocumentPreviewPayload
): Promise<ProfileGetDocumentPreviewResult> {
  const document = await ctx.storage().getProfileDocument(payload.documentId);
  const preview = await ctx.storage().readDocumentPreviewContent(document);
  return {
    documentId: document.id,
    title: document.title,
    note: document.note || "",
    sourceType: document.sourceType,
    extractionStatus: document.extractionStatus,
    rawPath: document.rawPath,
    normalizedPath: document.normalizedPath || "",
    previewSource: preview.previewSource,
    content: preview.content
  };
}

// ---------------------------------------------------------------------------
// Profile chunked upload — in-memory reassembly
//
// Deliberately mirrors the project-scoped upload session map in
// projectsHandlers.ts rather than extracting a shared helper. Flagged as
// duplication debt (~30 LOC) — can be unified when the profile upload path
// is battle-tested and the shapes have stabilized.
// ---------------------------------------------------------------------------

interface ProfileUploadSession {
  readonly fileName: string;
  readonly totalChunks: number;
  readonly totalBytes: number;
  readonly expectedSha256: string;
  readonly pinnedByDefault: boolean;
  readonly note: string | undefined;
  readonly chunks: Buffer[];
  nextChunkIndex: number;
  receivedBytes: number;
}

const profileUploadSessions = new Map<string, ProfileUploadSession>();

export async function profileUploadDocumentChunk(
  ctx: RunnerContext,
  payload: ProfileUploadDocumentChunkPayload
): Promise<ProfileUploadDocumentChunkResult> {
  // NOTE: never log chunkBase64 — it may contain PII.
  const {
    uploadId,
    fileName,
    chunkIndex,
    totalChunks,
    totalBytes,
    sha256,
    chunkBase64,
    pinnedByDefault,
    note
  } = payload;

  if (totalBytes > UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES) {
    throw taggedError(
      "invalid_input",
      `파일이 최대 업로드 한도(${UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES} bytes)를 초과했습니다.`
    );
  }

  let session = profileUploadSessions.get(uploadId);
  if (chunkIndex === 0 && !session) {
    session = {
      fileName,
      totalChunks,
      totalBytes,
      expectedSha256: sha256,
      pinnedByDefault: Boolean(pinnedByDefault),
      note,
      chunks: [],
      nextChunkIndex: 0,
      receivedBytes: 0
    };
    profileUploadSessions.set(uploadId, session);
  }
  if (!session) {
    throw taggedError("invalid_input", `알 수 없는 uploadId: ${uploadId}`);
  }
  if (session.fileName !== fileName || session.totalChunks !== totalChunks) {
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
    profileUploadSessions.delete(uploadId);
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

  profileUploadSessions.delete(uploadId);
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

  let documentId = "";
  await ctx.runBusy("프로필 파일을 가져오는 중...", async () => {
    const document = await ctx.storage().importProfileUpload(
      fileName,
      full,
      session.pinnedByDefault,
      session.note
    );
    documentId = document.id;
    await ctx.stateStore.refreshProfileDocuments();
  });
  const document = await ctx.storage().getProfileDocument(documentId);
  await ctx.pushState();
  return { status: "completed", uploadId, document };
}
