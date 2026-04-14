import type {
  AgentDefaults,
  AbortRunResult,
  AnalyzeInsightsResult,
  AnalyzePostingResult,
  CallProviderTestResult,
  CompleteRunResult,
  ContextDocument,
  CreateProjectResult,
  DeleteDocumentResult,
  DeleteProjectResult,
  DeleteRunResult,
  GenerateInsightsResult,
  GetAgentDefaultsResult,
  GetProjectInsightsResult,
  GetRunMessagesResult,
  JobPostingExtractionResult,
  ListProjectsResult,
  OpName,
  ProfileGetDocumentPreviewResult,
  ProfileListDocumentsResult,
  ProfileSaveTextDocumentResult,
  ProfileSetDocumentPinnedResult,
  ProjectInsightWorkspaceState,
  ProjectRecord,
  ProviderId,
  ProviderRuntimeState,
  ResumeRunResult,
  SaveDocumentResult,
  SaveEssayDraftResult,
  SaveProjectResult,
  SidebarState,
  StartRunResult,
  SubmitInterventionResult
} from "@jasojeon/shared";

export interface SessionPayload {
  state: SidebarState;
  storageRoot: string;
}

/**
 * Discriminated bootstrap error. The bootstrap path maps each failure mode
 * onto one of four reasons so App.tsx can render a targeted gate (login CTA,
 * device onboarding, network retry, unknown) instead of a monolithic loading
 * card that traps the user with no way out.
 *
 *  - "auth_required" : backend returned 401 (session missing/expired)
 *  - "device_offline": backend returned ok:false { code: "device_offline" }
 *    or /api/session reported no active runner
 *  - "network_error" : fetch threw (CORS, DNS, offline, TLS)
 *  - "unknown"       : any other failure shape
 */
export type RunnerBootstrapErrorReason =
  | "auth_required"
  | "device_offline"
  | "network_error"
  | "unknown";

export class RunnerBootstrapError extends Error {
  readonly reason: RunnerBootstrapErrorReason;

  constructor(reason: RunnerBootstrapErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RunnerBootstrapError";
    this.reason = reason;
  }
}

interface RpcResponseOkShape {
  readonly v: 1;
  readonly id: string;
  readonly ok: true;
  readonly result: unknown;
}

