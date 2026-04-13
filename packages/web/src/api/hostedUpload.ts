import type { UploadDocumentChunkResult } from "@jasojeon/shared";
import type { RunnerClient } from "./client";

// Mirrors packages/shared/src/core/hostedRpc.ts — kept inline because the web
// bundle imports from shared's CJS dist, which vite cannot statically
// re-export value constants across. The shared file is the source of truth;
// if you change these there, change them here.
const UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const UPLOAD_DOCUMENT_CHUNK_SIZE_BYTES = 1 * 1024 * 1024;

/**
 * Hosted-mode chunked upload adapter.
 *
 * Splits a File into UPLOAD_DOCUMENT_CHUNK_SIZE_BYTES (1MB) chunks, base64
 * encodes each, and streams them through the upload_document_chunk RPC.
 * Verifies the total file hash (sha256) so the runner can reject corrupt
 * or truncated payloads.
 *
 * Throws synchronously (rejected promise) if the file exceeds
 * UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES (100MB).
 */

export interface UploadFileInChunksOpts {
  readonly client: RunnerClient;
  readonly slug: string;
  readonly file: File;
  readonly onProgress?: (sent: number, total: number) => void;
  readonly signal?: AbortSignal;
}

export interface UploadFileInChunksResult {
  readonly docId: string;
  readonly uploadId: string;
}

export async function uploadFileInChunks(
  opts: UploadFileInChunksOpts
): Promise<UploadFileInChunksResult> {
  const { client, slug, file, onProgress, signal } = opts;
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

  let lastResult: UploadDocumentChunkResult | undefined;
  let sentBytes = 0;
  for (let i = 0; i < totalChunks; i += 1) {
    signal?.throwIfAborted();
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fullBytes.byteLength);
    const chunk = fullBytes.subarray(start, end);
    const chunkBase64 = base64FromBytes(chunk);
    lastResult = await client.rpcCall<UploadDocumentChunkResult>("upload_document_chunk", {
      slug,
      uploadId,
      filename: file.name,
      chunkIndex: i,
      totalChunks,
      totalBytes: fullBytes.byteLength,
      sha256: hash,
      chunkBase64
    });
    sentBytes += chunk.byteLength;
    onProgress?.(sentBytes, fullBytes.byteLength);
  }

  if (!lastResult || lastResult.status !== "complete") {
    throw new Error("청크 업로드가 완료 상태로 종료되지 않았습니다.");
  }
  return { docId: lastResult.docId, uploadId: lastResult.uploadId };
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
  // Manual base64 encoding — avoids File/Blob round-trips and works in both
  // browser and jsdom/test environments.
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
    return `upl-${crypto.randomUUID()}`;
  }
  return `upl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
