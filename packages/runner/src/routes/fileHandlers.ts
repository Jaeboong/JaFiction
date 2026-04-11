import {
  ListWorkspaceFilesPayload,
  ListWorkspaceFilesResult,
  ReadFilePayload,
  ReadFileResult,
  WriteFilePayload,
  WriteFileResult
} from "@jafiction/shared";
import { createFileRpc, FileRpc } from "../hosted/fileRpc";
import { RunnerContext } from "../runnerContext";

/**
 * Phase 8: file handlers delegate to `createFileRpc`, which enforces a
 * root-jail via `fs.realpath` + prefix check. We memoize one FileRpc
 * instance per `workspaceRoot` so the root realpath is resolved once.
 */
const fileRpcCache = new Map<string, FileRpc>();

function getFileRpc(ctx: RunnerContext): FileRpc {
  const existing = fileRpcCache.get(ctx.workspaceRoot);
  if (existing) {
    return existing;
  }
  const created = createFileRpc({ workspaceRoot: ctx.workspaceRoot });
  fileRpcCache.set(ctx.workspaceRoot, created);
  return created;
}

export async function readFile(
  ctx: RunnerContext,
  payload: ReadFilePayload
): Promise<ReadFileResult> {
  return getFileRpc(ctx).readFile(payload);
}

export async function writeFile(
  ctx: RunnerContext,
  payload: WriteFilePayload
): Promise<WriteFileResult> {
  return getFileRpc(ctx).writeFile(payload);
}

export async function listWorkspaceFiles(
  ctx: RunnerContext,
  payload: ListWorkspaceFilesPayload
): Promise<ListWorkspaceFilesResult> {
  return getFileRpc(ctx).listWorkspaceFiles(payload);
}