interface RpcResponseErrShape {
  readonly v: 1;
  readonly id: string;
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

type RpcResponseShape = RpcResponseOkShape | RpcResponseErrShape;

function generateRpcId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class RunnerClient {
  constructor(readonly baseUrl: string) {}

  static async bootstrap(baseUrl: string): Promise<SessionPayload> {
    // Hosted mode derives the initial state via a direct POST to /api/rpc so
    // we can inspect the HTTP status and the RPC envelope `error.code` to map
    // onto RunnerBootstrapErrorReason.
    const id = generateRpcId();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/rpc`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: 1, id, op: "get_state", payload: {} })
      });
    } catch (error) {
      throw new RunnerBootstrapError(
        "network_error",
        `Runner bootstrap network error: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
    if (response.status === 401) {
      throw new RunnerBootstrapError("auth_required", "Hosted session not authenticated.");
    }
    if (!response.ok) {
      throw new RunnerBootstrapError(
        "unknown",
        `Hosted bootstrap failed (${response.status}).`
      );
    }
    const envelope = await response.json().catch(() => undefined) as RpcResponseShape | undefined;
    if (!envelope) {
      throw new RunnerBootstrapError("unknown", "Hosted bootstrap returned an invalid envelope.");
    }
    if (envelope.ok === false) {
      if (envelope.error.code === "device_offline") {
        throw new RunnerBootstrapError("device_offline", envelope.error.message);
      }
      throw new RunnerBootstrapError("unknown", envelope.error.message || "Hosted bootstrap failed.");
    }
    return { state: envelope.result as SidebarState, storageRoot: "" };
  }

  async fetchState(): Promise<SidebarState> {
    return this.rpcCall<SidebarState>("get_state", {});
  }

  async getAgentDefaults(): Promise<AgentDefaults> {
    const result = await this.rpcCall<GetAgentDefaultsResult>("get_agent_defaults", {});
    return result.agentDefaults;
  }

  async saveAgentDefaults(agentDefaults: AgentDefaults): Promise<void> {
    await this.rpcCall("save_agent_defaults", { agentDefaults });
  }

  async listProjects(): Promise<ListProjectsResult> {
    return this.rpcCall<ListProjectsResult>("list_projects", {});
  }

  async createProject(payload: Record<string, unknown>): Promise<ProjectRecord> {
    const result = await this.rpcCall<CreateProjectResult>("create_project", payload);
    return result as ProjectRecord;
  }

  async deleteProject(projectSlug: string): Promise<void> {
    await this.rpcCall<DeleteProjectResult>("delete_project", { slug: projectSlug });
  }

  async saveProjectDocument(projectSlug: string, payload: Record<string, unknown>): Promise<void> {
    await this.rpcCall<SaveDocumentResult>("save_document", {
      slug: projectSlug,
      title: String(payload.title ?? ""),
      content: typeof payload.content === "string" ? payload.content : "",
      note: typeof payload.note === "string" ? payload.note : undefined,
      pinnedByDefault: typeof payload.pinnedByDefault === "boolean" ? payload.pinnedByDefault : undefined
    });
  }

  async saveEssayDraft(projectSlug: string, questionIndex: number, draft: string): Promise<{ questionIndex: number }> {
    return this.rpcCall<SaveEssayDraftResult>("save_essay_draft", {
      slug: projectSlug,
      questionIndex,
      draft
    });
  }

  // ---------------------------------------------------------------------------
  // Stage 11.8 — profile document hosted parity
  // ---------------------------------------------------------------------------

  async listProfileDocuments(): Promise<readonly ContextDocument[]> {
    const result = await this.rpcCall<ProfileListDocumentsResult>("profile_list_documents", {});
    return result.documents;
  }

  async saveProfileTextDocument(opts: {
    title: string;
    content: string;
    note?: string;
    pinnedByDefault?: boolean;
  }): Promise<ContextDocument> {
    const payload: { title: string; content: string; note?: string; pinnedByDefault?: boolean } = {
      title: opts.title,
      content: opts.content
    };
    if (opts.note !== undefined) {
      payload.note = opts.note;
    }
    if (opts.pinnedByDefault !== undefined) {
      payload.pinnedByDefault = opts.pinnedByDefault;
    }
    const result = await this.rpcCall<ProfileSaveTextDocumentResult>("profile_save_text_document", payload);
    return result.document;
  }

  async setProfileDocumentPinned(documentId: string, pinned: boolean): Promise<ContextDocument> {
    const result = await this.rpcCall<ProfileSetDocumentPinnedResult>("profile_set_document_pinned", {
      documentId,
      pinned
    });
    return result.document;
  }

  async getProfileDocumentPreview(documentId: string): Promise<ProfileGetDocumentPreviewResult> {
    return this.rpcCall<ProfileGetDocumentPreviewResult>("profile_get_document_preview", { documentId });
  }

  async uploadProfileDocument(file: File, opts: { note?: string; pinnedByDefault?: boolean } = {}): Promise<ContextDocument> {
    const { uploadProfileFileInChunks } = await import("./hostedProfileUpload");
    return uploadProfileFileInChunks({
      client: this,
      file,
      note: opts.note,
      pinnedByDefault: opts.pinnedByDefault
    });
  }

  async uploadProjectDocuments(projectSlug: string, files: File[]): Promise<void> {
    // Dynamic import avoids pulling the chunked uploader into bundles that
    // don't touch the uploader path.
    const { uploadFileInChunks } = await import("./hostedUpload");
    for (const file of files) {
      await uploadFileInChunks({
        client: this,
        slug: projectSlug,
        file
      });
    }
  }

  async uploadProjectFile(
    projectSlug: string,
    file: File,
    opts: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {}
  ): Promise<string> {
    const { uploadFileInChunks } = await import("./hostedUpload");
    const result = await uploadFileInChunks({
      client: this,
      slug: projectSlug,
      file,
      onProgress: opts.onProgress,
      signal: opts.signal
    });
    return result.docId;
  }

  async updateProject(projectSlug: string, payload: Record<string, unknown>): Promise<SaveProjectResult | unknown> {
    return this.rpcCall<SaveProjectResult>("save_project", { slug: projectSlug, patch: payload });
  }

  async deleteProjectDocument(projectSlug: string, documentId: string): Promise<void> {
    await this.rpcCall<DeleteDocumentResult>("delete_document", { slug: projectSlug, docId: documentId });
  }

  async getProjectInsights(projectSlug: string): Promise<ProjectInsightWorkspaceState> {
    const result = await this.rpcCall<GetProjectInsightsResult>("get_project_insights", { slug: projectSlug });
    return result as ProjectInsightWorkspaceState;
  }

  async analyzeProjectPosting(payload: Record<string, unknown>): Promise<JobPostingExtractionResult> {
    const result = await this.rpcCall<AnalyzePostingResult>("analyze_posting", {
      jobPostingUrl: typeof payload.jobPostingUrl === "string" ? payload.jobPostingUrl : undefined,
      jobPostingText: typeof payload.jobPostingText === "string" ? payload.jobPostingText : undefined,
      companyName: typeof payload.companyName === "string" ? payload.companyName : undefined,
      roleName: typeof payload.roleName === "string" ? payload.roleName : undefined
    });
    return result as unknown as JobPostingExtractionResult;
  }

  async testProvider(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const result = await this.rpcCall<CallProviderTestResult>("call_provider_test", { provider: providerId });
    if (result.runtimeState) {
      return result.runtimeState;
    }
    return this.refetchProviderRuntimeState(providerId);
  }

  async startProviderCliAuth(providerId: ProviderId): Promise<{ success: boolean; authUrl?: string; message?: string }> {
    return this.rpcCall("start_provider_cli_auth", { providerId });
  }

  async submitProviderCliCode(providerId: ProviderId, code: string): Promise<{ success: boolean; message?: string }> {
    return this.rpcCall("submit_provider_cli_code", { providerId, code });
  }

  async logoutProvider(providerId: ProviderId): Promise<{ ok: boolean; message?: string }> {
    return this.rpcCall("call_provider_logout", { providerId });
  }

  async updateProviderConfig(providerId: ProviderId, payload: Record<string, unknown>): Promise<ProviderRuntimeState> {
    const config = {
      authMode: typeof payload.authMode === "string" ? payload.authMode as "cli" | "apiKey" : undefined,
      model: typeof payload.model === "string" ? payload.model : undefined,
      effort: typeof payload.effort === "string" ? payload.effort : undefined,
      command: typeof payload.command === "string" ? payload.command : undefined
    };
    await this.rpcCall("save_provider_config", { provider: providerId, config });
    return this.refetchProviderRuntimeState(providerId);
  }

  async saveProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderRuntimeState> {
    await this.rpcCall("save_provider_api_key", { provider: providerId, key: apiKey });
    return this.refetchProviderRuntimeState(providerId);
  }

  async clearProviderApiKey(providerId: ProviderId): Promise<void> {
    await this.rpcCall("clear_provider_api_key", { provider: providerId });
  }

  async checkNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    await this.rpcCall("notion_check", { provider: providerId });
    return this.refetchProviderRuntimeState(providerId);
  }

