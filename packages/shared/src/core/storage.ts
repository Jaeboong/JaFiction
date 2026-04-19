import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  AppPreferences,
  ContextDocument,
  OpenDartCandidate,
  ProjectInsightInput,
  ProjectEssayAnswerState,
  ProjectRecord,
  ProviderId,
  ProviderStatus,
  RunChatMessage,
  RunLedgerEntry,
  ReviewTurn,
  RunEvent,
  RunRecord
} from "./types";
import {
  AppPreferencesSchema,
  ProjectRecordSchema,
  ProviderStatusSchema
} from "./schemas";
import { ContextExtractor } from "./contextExtractor";
import {
  essayAnswerDocumentNote,
  essayAnswerDocumentTitle,
  reconcileEssayAnswerStates,
  upsertEssayAnswerState
} from "./essayQuestionWorkflow";
import {
  ensureDir,
  fileExists,
  nowIso,
  readJsonFile,
  relativeFrom,
  sanitizeFileSegment,
  slugify,
  writeJsonFile
} from "./utils";
import type { DocumentContentReader, ProviderStore, RunStore, StateStoreStorage } from "./storageInterfaces";
import { ManifestStore } from "./manifestStore";
import { RunRepository } from "./runRepository";
import { StoragePaths } from "./storagePaths";


export interface RunContinuationContext {
  record: RunRecord;
  summary?: string;
  improvementPlan?: string;
  revisedDraft?: string;
  notionBrief?: string;
  chatMessages?: RunChatMessage[];
}

export class ForJobStorage implements ProviderStore, DocumentContentReader, StateStoreStorage, RunStore {
  private readonly paths: StoragePaths;
  private readonly manifest: ManifestStore;
  private readonly runs: RunRepository;

  constructor(
    private readonly workspaceRoot: string,
    storageRootName: string,
    private readonly extractor: ContextExtractor = new ContextExtractor()
  ) {
    this.paths = new StoragePaths(workspaceRoot, storageRootName);
    this.manifest = new ManifestStore(workspaceRoot, this.paths, this.extractor);
    this.runs = new RunRepository(this.paths);
  }

  get storageRoot(): string {
    return this.paths.storageRoot;
  }

  async ensureInitialized(): Promise<void> {
    await Promise.all([
      ensureDir(this.paths.profileRawDir()),
      ensureDir(this.paths.profileNormalizedDir()),
      ensureDir(this.paths.projectsDir()),
      ensureDir(this.paths.providersDir())
    ]);

    if (!(await fileExists(this.paths.profileManifestPath()))) {
      await writeJsonFile(this.paths.profileManifestPath(), { documents: [] satisfies ContextDocument[] });
    }

    if (!(await fileExists(this.paths.providerStatusesPath()))) {
      await writeJsonFile(this.paths.providerStatusesPath(), {});
    }

    if (!(await fileExists(this.paths.preferencesPath()))) {
      await writeJsonFile(this.paths.preferencesPath(), {});
    }

    await this.runs.pruneExpiredRunLogs();
  }

