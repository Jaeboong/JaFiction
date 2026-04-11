import * as path from "node:path";

/**
 * Typed error used by the workspace path normalizer.
 * fileRpc.ts maps `code` through to the RPC dispatcher error taxonomy.
 */
export class WorkspacePathError extends Error {
  readonly code: "invalid_input";
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
    this.code = "invalid_input";
  }
}

/**
 * Pure (no fs access) input validation for a user-supplied workspace path.
 *
 * Rejects:
 *  - empty strings
 *  - null bytes (POSIX path truncation attack)
 *
 * Returns the input unchanged — fs-level realpath + prefix check happens in
 * fileRpc.ts where fs access is allowed.
 *
 * NFC/NFD: we pass through unchanged. On macOS HFS+/APFS the kernel handles
 * normalization; on Linux two differently-normalized names are genuinely
 * different files. This is the only behavior consistent across platforms.
 */
export function validateWorkspaceInputPath(requestedPath: string): string {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    throw new WorkspacePathError("Workspace path must be a non-empty string");
  }
  if (requestedPath.includes("\u0000")) {
    throw new WorkspacePathError("Workspace path must not contain null bytes");
  }
  return requestedPath;
}

/**
 * Computes all filesystem paths used by ForJobStorage.
 * Extracted to keep path logic in one place and reduce storage.ts size.
 */
export class StoragePaths {
  constructor(
    private readonly workspaceRoot: string,
    private readonly storageRootName: string
  ) {}

  get storageRoot(): string {
    return path.isAbsolute(this.storageRootName)
      ? this.storageRootName
      : path.join(this.workspaceRoot, this.storageRootName);
  }

  profileRawDir(): string {
    return path.join(this.storageRoot, "profile", "raw");
  }

  profileNormalizedDir(): string {
    return path.join(this.storageRoot, "profile", "normalized");
  }

  profileManifestPath(): string {
    return path.join(this.storageRoot, "profile", "manifest.json");
  }

  projectsDir(): string {
    return path.join(this.storageRoot, "projects");
  }

  projectDir(projectSlug: string): string {
    return path.join(this.projectsDir(), projectSlug);
  }

  projectRawDir(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "context", "raw");
  }

  projectNormalizedDir(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "context", "normalized");
  }

  projectContextManifestPath(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "context", "manifest.json");
  }

  projectRunsDir(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "runs");
  }

  projectInsightsDir(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "insights");
  }

  runDir(projectSlug: string, runId: string): string {
    return path.join(this.projectRunsDir(projectSlug), runId);
  }

  projectFilePath(projectSlug: string): string {
    return path.join(this.projectDir(projectSlug), "project.json");
  }

  providersDir(): string {
    return path.join(this.storageRoot, "providers");
  }

  providerStatusesPath(): string {
    return path.join(this.providersDir(), "status.json");
  }

  preferencesPath(): string {
    return path.join(this.storageRoot, "preferences.json");
  }

  rawDirForScope(scope: "profile" | "project", projectSlug?: string): string {
    return scope === "profile" ? this.profileRawDir() : this.projectRawDir(projectSlug!);
  }

  normalizedDirForScope(scope: "profile" | "project", projectSlug?: string): string {
    return scope === "profile" ? this.profileNormalizedDir() : this.projectNormalizedDir(projectSlug!);
  }

  manifestPathForScope(scope: "profile" | "project", projectSlug?: string): string {
    return scope === "profile" ? this.profileManifestPath() : this.projectContextManifestPath(projectSlug!);
  }
}