  async connectNotion(providerId: ProviderId, token?: string): Promise<ProviderRuntimeState> {
    const payload: Record<string, string> = { provider: providerId };
    if (token) payload.token = token;
    await this.rpcCall("notion_connect", payload);
    return this.refetchProviderRuntimeState(providerId);
  }

  async disconnectNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    await this.rpcCall("notion_disconnect", { provider: providerId });
    return this.refetchProviderRuntimeState(providerId);
  }

  /**
   * Shape-wrap helper. Hosted-mode write ops on Provider/Notion return
   * `{ok: true}` but the UI contract on RunnerClient methods is a
   * `ProviderRuntimeState`. After a write succeeds we refetch the full
   * sidebar state via `get_state` and extract the provider slice, preserving
   * the pre-hosted interface. The subsequent `state_snapshot` WS event still
   * wins if the runner pushes a newer state — that's the authoritative path.
   */
  private async refetchProviderRuntimeState(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const state = await this.rpcCall<SidebarState>("get_state", {});
    const runtime = state.providers.find((p) => p.providerId === providerId);
    if (!runtime) {
      throw new Error(`Provider runtime state not found for ${providerId}`);
    }
    return runtime;
  }

  async startRun(projectSlug: string, payload: Record<string, unknown>): Promise<StartRunResult> {
    return this.rpcCall<StartRunResult>("start_run", { slug: projectSlug, ...payload });
  }

  async deleteRun(_projectSlug: string, runId: string): Promise<void> {
    await this.rpcCall<DeleteRunResult>("delete_run", { slug: _projectSlug, runId });
  }

  async getRunMessages(_projectSlug: string, runId: string): Promise<GetRunMessagesResult> {
    return this.rpcCall<GetRunMessagesResult>("get_run_messages", { runId });
  }

  async testOpenDartConnection(): Promise<{ ok: boolean; message: string }> {
    const result = await this.rpcCall<{ ok: boolean; sample?: string }>("opendart_test", {});
    // Shape-wrap: hosted result is {ok, sample?}, but the UI contract is
    // {ok, message}. On success surface the sample (first 500 chars of a
    // resolved company payload) as the message; on failure leave blank.
    return { ok: result.ok, message: result.sample ?? "" };
  }

  async submitIntervention(
    runId: string,
    message: string
  ): Promise<SubmitInterventionResult> {
    return this.rpcCall<SubmitInterventionResult>("submit_intervention", {
      runId,
      text: message
    });
  }

  async abortRun(runId: string): Promise<AbortRunResult | unknown> {
    return this.rpcCall<AbortRunResult>("abort_run", { runId });
  }

  async completeRun(_projectSlug: string, runId: string): Promise<CompleteRunResult | unknown> {
    return this.rpcCall<CompleteRunResult>("complete_run", { runId });
  }

  async resumeRun(
    _projectSlug: string,
    runId: string,
    message = ""
  ): Promise<ResumeRunResult> {
    const payload: { runId: string; message?: string } = { runId };
    if (message) {
      payload.message = message;
    }
    return this.rpcCall<ResumeRunResult>("resume_run", payload);
  }

  async analyzeInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectRecord | undefined> {
    // Kickoff pattern: op returns {jobId} immediately. The final state
    // arrives via a subsequent state_snapshot event that overwrites the
    // sidebar. Return undefined — callers should not rely on a synchronous
    // ProjectRecord from analyze_insights.
    await this.rpcCall<AnalyzeInsightsResult>("analyze_insights", {
      slug: projectSlug,
      patch: Object.keys(payload).length > 0 ? payload : undefined
    });
    return undefined;
  }

  async generateInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectInsightWorkspaceState> {
    // Kickoff pattern: op returns {jobId}. We immediately return the
    // *current* insights workspace so the UI can swap to a pending badge.
    // A follow-up state_snapshot triggers the UI to refetch when ready.
    await this.rpcCall<GenerateInsightsResult>("generate_insights", {
      slug: projectSlug,
      patch: Object.keys(payload).length > 0 ? payload : undefined
    });
    return this.getProjectInsights(projectSlug);
  }

  /**
   * Sends a single RPC envelope to POST /api/rpc and returns the unwrapped
   * `result`.
   */
  async rpcCall<TResult = unknown>(op: OpName, payload: unknown): Promise<TResult> {
    const id = generateRpcId();
    const response = await fetch(`${this.baseUrl}/api/rpc`, {
      credentials: "include",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, id, op, payload })
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new RunnerBootstrapError("auth_required", "세션이 만료되었습니다. 다시 로그인해 주세요.");
      }
      if (response.status === 413) {
        throw new RunnerBootstrapError("unknown", `RPC ${op}: 요청 페이로드가 너무 큽니다 (413).`);
      }
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const message = typeof body["message"] === "string"
        ? body["message"]
        : `RPC ${op} failed (${response.status})`;
      throw new Error(message);
    }

    const envelope = await response.json() as RpcResponseShape;
    if (envelope.ok === false) {
      throw new Error(envelope.error.message || `RPC ${op} failed`);
    }
    return envelope.result as TResult;
  }

}

