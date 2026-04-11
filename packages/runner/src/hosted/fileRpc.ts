/**
 * Hosted-mode file RPC — root-jailed read/write/list operations.
 *
 * Every user-supplied path is resolved against `workspaceRoot`, then its real
 * (symlink-resolved) path must start with `realpath(workspaceRoot) + sep`.
 * For `write_file`, if the target does not exist yet we realpath the nearest
 * existing ancestor directory and re-apply the prefix check before writing.
 *
 * Error taxonomy (see hosted/rpcDispatcher classifyError):
 *   - `invalid_input`  path traversal, absolute path escape, symlink escape,
 *                      null bytes, empty string.
 *   - `not_found`      read target does not exist.
 */

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import {
  ListWorkspaceFilesPayload,
  ListWorkspaceFilesResult,
  ReadFilePayload,
  ReadFileResult,
  WorkspacePathError,
  WriteFilePayload,
  WriteFileResult,
  validateWorkspaceInputPath
} from "@jasojeon/shared";

// Minimal logger surface — matches rpcDispatcher.Logger.
export interface FileRpcLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface FileRpcDeps {
  readonly workspaceRoot: string;
  readonly logger?: FileRpcLogger;
}

export interface FileRpc {
  readFile(payload: ReadFilePayload): Promise<ReadFileResult>;
  writeFile(payload: WriteFilePayload): Promise<WriteFileResult>;
  listWorkspaceFiles(payload: ListWorkspaceFilesPayload): Promise<ListWorkspaceFilesResult>;
}

function invalidInput(message: string): Error {
  return new WorkspacePathError(message);
}

function notFound(message: string): Error {
  const err = new Error(message);
  (err as Error & { code: string }).code = "not_found";
  return err;
}

/**
 * Verify that `candidate` is equal to `rootReal` or a descendant of it.
 * Uses path.sep appending so `/root` does not match `/rootfoo`.
 */
function assertInsideRoot(candidate: string, rootReal: string): void {
  const jail = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (candidate !== rootReal && !candidate.startsWith(jail)) {
    throw invalidInput(`Path escapes workspace root: ${candidate}`);
  }
}

/**
 * Walk up from `target` until we find an existing ancestor, return its
 * realpath. Throws `invalid_input` if we walk out of the workspace root before
 * finding any existing ancestor.
 */
async function realpathExistingAncestor(target: string, rootReal: string): Promise<string> {
  let current = path.resolve(target);
  // Lexical safety net — we should always hit rootReal (which exists) before
  // escaping, but guard against pathological inputs.
  for (let i = 0; i < 4096; i += 1) {
    try {
      return await fs.realpath(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw invalidInput(`No existing ancestor for path: ${target}`);
      }
      // Lexical prefix check against rootReal so we never realpath outside the
      // jail while climbing.
      if (parent !== rootReal && !parent.startsWith(rootReal + path.sep)) {
        throw invalidInput(`Path escapes workspace root: ${target}`);
      }
      current = parent;
    }
  }
  throw invalidInput(`Exceeded ancestor search depth for path: ${target}`);
}

/**
 * Resolve a request path for reading an existing file.
 * Rejects with `not_found` if the target does not exist, `invalid_input` on
 * jail escape.
 */
async function resolveExisting(
  requested: string,
  rootReal: string
): Promise<string> {
  validateWorkspaceInputPath(requested);
  const lexical = path.resolve(rootReal, requested);
  // Lexical pre-check: reject traversal before we even touch the fs, so an
  // escape whose target happens to not exist still returns invalid_input
  // (not not_found).
  assertInsideRoot(lexical, rootReal);
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw notFound(`File not found: ${requested}`);
    }
    throw err;
  }
  assertInsideRoot(real, rootReal);
  return real;
}

/**
 * Resolve a request path for writing. Target may or may not exist. If it
 * exists, its realpath must be inside root. If it does not exist, the nearest
 * existing ancestor's realpath must be inside root, and the remaining
 * lexical tail is appended — catching symlink escape via the ancestor.
 */
