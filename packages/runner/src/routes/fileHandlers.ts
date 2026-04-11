import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import {
  ReadFilePayload,
  ReadFileResult,
  WriteFilePayload,
  WriteFileResult,
  ListWorkspaceFilesPayload,
  ListWorkspaceFilesResult
} from "@jafiction/shared";
import { RunnerContext } from "../runnerContext";

/**
 * Resolve and root-jail a relative or absolute path inside workspaceRoot.
 * Throws with code "invalid_input" if the resolved path escapes the jail.
 *
 * We do NOT call realpath before the prefix check because the file may not
 * exist yet (write_file). Phase 8 will add realpath-based symlink hardening.
 */
function jailPath(workspaceRoot: string, requestedPath: string): string {
  const resolved = path.resolve(workspaceRoot, requestedPath);
  const jail = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (resolved !== workspaceRoot && !resolved.startsWith(jail)) {
    throw Object.assign(
      new Error(`Path escapes workspace root: ${requestedPath}`),
      { code: "invalid_input" }
    );
  }
  return resolved;
}

export async function readFile(
  ctx: RunnerContext,
  payload: ReadFilePayload
): Promise<ReadFileResult> {
  const target = jailPath(ctx.workspaceRoot, payload.path);
  const content = await fs.readFile(target);
  return { contentBase64: content.toString("base64") };
}

export async function writeFile(
  ctx: RunnerContext,
  payload: WriteFilePayload
): Promise<WriteFileResult> {
  const target = jailPath(ctx.workspaceRoot, payload.path);
  const buffer = Buffer.from(payload.contentBase64, "base64");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { ok: true, bytes: buffer.byteLength };
}

export async function listWorkspaceFiles(
  ctx: RunnerContext,
  payload: ListWorkspaceFilesPayload
): Promise<ListWorkspaceFilesResult> {
  const base = payload.subdir
    ? jailPath(ctx.workspaceRoot, payload.subdir)
    : ctx.workspaceRoot;

  let dirents: Dirent<string>[];
  try {
    dirents = await fs.readdir(base, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return { entries: [] };
  }

  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const name = String(dirent.name);
      const fullPath = path.join(base, name);
      const relativePath = path.relative(ctx.workspaceRoot, fullPath);
      let sizeBytes: number | undefined;
      if (dirent.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          sizeBytes = stat.size;
        } catch {
          // best effort
        }
      }
      return {
        path: relativePath,
        name,
        isDirectory: dirent.isDirectory(),
        sizeBytes
      };
    })
  );

  return { entries };
}