  async listProfileDocuments(): Promise<ContextDocument[]> {
    const manifest = await this.manifest.loadManifest(this.paths.profileManifestPath());
    return manifest.documents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveProfileTextDocument(title: string, content: string, pinnedByDefault = false, note?: string): Promise<ContextDocument> {
    await this.ensureInitialized();
    return this.manifest.saveTextDocument({ scope: "profile" }, title, content, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async importProfileFile(sourceFilePath: string, pinnedByDefault = false, note?: string): Promise<ContextDocument> {
    await this.ensureInitialized();
    return this.manifest.importFileDocument({ scope: "profile" }, sourceFilePath, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async importProfileUpload(fileName: string, bytes: Uint8Array, pinnedByDefault = false, note?: string): Promise<ContextDocument> {
    await this.ensureInitialized();
    return this.manifest.importBufferDocument({ scope: "profile" }, fileName, bytes, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async setProfileDocumentPinned(documentId: string, pinned: boolean): Promise<void> {
    const manifestPath = this.paths.profileManifestPath();
    const mf = await this.manifest.loadManifest(manifestPath);
    mf.documents = mf.documents.map((document) =>
      document.id === documentId ? { ...document, pinnedByDefault: pinned } : document
    );
    await this.manifest.saveManifest(manifestPath, mf);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    try {
      const entries = await fs.readdir(this.paths.projectsDir(), { withFileTypes: true });
      const projects: ProjectRecord[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const projectPath = path.join(this.paths.projectsDir(), entry.name, "project.json");
        if (!(await fileExists(projectPath))) {
          continue;
        }

        const rawProject = await readJsonFile(projectPath, {});
        projects.push(ProjectRecordSchema.parse(rawProject));
      }

      return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async getProject(projectSlug: string): Promise<ProjectRecord> {
    const rawProject = await readJsonFile(this.paths.projectFilePath(projectSlug), {});
    return ProjectRecordSchema.parse(rawProject);
  }

  async createProject(
    inputOrCompanyName: ProjectInsightInput | string,
    roleName?: string,
    mainResponsibilities?: string,
    qualifications?: string
  ): Promise<ProjectRecord> {
    await this.ensureInitialized();
    const input = normalizeProjectInsightInput(inputOrCompanyName, roleName, mainResponsibilities, qualifications);
    const resolvedCompanyName = resolveProjectCompanyName(input);
    const baseSlug = slugify(resolveProjectSlugSeed(input));
    let slug = baseSlug;
    let counter = 1;

    while (await fileExists(this.paths.projectDir(slug))) {
      slug = `${baseSlug}-${counter += 1}`;
    }

    const now = nowIso();
    const project: ProjectRecord = {
      slug,
      companyName: resolvedCompanyName,
      roleName: input.roleName?.trim() || undefined,
      deadline: input.deadline?.trim() || undefined,
      overview: input.overview?.trim() || undefined,
      mainResponsibilities: input.mainResponsibilities?.trim() || undefined,
      qualifications: input.qualifications?.trim() || undefined,
      preferredQualifications: input.preferredQualifications?.trim() || undefined,
      benefits: input.benefits?.trim() || undefined,
      hiringProcess: input.hiringProcess?.trim() || undefined,
      insiderView: input.insiderView?.trim() || undefined,
      otherInfo: input.otherInfo?.trim() || undefined,
      keywords: sanitizeKeywords(input.keywords),
      jobPostingUrl: input.jobPostingUrl?.trim() || undefined,
      jobPostingText: input.jobPostingText?.trim() || undefined,
      essayQuestions: sanitizeQuestions(input.essayQuestions),
      openDartCorpCode: input.openDartCorpCode?.trim() || undefined,
      openDartCandidates: sanitizeOpenDartCandidates(input.openDartCandidates),
      openDartSkipRequested: input.openDartSkipRequested ? true : undefined,
      jobPostingManualFallback: false,
      rubric: defaultRubric(),
      pinnedDocumentIds: [],
      insightStatus: "idle",
      postingReviewReasons: [],
      jobPostingFieldConfidence: {},
      createdAt: now,
      updatedAt: now
    };

    await Promise.all([
      ensureDir(this.paths.projectRawDir(slug)),
      ensureDir(this.paths.projectNormalizedDir(slug)),
      ensureDir(this.paths.projectRunsDir(slug))
    ]);
    await writeJsonFile(this.paths.projectContextManifestPath(slug), { documents: [] satisfies ContextDocument[] });
    await writeJsonFile(this.paths.projectFilePath(slug), project);
    return project;
  }

  async updateProject(project: ProjectRecord): Promise<ProjectRecord> {
    const updated = { ...project, updatedAt: nowIso() };
    await writeJsonFile(this.paths.projectFilePath(project.slug), updated);
    return updated;
  }

  async updateProjectInfo(
    projectSlug: string,
    inputOrCompanyName: ProjectInsightInput | string,
    roleName?: string,
    mainResponsibilities?: string,
    qualifications?: string
  ): Promise<ProjectRecord> {
    const project = await this.getProject(projectSlug);
    const input = normalizeProjectInsightInput(inputOrCompanyName, roleName, mainResponsibilities, qualifications);
    const trimmedCompanyName = resolveProjectCompanyName(input, project.companyName);
    const hasRoleName = typeof inputOrCompanyName === "string"
      ? roleName !== undefined
      : hasOwnField(input, "roleName");
    const hasOverview = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "overview");
    const hasDeadline = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "deadline");
    const hasMainResponsibilities = typeof inputOrCompanyName === "string"
      ? mainResponsibilities !== undefined
      : hasOwnField(input, "mainResponsibilities");
    const hasQualifications = typeof inputOrCompanyName === "string"
      ? qualifications !== undefined
      : hasOwnField(input, "qualifications");
    const hasPreferredQualifications = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "preferredQualifications");
    const hasBenefits = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "benefits");
    const hasHiringProcess = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "hiringProcess");
    const hasInsiderView = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "insiderView");
    const hasOtherInfo = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "otherInfo");
    const hasKeywords = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "keywords");
    const hasJobPostingUrl = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "jobPostingUrl");
    const hasJobPostingText = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "jobPostingText");
    const hasEssayQuestions = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "essayQuestions");
    const hasOpenDartCorpCode = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "openDartCorpCode");
    const hasOpenDartCandidates = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "openDartCandidates");
    const hasOpenDartSkipRequested = typeof inputOrCompanyName === "string"
      ? false
      : hasOwnField(input, "openDartSkipRequested");

    const nextRoleName = hasRoleName ? input.roleName?.trim() || undefined : project.roleName;
    const nextDeadline = hasDeadline ? input.deadline?.trim() || undefined : project.deadline;
    const nextOverview = hasOverview ? input.overview?.trim() || undefined : project.overview;
    const nextMainResponsibilities = hasMainResponsibilities
      ? input.mainResponsibilities?.trim() || undefined
      : project.mainResponsibilities;
    const nextQualifications = hasQualifications ? input.qualifications?.trim() || undefined : project.qualifications;
    const nextPreferredQualifications = hasPreferredQualifications
      ? input.preferredQualifications?.trim() || undefined
      : project.preferredQualifications;
    const nextBenefits = hasBenefits ? input.benefits?.trim() || undefined : project.benefits;
    const nextHiringProcess = hasHiringProcess ? input.hiringProcess?.trim() || undefined : project.hiringProcess;
    const nextInsiderView = hasInsiderView ? input.insiderView?.trim() || undefined : project.insiderView;
    const nextOtherInfo = hasOtherInfo ? input.otherInfo?.trim() || undefined : project.otherInfo;
    const nextKeywords = hasKeywords ? sanitizeKeywords(input.keywords) : project.keywords;
    const nextJobPostingUrl = hasJobPostingUrl ? input.jobPostingUrl?.trim() || undefined : project.jobPostingUrl;
    const nextJobPostingText = hasJobPostingText ? input.jobPostingText?.trim() || undefined : project.jobPostingText;
    const nextQuestions = hasEssayQuestions ? sanitizeQuestions(input.essayQuestions) : project.essayQuestions;
    const nextOpenDartCorpCode = hasOpenDartCorpCode
      ? input.openDartCorpCode?.trim() || undefined
      : project.openDartCorpCode;
    const selectedCandidate = project.openDartCandidates?.find((candidate) => candidate.corpCode === nextOpenDartCorpCode);
    const nextOpenDartCorpName = hasOpenDartCorpCode
      ? selectedCandidate?.corpName ?? (nextOpenDartCorpCode ? project.openDartCorpName : undefined)
      : project.openDartCorpName;
    const nextOpenDartStockCode = hasOpenDartCorpCode
      ? selectedCandidate?.stockCode ?? (nextOpenDartCorpCode ? project.openDartStockCode : undefined)
      : project.openDartStockCode;
    const companyNameChanged = trimmedCompanyName !== project.companyName;
    const nextOpenDartCandidates = companyNameChanged
      ? undefined
      : hasOpenDartCandidates
        ? sanitizeOpenDartCandidates(input.openDartCandidates)
        : hasOpenDartCorpCode
          ? (nextOpenDartCorpCode ? project.openDartCandidates : undefined)
          : project.openDartCandidates;
    const nextOpenDartSkipRequested = companyNameChanged
      ? undefined
      : hasOpenDartSkipRequested
        ? (input.openDartSkipRequested ? true : undefined)
        : project.openDartSkipRequested;
    const nextAnswerStates = reconcileEssayAnswerStates(project.essayQuestions, nextQuestions, project.essayAnswerStates);
    const insightSourceChanged =
      companyNameChanged ||
      nextRoleName !== project.roleName ||
      nextDeadline !== project.deadline ||
      nextOverview !== project.overview ||
      nextMainResponsibilities !== project.mainResponsibilities ||
      nextQualifications !== project.qualifications ||
      nextPreferredQualifications !== project.preferredQualifications ||
      nextBenefits !== project.benefits ||
      nextHiringProcess !== project.hiringProcess ||
      nextInsiderView !== project.insiderView ||
      nextOtherInfo !== project.otherInfo ||
      JSON.stringify(nextKeywords ?? []) !== JSON.stringify(project.keywords ?? []) ||
      nextJobPostingUrl !== project.jobPostingUrl ||
      nextJobPostingText !== project.jobPostingText ||
      JSON.stringify(nextQuestions ?? []) !== JSON.stringify(project.essayQuestions ?? []) ||
      nextOpenDartCorpCode !== project.openDartCorpCode ||
      nextOpenDartSkipRequested !== project.openDartSkipRequested;

    for (const documentId of nextAnswerStates.removedDocumentIds) {
      await this.setProjectDocumentPinned(projectSlug, documentId, false);
    }

    const refreshedProject = nextAnswerStates.removedDocumentIds.length > 0
      ? await this.getProject(projectSlug)
      : project;

    return this.updateProject({
      ...refreshedProject,
      companyName: trimmedCompanyName,
      roleName: nextRoleName,
      deadline: nextDeadline,
      overview: nextOverview,
      mainResponsibilities: nextMainResponsibilities,
      qualifications: nextQualifications,
      preferredQualifications: nextPreferredQualifications,
      benefits: nextBenefits,
      hiringProcess: nextHiringProcess,
      insiderView: nextInsiderView,
      otherInfo: nextOtherInfo,
      keywords: nextKeywords,
      jobPostingUrl: nextJobPostingUrl,
      jobPostingText: nextJobPostingText,
      essayQuestions: nextQuestions,
      openDartCorpCode: nextOpenDartCorpCode,
      openDartCorpName: nextOpenDartCorpName,
      openDartStockCode: nextOpenDartStockCode,
      openDartCandidates: nextOpenDartCandidates,
      openDartSkipRequested: nextOpenDartSkipRequested,
      jobPostingManualFallback: refreshedProject.jobPostingManualFallback,
      insightStatus: insightSourceChanged && refreshedProject.insightLastGeneratedAt ? "reviewNeeded" : refreshedProject.insightStatus,
      insightLastError: insightSourceChanged ? undefined : refreshedProject.insightLastError,
      essayAnswerStates: nextAnswerStates.states
    });
  }

  async deleteProject(projectSlug: string): Promise<void> {
    await fs.rm(this.paths.projectDir(projectSlug), { recursive: true, force: true });
  }

  async updateProjectRubric(projectSlug: string, rubric: string): Promise<ProjectRecord> {
    const project = await this.getProject(projectSlug);
    return this.updateProject({ ...project, rubric });
  }

  async listProjectDocuments(projectSlug: string): Promise<ContextDocument[]> {
    const manifest = await this.manifest.loadManifest(this.paths.projectContextManifestPath(projectSlug));
    return manifest.documents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveProjectTextDocument(
    projectSlug: string,
    title: string,
    content: string,
    pinnedByDefault = false,
    note?: string
  ): Promise<ContextDocument> {
    await this.ensureInitialized();
    await this.ensureProjectDirs(projectSlug);
    return this.manifest.saveTextDocument({ scope: "project", projectSlug }, title, content, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async importProjectFile(projectSlug: string, sourceFilePath: string, pinnedByDefault = false, note?: string): Promise<ContextDocument> {
    await this.ensureInitialized();
    await this.ensureProjectDirs(projectSlug);
    return this.manifest.importFileDocument({ scope: "project", projectSlug }, sourceFilePath, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async importProjectUpload(
    projectSlug: string,
    fileName: string,
    bytes: Uint8Array,
    pinnedByDefault = false,
    note?: string
  ): Promise<ContextDocument> {
    await this.ensureInitialized();
    await this.ensureProjectDirs(projectSlug);
    return this.manifest.importBufferDocument({ scope: "project", projectSlug }, fileName, bytes, pinnedByDefault, note, (s) => this.getProject(s), (p) => this.updateProject(p));
  }

  async setProjectDocumentPinned(projectSlug: string, documentId: string, pinned: boolean): Promise<void> {
    const manifestPath = this.paths.projectContextManifestPath(projectSlug);
    const manifest = await this.manifest.loadManifest(manifestPath);
    manifest.documents = manifest.documents.map((document) =>
      document.id === documentId ? { ...document, pinnedByDefault: pinned } : document
    );
    await this.manifest.saveManifest(manifestPath, manifest);

    const project = await this.getProject(projectSlug);
    const current = new Set(project.pinnedDocumentIds);
    if (pinned) {
      current.add(documentId);
    } else {
      current.delete(documentId);
    }

    await this.updateProject({ ...project, pinnedDocumentIds: [...current] });
  }

  async getProfileDocument(documentId: string): Promise<ContextDocument> {
    const manifest = await this.manifest.loadManifest(this.paths.profileManifestPath());
    const document = manifest.documents.find((item) => item.id === documentId);
    if (!document) {
      throw new Error(`Profile document not found: ${documentId}`);
    }

    return document;
  }

  async getProjectDocument(projectSlug: string, documentId: string): Promise<ContextDocument> {
    const manifest = await this.manifest.loadManifest(this.paths.projectContextManifestPath(projectSlug));
    const document = manifest.documents.find((item) => item.id === documentId);
    if (!document) {
      throw new Error(`Project document not found: ${documentId}`);
    }

    return document;
  }

  async readDocumentRawContent(document: ContextDocument): Promise<string | undefined> {
    if (!["text", "txt", "md"].includes(document.sourceType)) {
      return undefined;
    }

    const filePath = this.resolveStoredPath(document.rawPath);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return fs.readFile(filePath, "utf8");
  }

  async readDocumentPreviewContent(
    document: ContextDocument
  ): Promise<{ content: string; previewSource: "normalized" | "raw" | "none" }> {
    const normalized = await this.readDocumentNormalizedContent(document);
    if (typeof normalized === "string") {
      return { content: normalized, previewSource: "normalized" };
    }

    const raw = await this.readDocumentRawContent(document);
    if (typeof raw === "string") {
      return { content: raw, previewSource: "raw" };
    }

    return { content: "", previewSource: "none" };
  }

  async updateProjectDocument(
    projectSlug: string,
    documentId: string,
    updates: {
      title: string;
      note?: string;
      pinnedByDefault: boolean;
      content?: string;
    }
  ): Promise<ContextDocument> {
    const manifestPath = this.paths.projectContextManifestPath(projectSlug);
    const manifest = await this.manifest.loadManifest(manifestPath);
    const documentIndex = manifest.documents.findIndex((item) => item.id === documentId);
    if (documentIndex < 0) {
      throw new Error(`Project document not found: ${documentId}`);
    }

    const existing = manifest.documents[documentIndex];
    const updated: ContextDocument = {
      ...existing,
      title: updates.title.trim() || existing.title,
      note: updates.note?.trim() || undefined,
      pinnedByDefault: updates.pinnedByDefault
    };

    if (updates.content !== undefined) {
      if (!["text", "txt", "md"].includes(existing.sourceType)) {
        throw new Error("Only text-based project documents can be edited in place.");
      }

      const rawFilePath = this.resolveStoredPath(existing.rawPath);
      await fs.writeFile(rawFilePath, updates.content, "utf8");

      const normalizedPath = existing.normalizedPath
        ? this.resolveStoredPath(existing.normalizedPath)
        : path.join(this.paths.projectNormalizedDir(projectSlug), `${sanitizeFileSegment(`${slugify(updated.title)}-${existing.id}`)}.md`);
      await fs.writeFile(normalizedPath, updates.content.trim(), "utf8");
      updated.normalizedPath = relativeFrom(this.workspaceRoot, normalizedPath);
      updated.extractionStatus = "normalized";
    }

    manifest.documents[documentIndex] = updated;
    await this.manifest.saveManifest(manifestPath, manifest);

    const project = await this.getProject(projectSlug);
    const pinned = new Set(project.pinnedDocumentIds);
    if (updated.pinnedByDefault) {
      pinned.add(updated.id);
    } else {
      pinned.delete(updated.id);
    }
    await this.updateProject({ ...project, pinnedDocumentIds: [...pinned] });
    return updated;
  }

  async deleteProjectDocument(projectSlug: string, documentId: string): Promise<void> {
    const manifestPath = this.paths.projectContextManifestPath(projectSlug);
    const manifest = await this.manifest.loadManifest(manifestPath);
    const document = manifest.documents.find((item) => item.id === documentId);
    if (!document) {
      throw new Error(`Project document not found: ${documentId}`);
    }

    manifest.documents = manifest.documents.filter((item) => item.id !== documentId);
    await this.manifest.saveManifest(manifestPath, manifest);

    const rawFilePath = this.resolveStoredPath(document.rawPath);
    await fs.rm(rawFilePath, { force: true });
    if (document.normalizedPath) {
      await fs.rm(this.resolveStoredPath(document.normalizedPath), { force: true });
    }

    const project = await this.getProject(projectSlug);
    const pinned = new Set(project.pinnedDocumentIds);
    pinned.delete(documentId);
    await this.updateProject({ ...project, pinnedDocumentIds: [...pinned] });
  }

  async loadProviderStatuses(): Promise<Record<ProviderId, ProviderStatus | undefined>> {
    const raw = await readJsonFile<Record<string, unknown>>(this.paths.providerStatusesPath(), {});
    const parsed: Record<ProviderId, ProviderStatus | undefined> = {
      codex: undefined,
      claude: undefined,
      gemini: undefined
    };

    for (const providerId of ["codex", "claude", "gemini"] as const) {
      const value = raw[providerId];
      if (value) {
        parsed[providerId] = ProviderStatusSchema.parse(value);
      }
    }

    return parsed;
  }

  async saveProviderStatus(status: ProviderStatus): Promise<void> {
    const current = await readJsonFile<Record<string, ProviderStatus>>(this.paths.providerStatusesPath(), {});
    current[status.providerId] = status;
    await writeJsonFile(this.paths.providerStatusesPath(), current);
  }

  async getPreferences(): Promise<AppPreferences> {
    const raw = await readJsonFile<Record<string, unknown>>(this.paths.preferencesPath(), {});
    return AppPreferencesSchema.parse(raw);
  }

  async setLastCoordinatorProvider(providerId: ProviderId): Promise<void> {
    const preferences = await this.getPreferences();
    await writeJsonFile(this.paths.preferencesPath(), { ...preferences, lastCoordinatorProvider: providerId });
  }

  async setLastReviewMode(reviewMode: AppPreferences["lastReviewMode"]): Promise<void> {
    const preferences = await this.getPreferences();
    await writeJsonFile(this.paths.preferencesPath(), { ...preferences, lastReviewMode: reviewMode });
  }

  async createRun(record: RunRecord): Promise<string> { return this.runs.createRun(record); }
  async updateRun(projectSlug: string, runId: string, updates: Partial<RunRecord>): Promise<RunRecord> { return this.runs.updateRun(projectSlug, runId, updates); }
  async getRun(projectSlug: string, runId: string): Promise<RunRecord> { return this.runs.getRun(projectSlug, runId); }
  async deleteRun(projectSlug: string, runId: string): Promise<void> { return this.runs.deleteRun(projectSlug, runId); }
  async listRuns(projectSlug: string): Promise<RunRecord[]> { return this.runs.listRuns(projectSlug); }
  async saveRunTextArtifact(projectSlug: string, runId: string, fileName: string, content: string): Promise<string> { return this.runs.saveRunTextArtifact(projectSlug, runId, fileName, content); }
  async saveProjectInsightJson(projectSlug: string, fileName: string, data: unknown): Promise<string> { return this.runs.saveProjectInsightJson(projectSlug, fileName, data); }
  async readProjectInsightJson<T>(projectSlug: string, fileName: string): Promise<T | undefined> { return this.runs.readProjectInsightJson<T>(projectSlug, fileName); }
  async appendRunEvent(projectSlug: string, runId: string, event: RunEvent): Promise<void> { return this.runs.appendRunEvent(projectSlug, runId, event); }
  async saveReviewTurns(projectSlug: string, runId: string, turns: ReviewTurn[]): Promise<void> { return this.runs.saveReviewTurns(projectSlug, runId, turns); }
  async loadReviewTurns(projectSlug: string, runId: string): Promise<ReviewTurn[] | undefined> { return this.runs.loadReviewTurns(projectSlug, runId); }
  async saveRunChatMessages(projectSlug: string, runId: string, messages: RunChatMessage[]): Promise<void> { return this.runs.saveRunChatMessages(projectSlug, runId, messages); }
  async loadRunChatMessages(projectSlug: string, runId: string): Promise<RunChatMessage[] | undefined> { return this.runs.loadRunChatMessages(projectSlug, runId); }
  async saveRunLedgers(projectSlug: string, runId: string, ledgers: RunLedgerEntry[]): Promise<void> { return this.runs.saveRunLedgers(projectSlug, runId, ledgers); }
  async loadRunLedgers(projectSlug: string, runId: string): Promise<RunLedgerEntry[] | undefined> { return this.runs.loadRunLedgers(projectSlug, runId); }
  async readOptionalRunArtifact(projectSlug: string, runId: string, fileName: string): Promise<string | undefined> { return this.runs.readOptionalRunArtifact(projectSlug, runId, fileName); }
  async loadRunContinuationContext(projectSlug: string, runId: string): Promise<RunContinuationContext> { return this.runs.loadRunContinuationContext(projectSlug, runId); }

  async readDocumentNormalizedContent(document: ContextDocument): Promise<string | undefined> {
    if (!document.normalizedPath) {
      return undefined;
    }

    const filePath = this.resolveStoredPath(document.normalizedPath);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return fs.readFile(filePath, "utf8");
  }

  resolveStoredPath(storedPath: string): string {
    return path.join(this.workspaceRoot, storedPath);
  }

  getRunArtifactPath(projectSlug: string, runId: string, fileName: string): string {
    return this.runs.getRunArtifactPath(projectSlug, runId, fileName);
  }

  async saveOrUpdateProjectGeneratedDocument(
    projectSlug: string,
    title: string,
    content: string,
    note: string,
    pinnedByDefault = true
  ): Promise<ContextDocument> {
    const existing = (await this.listProjectDocuments(projectSlug)).find((document) => document.title === title);
    if (!existing) {
      return this.saveProjectTextDocument(projectSlug, title, content, pinnedByDefault, note);
    }

    return this.updateProjectDocument(projectSlug, existing.id, {
      title,
      note,
      pinnedByDefault,
      content
    });
  }

  async saveCompletedEssayAnswer(
    projectSlug: string,
    questionIndex: number,
    question: string,
    answer: string,
    runId?: string
  ): Promise<{ document: ContextDocument; project: ProjectRecord; state: ProjectEssayAnswerState }> {
    await this.ensureInitialized();
    await this.ensureProjectDirs(projectSlug);

    const project = await this.getProject(projectSlug);
    const existingState = project.essayAnswerStates?.find((state) => state.questionIndex === questionIndex);
    const title = essayAnswerDocumentTitle(questionIndex);
    const note = essayAnswerDocumentNote(questionIndex, question);
    const content = answer.trim();
    const document = existingState?.documentId
      ? await this.updateProjectDocument(projectSlug, existingState.documentId, {
        title,
        note,
        pinnedByDefault: true,
        content
      })
      : await this.saveProjectTextDocument(projectSlug, title, content, true, note);

    const refreshedProject = await this.getProject(projectSlug);
    const state: ProjectEssayAnswerState = {
      questionIndex,
      status: "completed",
      documentId: document.id,
      completedAt: nowIso(),
      lastRunId: runId?.trim() || existingState?.lastRunId
    };
    const updatedProject = await this.updateProject({
      ...refreshedProject,
      essayAnswerStates: upsertEssayAnswerState(refreshedProject.essayAnswerStates, state)
    });

    return {
      document,
      project: updatedProject,
      state
    };
  }

  async reopenEssayAnswer(projectSlug: string, questionIndex: number): Promise<ProjectRecord> {
    await this.ensureInitialized();
    await this.ensureProjectDirs(projectSlug);

    const project = await this.getProject(projectSlug);
    const existingState = project.essayAnswerStates?.find((state) => state.questionIndex === questionIndex);
    if (!existingState) {
      return project;
    }

    const reopenedState: ProjectEssayAnswerState = {
      ...existingState,
      status: "drafting",
      completedAt: undefined,
      lastRunId: undefined
    };

    return this.updateProject({
      ...project,
      essayAnswerStates: upsertEssayAnswerState(project.essayAnswerStates, reopenedState)
    });
  }

  private async ensureProjectDirs(projectSlug: string): Promise<void> {
    await Promise.all([ensureDir(this.paths.projectRawDir(projectSlug)), ensureDir(this.paths.projectNormalizedDir(projectSlug)), ensureDir(this.paths.projectRunsDir(projectSlug))]);

    if (!(await fileExists(this.paths.projectContextManifestPath(projectSlug)))) {
      await writeJsonFile(this.paths.projectContextManifestPath(projectSlug), { documents: [] satisfies ContextDocument[] });
    }
  }

}

export function defaultRubric(): string {
  return [
    "- question fit",
    "- specificity/evidence",
    "- impact/metrics",
    "- role/company fit",
    "- clarity/structure",
    "- tone/authenticity"
  ].join("\n");
}

function sanitizeKeywords(keywords?: string[]): string[] | undefined {
  const values = (keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function sanitizeQuestions(questions?: string[]): string[] | undefined {
  const values = (questions ?? []).map((question) => question.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function sanitizeOpenDartCandidates(candidates?: OpenDartCandidate[]): OpenDartCandidate[] | undefined {
  const values = (candidates ?? [])
    .map((candidate) => ({
      corpCode: candidate.corpCode.trim(),
      corpName: candidate.corpName.trim(),
      stockCode: candidate.stockCode?.trim() || undefined
    }))
    .filter((candidate) => candidate.corpCode && candidate.corpName);
  return values.length > 0 ? values : undefined;
}

function hasOwnField(input: ProjectInsightInput, field: keyof ProjectInsightInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function normalizeProjectInsightInput(
  inputOrCompanyName: ProjectInsightInput | string,
  roleName?: string,
  mainResponsibilities?: string,
  qualifications?: string
): ProjectInsightInput {
  if (typeof inputOrCompanyName === "string") {
    return {
      companyName: inputOrCompanyName,
      roleName,
      mainResponsibilities,
      qualifications
    };
  }

  return inputOrCompanyName;
}

function resolveProjectCompanyName(input: ProjectInsightInput, existingCompanyName?: string): string {
  return [
    input.companyName?.trim(),
    existingCompanyName?.trim(),
    inferProjectLabelFromUrl(input.jobPostingUrl),
    input.roleName?.trim(),
    "새 프로젝트"
  ].find(Boolean) || "새 프로젝트";
}

function resolveProjectSlugSeed(input: ProjectInsightInput): string {
  return [
    input.companyName?.trim(),
    inferProjectLabelFromUrl(input.jobPostingUrl),
    input.roleName?.trim(),
    "project"
  ].find(Boolean) || "project";
}

function inferProjectLabelFromUrl(jobPostingUrl?: string): string | undefined {
  const value = jobPostingUrl?.trim();
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./i, "");
    const candidate = host.split(".")[0]?.trim();
    return candidate || undefined;
  } catch {
    return undefined;
  }
}
