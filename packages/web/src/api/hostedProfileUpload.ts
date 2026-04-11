import type { ContextDocument, ProfileUploadDocumentChunkResult } from "@jasojeon/shared";
import type { RunnerClient } from "./client";

// Mirrors the project-scoped chunk size/cap constants from hostedUpload.ts.
// Kept inline because the shared CJS dist doesn't re-export value constants
// across the vite bundling boundary.
const UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const UPLOAD_DOCUMENT_CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/**
 * Hosted-mode profile document chunked upload.
 *
 * Mirrors hostedUpload.uploadFileInChunks but streams into
 * profile_upload_document_chunk (no project slug). Returns the committed
 * ContextDocument once the final chunk resolves with status "completed".
 */

export interface UploadProfileFileOpts {
  readonly client: RunnerClient;
  readonly file: File;
  readonly note?: string;
  readonly pinnedByDefault?: boolean;
}

export async function uploadProfileFileInChunks(
  opts: UploadProfileFileOpts
): Promise<ContextDocument> {
  const { client, file, note, pinnedByDefault } = opts;
  if (file.size > UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES) {
    throw new Error(
      `파일이 최대 업로드 한도(${UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES} bytes)를 초과했습니다.`
    );
  }

  const fullBytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(fullBytes);
  const uploadId = generateUploadId();
  const chunkSize = UPLOAD_DOCUMENT_CHUNK_SIZE_BYTES;
  const totalChunks = Math.max(1, Math.ceil(fullBytes.byteLength / chunkSize));

  let lastResult: ProfileUploadDocumentChunkResult | undefined;
  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fullBytes.byteLength);
    const chunk = fullBytes.subarray(start, end);
    const chunkBase64 = base64FromBytes(chunk);
    const payload: {
      uploadId: string;
      fileName: string;
      chunkIndex: number;
      totalChunks: number;
      totalBytes: number;
      sha256: string;
      chunkBase64: string;
      note?: string;
      pinnedByDefault?: boolean;
    } = {
      uploadId,
      fileName: file.name,
      chunkIndex: i,
      totalChunks,
      totalBytes: fullBytes.byteLength,
      sha256: hash,
      chunkBase64
    };
    if (note !== undefined) {
      payload.note = note;
    }
    if (pinnedByDefault !== undefined) {
      payload.pinnedByDefault = pinnedByDefault;
    }
    lastResult = await client.rpcCall<ProfileUploadDocumentChunkResult>(
      "profile_upload_document_chunk",
      payload
    );
  }

  if (!lastResult || lastResult.status !== "completed") {
    throw new Error("청크 업로드가 완료 상태로 종료되지 않았습니다.");
  }
  return lastResult.document;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", copy.buffer);
  const view = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < view.byteLength; i += 1) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function generateUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `upl-profile-${crypto.randomUUID()}`;
  }
  return `upl-profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