// ---------------------------------------------------------------------------
// BackendClient — typed client for the hosted backend API (Phase 5+)
// ---------------------------------------------------------------------------

export interface DeviceInfo {
  readonly id: string;
  readonly label: string;
  readonly hostname: string | null;
  readonly os: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

export type ApproveDeviceClaimResult =
  | { readonly status: "approved"; readonly deviceId: string; readonly label: string }
  | { readonly status: "authorized"; readonly deviceId: string }
  | { readonly status: "no_claim" }
  | { readonly status: "multiple_claims"; readonly claims: ReadonlyArray<{ readonly claimId: string; readonly hostname: string; readonly os: string }> };

export class BackendClient {
  constructor(readonly baseUrl: string) {}

  async fetchCurrentUser(): Promise<{ readonly id: string; readonly email: string }> {
    const response = await fetch(`${this.baseUrl}/auth/me`, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to fetch current user (${response.status})`);
    }
    return response.json() as Promise<{ id: string; email: string }>;
  }

  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/auth/logout`, {
      credentials: "include",
      method: "POST",
    });
  }

  async approveDeviceClaim(claimId?: string): Promise<ApproveDeviceClaimResult> {
    return this.request<ApproveDeviceClaimResult>("/api/device-claim/approve", {
      method: "POST",
      body: claimId !== undefined ? { claimId } : {},
    });
  }

  async listDevices(): Promise<readonly DeviceInfo[]> {
    const result = await this.request<{ devices: DeviceInfo[] }>("/api/devices");
    return result.devices;
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request(`/api/devices/${id}/revoke`, { method: "POST" });
  }

  async deleteAccount(): Promise<void> {
    await this.request("/api/me", { method: "DELETE" });
  }

  private async request<T = unknown>(
    pathname: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const hasBody = init.body !== undefined;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      credentials: "include",
      method: init.method ?? "GET",
      headers: hasBody ? { "Content-Type": "application/json" } : {},
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const message =
        typeof payload["message"] === "string"
          ? payload["message"]
          : `Request failed (${response.status})`;
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}
