import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ContextDocument, ContextManifest, ProjectRecord } from "./types";
import { ContextManifestSchema } from "./schemas";
import { ContextExtractor, inferSourceType } from "./contextExtractor";
import { StoragePaths } from "./storagePaths";
import { createId, nowIso, readJsonFile, relativeFrom, sanitizeFileSegment, slugify, writeJsonFile } from "./utils";

interface DocumentTarget {
  scope: "profile" | "project";
  projectSlug?: string;
}

type GetProject = (projectSlug: string) => Promise<ProjectRecord>;
type UpdateProject = (project: ProjectRecord) => Promise<ProjectRecord>;

/**
 * Handles document-manifest lifecycle: create, persist, read, and delete documents
 * within their respective manifest JSON files.
 */
export class ManifestStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly paths: StoragePaths,
    private readonly extractor: ContextExtractor
  ) {}

  async saveTextDocument(
    target: DocumentTarget,
    title: string,
    content: string,
    pinnedByDefault: boolean,
    note: string | undefined,
    getProject: GetProject,
    updateProject: UpdateProject
  ): Promise<ContextDocument> {
    const id = createId();
    const fileNameBase = sanitizeFileSegment(`${slugify(title)}-${id}`);
    const rawDir = this.paths.rawDirForScope(target.scope, target.projectSlug);
    const normalizedDir = this.paths.normalizedDirForScope(target.scope, target.projectSlug);
    const rawFilePath = path.join(rawDir, `${fileNameBase}.txt`);
    const normalizedFilePath = path.join(normalizedDir, `${fileNameBase}.md`);

    await fs.writeFile(rawFilePath, content, "utf8");
    await fs.writeFile(normalizedFilePath, content.trim(), "utf8");

    const document: ContextDocument = {
      id,
      scope: target.scope,
      projectSlug: target.projectSlug,
      title,
      sourceType: "text",
      rawPath: relativeFrom(this.workspaceRoot, rawFilePath),
      normalizedPath: relativeFrom(this.workspaceRoot, normalizedFilePath),
      pinnedByDefault,
      extractionStatus: "normalized",
      note: note?.trim() || undefined,
      createdAt: nowIso()
    };

    await this.persistDocument(target, document, getProject, updateProject);
    return document;
  }

  async importFileDocument(
    target: DocumentTarget,
    sourceFilePath: string,
    pinnedByDefault: boolean,
    note: string | undefined,
    getProject: GetProject,
    updateProject: UpdateProject
  ): Promise<ContextDocument> {
    const sourceType = inferSourceType(sourceFilePath);
    const id = createId();
    const originalExtension = path.extname(sourceFilePath);
    const fileNameBase = sanitizeFileSegment(`${path.basename(sourceFilePath, originalExtension)}-${id}`);
    const rawDir = this.paths.rawDirForScope(target.scope, target.projectSlug);
    const normalizedDir = this.paths.normalizedDirForScope(target.scope, target.projectSlug);
    const rawFilePath = path.join(rawDir, `${fileNameBase}${originalExtension.toLowerCase()}`);

    await fs.copyFile(sourceFilePath, rawFilePath);

    let normalizedPath: string | null = null;
    let extractionStatus: ContextDocument["extractionStatus"] = "rawOnly";
    try {
      const extracted = await this.extractor.extract(rawFilePath, sourceType);
      extractionStatus = extracted.extractionStatus;
      if (extracted.content) {
        const normalizedFilePath = path.join(normalizedDir, `${fileNameBase}.md`);
        await fs.writeFile(normalizedFilePath, extracted.content, "utf8");
        normalizedPath = relativeFrom(this.workspaceRoot, normalizedFilePath);
      }
    } catch (error) {
      extractionStatus = "failed";
      note = note ? `${note}\n\nExtraction error: ${(error as Error).message}` : `Extraction error: ${(error as Error).message}`;
    }

    const document: ContextDocument = {
      id,
      scope: target.scope,
      projectSlug: target.projectSlug,
      title: path.basename(sourceFilePath),
      sourceType,
      rawPath: relativeFrom(this.workspaceRoot, rawFilePath),
      normalizedPath,
      pinnedByDefault,
      extractionStatus,
      note: note?.trim() || undefined,
      createdAt: nowIso()
    };

    await this.persistDocument(target, document, getProject, updateProject);
    return document;
  }

  async importBufferDocument(
    target: DocumentTarget,
    fileName: string,
    bytes: Uint8Array,
    pinnedByDefault: boolean,
    note: string | undefined,
    getProject: GetProject,
    updateProject: UpdateProject
  ): Promise<ContextDocument> {
    const sourceType = inferSourceType(fileName);
    const id = createId();
    const originalExtension = path.extname(fileName);
    const fileNameBase = sanitizeFileSegment(`${path.basename(fileName, originalExtension)}-${id}`);
    const rawDir = this.paths.rawDirForScope(target.scope, target.projectSlug);
    const normalizedDir = this.paths.normalizedDirForScope(target.scope, target.projectSlug);
    const rawFilePath = path.join(rawDir, `${fileNameBase}${originalExtension.toLowerCase()}`);

    await fs.writeFile(rawFilePath, Buffer.from(bytes));

    let normalizedPath: string | null = null;
    let extractionStatus: ContextDocument["extractionStatus"] = "rawOnly";
    try {
      const extracted = await this.extractor.extract(rawFilePath, sourceType);
      extractionStatus = extracted.extractionStatus;
      if (extracted.content) {
        const normalizedFilePath = path.join(normalizedDir, `${fileNameBase}.md`);
        await fs.writeFile(normalizedFilePath, extracted.content, "utf8");
        normalizedPath = relativeFrom(this.workspaceRoot, normalizedFilePath);
      }
    } catch (error) {
      extractionStatus = "failed";
      note = note ? `${note}\n\nExtraction error: ${(error as Error).message}` : `Extraction error: ${(error as Error).message}`;
    }

    const document: ContextDocument = {
      id,
      scope: target.scope,
      projectSlug: target.projectSlug,
      title: path.basename(fileName),
      sourceType,
      rawPath: relativeFrom(this.workspaceRoot, rawFilePath),
      normalizedPath,
      pinnedByDefault,
      extractionStatus,
      note: note?.trim() || undefined,
      createdAt: nowIso()
    };

    await this.persistDocument(target, document, getProject, updateProject);
    return document;
  }

  async loadManifest(manifestPath: string): Promise<ContextManifest> {
    const raw = await readJsonFile(manifestPath, { documents: [] });
    return ContextManifestSchema.parse(raw);
  }

  async saveManifest(manifestPath: string, manifest: ContextManifest): Promise<void> {
    await writeJsonFile(manifestPath, ContextManifestSchema.parse(manifest));
  }

  private async persistDocument(
    target: DocumentTarget,
    document: ContextDocument,
    getProject: GetProject,
    updateProject: UpdateProject
  ): Promise<void> {
    const manifestPath = this.paths.manifestPathForScope(target.scope, target.projectSlug);
    const manifest = await this.loadManifest(manifestPath);
    manifest.documents.unshift(document);
    await this.saveManifest(manifestPath, manifest);

    if (target.scope === "project" && target.projectSlug && document.pinnedByDefault) {
      const project = await getProject(target.projectSlug);
      const pinned = new Set(project.pinnedDocumentIds);
      pinned.add(document.id);
      await updateProject({ ...project, pinnedDocumentIds: [...pinned] } as ProjectRecord);
    }
  }
}