async function resolveWriteTarget(
  requested: string,
  rootReal: string
): Promise<string> {
  validateWorkspaceInputPath(requested);
  const lexical = path.resolve(rootReal, requested);
  // Lexical pre-check before any fs access.
  assertInsideRoot(lexical, rootReal);

  // Fast path: target already exists → realpath it directly.
  try {
    const real = await fs.realpath(lexical);
    assertInsideRoot(real, rootReal);
    return real;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // Target does not exist — resolve nearest existing ancestor safely.
  const ancestorReal = await realpathExistingAncestor(lexical, rootReal);
  assertInsideRoot(ancestorReal, rootReal);

  // Reconstruct the final path: ancestorReal + (lexical relative to first
  // existing ancestor). We need the original lexical-relative tail, so walk
  // the same direction we did in realpathExistingAncestor but track the tail.
  const tail = computeMissingTail(lexical, ancestorReal, rootReal);
  const resolved = tail.length === 0 ? ancestorReal : path.join(ancestorReal, tail);

  // Final belt-and-braces prefix check.
  assertInsideRoot(resolved, rootReal);
  return resolved;
}

/**
 * Compute the portion of `lexical` that lives below the first existing
 * ancestor. We do this lexically by finding which ancestor of `lexical`
 * realpath-equals `ancestorReal`.
 */
function computeMissingTail(lexical: string, ancestorReal: string, rootReal: string): string {
  let current = lexical;
  const segments: string[] = [];
  for (let i = 0; i < 4096; i += 1) {
    let real: string;
    try {
      real = fsSync.realpathSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      segments.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) {
        throw invalidInput(`Cannot resolve tail for path: ${lexical}`);
      }
      current = parent;
      continue;
    }
    if (real === ancestorReal) {
      return segments.join(path.sep);
    }
    // First existing ancestor differs from the one we previously found —
    // reject rather than trust the difference.
    if (!real.startsWith(rootReal)) {
      throw invalidInput(`Ancestor realpath escapes root: ${lexical}`);
    }
    return segments.join(path.sep);
  }
  throw invalidInput(`Exceeded tail search depth for path: ${lexical}`);
}

export function createFileRpc(deps: FileRpcDeps): FileRpc {
  const { workspaceRoot } = deps;
  // Cache the realpath of the root so we only resolve it once per instance.
  // fs.realpath fails if the root itself does not exist — callers should
  // ensure the directory is provisioned before constructing the rpc.
  let rootRealPromise: Promise<string> | undefined;
  const getRootReal = (): Promise<string> => {
    if (!rootRealPromise) {
      rootRealPromise = fs.realpath(workspaceRoot);
    }
    return rootRealPromise;
  };

  return {
    async readFile(payload: ReadFilePayload): Promise<ReadFileResult> {
      const rootReal = await getRootReal();
      const target = await resolveExisting(payload.path, rootReal);
      try {
        const content = await fs.readFile(target);
        return { contentBase64: content.toString("base64") };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw notFound(`File not found: ${payload.path}`);
        }
        throw err;
      }
    },

    async writeFile(payload: WriteFilePayload): Promise<WriteFileResult> {
      const rootReal = await getRootReal();
      const target = await resolveWriteTarget(payload.path, rootReal);
      const buffer = Buffer.from(payload.contentBase64, "base64");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      return { ok: true, bytes: buffer.byteLength };
    },

    async listWorkspaceFiles(
      payload: ListWorkspaceFilesPayload
    ): Promise<ListWorkspaceFilesResult> {
      const rootReal = await getRootReal();
      const base = payload.subdir
        ? await resolveExisting(payload.subdir, rootReal)
        : rootReal;

      let dirents: Dirent<string>[];
      try {
        dirents = await fs.readdir(base, { withFileTypes: true, encoding: "utf8" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return { entries: [] };
        }
        throw err;
      }

      const entries = await Promise.all(
        dirents.map(async (dirent) => {
          const name = String(dirent.name);
          const fullPath = path.join(base, name);
          const relativePath = path.relative(rootReal, fullPath);
          let sizeBytes: number | undefined;
          if (dirent.isFile()) {
            try {
              const stat = await fs.stat(fullPath);
              sizeBytes = stat.size;
            } catch {
              // best-effort — missing stat is not fatal for a listing
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
  };
}
