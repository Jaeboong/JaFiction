import * as path from "node:path";
import { defaultRubric } from "../core/storage";
import { AgentDefaults, ProviderAuthStatus, ProviderId, ProviderRuntimeState } from "../core/types";
import { ProjectViewModel, RunSessionState, SidebarState, SidebarStateSchema } from "../core/viewModels";
import { ProviderStateReader, StateStoreStorage } from "../core/storageInterfaces";

interface StateStoreOptions {
  workspaceRoot?: string;
  storage?: StateStoreStorage;
  registry?: ProviderStateReader;
  openDartConfigured?: () => Promise<boolean>;
  agentDefaults?: () => Promise<AgentDefaults>;
  extensionVersion?: string;
}

export class SidebarStateStore {
  private providers: ProviderRuntimeState[] = [];
  private profileDocuments = [] as SidebarState["profileDocuments"];
  private projects: ProjectViewModel[] = [];
  private preferences: SidebarState["preferences"] = {};
  private agentDefaults: SidebarState["agentDefaults"] = {};
  private openDartConfigured = false;
  private openDartConnectionStatus: ProviderAuthStatus = "untested";
  private openDartLastCheckAt?: string;
  private openDartLastError?: string;
  private busyMessage?: string;
  private runState: RunSessionState = { status: "idle" };

  constructor(private readonly options: StateStoreOptions) {}

  async initialize(): Promise<void> {
    if (!this.options.storage) {
      return;
    }

    await this.options.storage.ensureInitialized();
    await Promise.all([
      this.refreshProviders(true),
      this.refreshOpenDartConfigured(),
      this.refreshProfileDocuments(),
      this.refreshProjects(),
      this.refreshPreferences(),
      this.refreshAgentDefaults()
    ]);
  }

  async refreshAll(options: { refreshProviders?: boolean } = {}): Promise<void> {
    if (!this.options.storage) {
      return;
    }

    await Promise.all([
      this.refreshProviders(Boolean(options.refreshProviders)),
      this.refreshOpenDartConfigured(),
      this.refreshProfileDocuments(),
      this.refreshProjects(),
      this.refreshPreferences(),
      this.refreshAgentDefaults()
    ]);
  }

  async refreshProviders(refresh = false): Promise<void> {
    if (!this.options.registry) {
      this.providers = [];
      return;
    }

    this.providers = await this.options.registry.listRuntimeStates({ refresh });
  }

  async refreshProvider(providerId: ProviderId): Promise<void> {
    if (!this.options.registry) {
      return;
    }

    const nextState = await this.options.registry.refreshRuntimeState(providerId);
    const next = new Map(this.providers.map((provider) => [provider.providerId, provider]));
    next.set(providerId, nextState);
    this.providers = [...next.values()];
  }

  async refreshProfileDocuments(): Promise<void> {
    this.profileDocuments = this.options.storage ? await this.options.storage.listProfileDocuments() : [];
  }

  async refreshPreferences(): Promise<void> {
    this.preferences = this.options.storage ? await this.options.storage.getPreferences() : {};
  }

  async refreshAgentDefaults(): Promise<void> {
    this.agentDefaults = this.options.agentDefaults ? await this.options.agentDefaults() : {};
  }

  async refreshOpenDartConfigured(): Promise<void> {
    this.openDartConfigured = this.options.openDartConfigured ? await this.options.openDartConfigured() : false;
  }

  async refreshProjects(projectSlug?: string): Promise<void> {
    if (!this.options.storage) {
      this.projects = [];
      return;
    }

    const records = await this.options.storage.listProjects();
    const cachedBySlug = new Map(this.projects.map((project) => [project.record.slug, project]));
    const shouldReuseCache = projectSlug && this.projects.length > 0;
    const nextProjects: ProjectViewModel[] = [];

    for (const record of records) {
      const cached = cachedBySlug.get(record.slug);
      if (shouldReuseCache && cached && record.slug !== projectSlug) {
        nextProjects.push({
          ...cached,
          record
        });
        continue;
      }

      nextProjects.push(await this.loadProject(record.slug, record));
    }

    this.projects = nextProjects;
  }

  setBusyMessage(message?: string): void {
    this.busyMessage = message;
  }

  setRunState(state: RunSessionState): void {
    this.runState = state;
  }

  setOpenDartConnectionState(state: {
    status: ProviderAuthStatus;
    lastCheckAt?: string;
    lastError?: string;
  }): void {
    this.openDartConnectionStatus = state.status;
    this.openDartLastCheckAt = state.lastCheckAt;
    this.openDartLastError = state.lastError;
  }

  snapshot(): SidebarState {
    return SidebarStateSchema.parse({
      workspaceOpened: Boolean(this.options.storage && this.options.workspaceRoot),
      storageRoot: this.options.storage && this.options.workspaceRoot
        ? path.relative(this.options.workspaceRoot, this.options.storage.storageRoot) || "."
        : undefined,
      extensionVersion: this.options.extensionVersion || "0.0.0",
      openDartConfigured: this.openDartConfigured,
      openDartConnectionStatus: this.openDartConnectionStatus,
      openDartLastCheckAt: this.openDartLastCheckAt,
      openDartLastError: this.openDartLastError,
      providers: this.providers,
      profileDocuments: this.profileDocuments,
      projects: this.projects,
      preferences: this.preferences,
      agentDefaults: this.agentDefaults,
      busyMessage: this.busyMessage,
      runState: this.runState,
      defaultRubric: defaultRubric()
    });
  }

  private async loadProject(projectSlug: string, record?: ProjectViewModel["record"]): Promise<ProjectViewModel> {
    if (!this.options.storage) {
      throw new Error("Storage is unavailable.");
    }

    const projectRecord = record ?? (await this.options.storage.getProject(projectSlug));
    const [documents, runs] = await Promise.all([
      this.options.storage.listProjectDocuments(projectSlug),
      this.options.storage.listRuns(projectSlug)
    ]);
    const essayAnswerStates = await Promise.all(
      (projectRecord.essayAnswerStates ?? []).map(async (state) => {
        const document = state.documentId ? documents.find((item) => item.id === state.documentId) : undefined;
        const content = document ? await this.options.storage!.readDocumentRawContent(document) : undefined;
        return {
          ...state,
          content: content?.trim() ? content : undefined
        };
      })
    );

    const runPreviews = await Promise.all(
      runs.map(async (run) => {
        const [summary, improvementPlan, revisedDraft, finalChecks, discussionLedger, promptMetrics, notionBrief, chatMessages, events] = await Promise.all([
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "summary.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "improvement-plan.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "revised-draft.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "final-checks.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "discussion-ledger.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "prompt-metrics.json"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "notion-brief.md"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "chat-messages.json"),
          this.options.storage!.readOptionalRunArtifact(projectSlug, run.id, "run-log.txt")
        ]);

        return {
          record: run,
          summaryPreview: (summary || finalChecks || (run.reviewMode === "realtime" ? revisedDraft : undefined))?.slice(0, 400),
          artifacts: {
            summary: Boolean(summary),
            improvementPlan: Boolean(improvementPlan),
            revisedDraft: Boolean(revisedDraft),
            finalChecks: Boolean(finalChecks),
            discussionLedger: Boolean(discussionLedger),
            promptMetrics: Boolean(promptMetrics),
            notionBrief: Boolean(notionBrief),
            chatMessages: Boolean(chatMessages),
            events: Boolean(events)
          }
        };
      })
    );

    return {
      record: projectRecord,
      documents,
      essayAnswerStates,
      runs: runPreviews
    };
  }
}
