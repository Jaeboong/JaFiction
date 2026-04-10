import * as path from "node:path";

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
