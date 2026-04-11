import type {
  AgentDefaults,
  AbortRunResult,
  CompleteRunResult,
  DeleteDocumentResult,
  GetAgentDefaultsResult,
  GetRunMessagesResult,
  JobPostingExtractionResult,
  ListProjectsResult,
  OpName,
  OpendartSaveKeyResult,
  ProjectInsightWorkspaceState,
  ProjectRecord,
  ProviderId,
  ProviderRuntimeState,
  SaveProjectResult,
  SidebarState,
  StartRunResult
} from "@jasojeon/shared";

export interface SessionPayload {
  state: SidebarState;
  storageRoot: string;
}

export type RunnerClientMode = "local" | "hosted";

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
  readonly mode: RunnerClientMode;

  constructor(readonly baseUrl: string, mode: RunnerClientMode = "local") {
    this.mode = mode;
  }

  static async bootstrap(baseUrl: string, mode: RunnerClientMode = "local"): Promise<SessionPayload> {
    if (mode === "hosted") {
      // Hosted mode has no /api/session endpoint; derive the initial state
      // via the same RPC dispatcher the rest of the client uses.
      const tempClient = new RunnerClient(baseUrl, "hosted");
      const state = await tempClient.rpcCall<SidebarState>("get_state", {});
      return { state, storageRoot: "" };
    }

    const response = await fetch(`${baseUrl}/api/session`, {
      credentials: "include"
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = typeof payload.message === "string"
        ? payload.message
        : `Runner session bootstrap failed (${response.status}).`;
      throw new Error(message);
    }
    return response.json() as Promise<SessionPayload>;
  }

  async fetchState(): Promise<SidebarState> {
    if (this.mode === "hosted") {
      return this.rpcCall<SidebarState>("get_state", {});
    }
    return this.request<SidebarState>("/api/state");
  }

  async getAgentDefaults(): Promise<AgentDefaults> {
    if (this.mode === "hosted") {
      const result = await this.rpcCall<GetAgentDefaultsResult>("get_agent_defaults", {});
      return result.agentDefaults;
    }
    const payload = await this.request<{ agentDefaults: AgentDefaults }>("/api/config/agent-defaults");
    return payload.agentDefaults;
  }

  async saveAgentDefaults(agentDefaults: AgentDefaults): Promise<void> {
    await this.request("/api/config/agent-defaults", {
      method: "PUT",
      body: { agentDefaults }
    });
  }

  createStateSocket(): WebSocket {
    if (this.mode === "hosted") {
      return new WebSocket(toWsUrl(this.baseUrl, "/ws/events"));
    }
    return new WebSocket(toWsUrl(this.baseUrl, "/ws/state"));
  }

  createRunSocket(runId: string): WebSocket {
    if (this.mode === "hosted") {
      // Hosted mode multiplexes all events (state, run, intervention, finished)
      // through a single /ws/events endpoint scoped to the session cookie.
      // Callers filter frames by envelope.event on the client side.
      void runId;
      return new WebSocket(toWsUrl(this.baseUrl, "/ws/events"));
    }
    return new WebSocket(toWsUrl(this.baseUrl, `/ws/runs/${runId}`));
  }

  async listProjects(): Promise<ListProjectsResult> {
    if (this.mode === "hosted") {
      return this.rpcCall<ListProjectsResult>("list_projects", {});
    }
    return this.request<ListProjectsResult>("/api/projects");
  }

  // LOCAL-ONLY: no hosted op yet
  createProject(payload: Record<string, unknown>): Promise<ProjectRecord> {
    return this.request<ProjectRecord>("/api/projects", { method: "POST", body: payload });
  }

  // LOCAL-ONLY: no hosted op yet
  saveProjectDocument(projectSlug: string, payload: Record<string, unknown>) {
    return this.request(`/api/projects/${projectSlug}/documents`, { method: "POST", body: payload });
  }

  // LOCAL-ONLY: no hosted op yet
  saveEssayDraft(projectSlug: string, questionIndex: number, draft: string): Promise<{ questionIndex: number }> {
    return this.request(`/api/projects/${projectSlug}/essay-draft/${questionIndex}`, {
      method: "PUT",
      body: { draft }
    });
  }

  // LOCAL-ONLY: no hosted op yet (upload_document exists but uses base64 payload, not multipart)
  uploadProjectDocuments(projectSlug: string, files: File[]): Promise<void> {
    const body = new FormData();
    for (const file of files) {
      body.append("files", file);
    }
    return this.requestFormData(`/api/projects/${projectSlug}/documents/upload`, body);
  }

  async updateProject(projectSlug: string, payload: Record<string, unknown>): Promise<SaveProjectResult | unknown> {
    if (this.mode === "hosted") {
      return this.rpcCall<SaveProjectResult>("save_project", { slug: projectSlug, patch: payload });
    }
    return this.request(`/api/projects/${projectSlug}`, { method: "PUT", body: payload });
  }

  async deleteProjectDocument(projectSlug: string, documentId: string): Promise<void> {
    if (this.mode === "hosted") {
      await this.rpcCall<DeleteDocumentResult>("delete_document", { slug: projectSlug, docId: documentId });
      return;
    }
    return this.request(`/api/projects/${projectSlug}/documents/${documentId}`, { method: "DELETE" });
  }

  // LOCAL-ONLY: no hosted op yet
  getProjectInsights(projectSlug: string): Promise<ProjectInsightWorkspaceState> {
    return this.request<ProjectInsightWorkspaceState>(`/api/projects/${projectSlug}/insights`);
  }

  // LOCAL-ONLY: no hosted op yet
  analyzeProjectPosting(payload: Record<string, unknown>): Promise<JobPostingExtractionResult> {
    return this.request<JobPostingExtractionResult>("/api/projects/analyze-posting", { method: "POST", body: payload });
  }

  // LOCAL-ONLY: hosted call_provider_test returns {ok, stdoutExcerpt?, runtimeState?}; method contract is ProviderRuntimeState
  testProvider(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/test`, { method: "POST" });
  }

  // LOCAL-ONLY: hosted save_provider_config returns {ok: true}; method contract is ProviderRuntimeState
  updateProviderConfig(providerId: ProviderId, payload: Record<string, unknown>): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/config`, { method: "PUT", body: payload });
  }

  // LOCAL-ONLY: hosted save_provider_api_key returns {ok: true}; method contract is ProviderRuntimeState
  saveProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/apikey`, {
      method: "POST",
      body: { apiKey }
    });
  }

  // LOCAL-ONLY: no hosted op yet
  clearProviderApiKey(providerId: ProviderId) {
    return this.request(`/api/providers/${providerId}/apikey`, { method: "DELETE" });
  }

  // LOCAL-ONLY: no hosted op yet
  checkNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion`);
  }

  // LOCAL-ONLY: hosted notion_connect requires {token, dbId}; method signature only carries providerId
  connectNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion/connect`, { method: "POST" });
  }

  // LOCAL-ONLY: hosted notion_disconnect returns {ok: true}; method contract is ProviderRuntimeState
  disconnectNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion/disconnect`, { method: "POST" });
  }

  async startRun(projectSlug: string, payload: Record<string, unknown>): Promise<StartRunResult> {
    if (this.mode === "hosted") {
      return this.rpcCall<StartRunResult>("start_run", { slug: projectSlug, ...payload });
    }
    return this.request<StartRunResult>(`/api/projects/${projectSlug}/runs`, { method: "POST", body: payload });
  }

  // LOCAL-ONLY: no hosted op yet
  deleteRun(projectSlug: string, runId: string): Promise<void> {
    return this.request(`/api/projects/${projectSlug}/runs/${runId}`, { method: "DELETE" });
  }

  async getRunMessages(projectSlug: string, runId: string): Promise<GetRunMessagesResult> {
    if (this.mode === "hosted") {
      return this.rpcCall<GetRunMessagesResult>("get_run_messages", { runId });
    }
    return this.request<GetRunMessagesResult>(
      `/api/projects/${projectSlug}/runs/${runId}/messages`
    );
  }

  async saveOpenDartApiKey(apiKey: string): Promise<void> {
    if (this.mode === "hosted") {
      await this.rpcCall<OpendartSaveKeyResult>("opendart_save_key", { key: apiKey });
      return;
    }
    return this.request("/api/opendart/apikey", { method: "POST", body: { apiKey } });
  }

  // LOCAL-ONLY: no hosted op yet
  deleteOpenDartApiKey(): Promise<void> {
    return this.request("/api/opendart/apikey", { method: "DELETE" });
  }

  // LOCAL-ONLY: hosted opendart_test returns {ok, sample?}; method contract exposes `message`
  testOpenDartConnection(): Promise<{ ok: boolean; message: string }> {
    return this.request<{ ok: boolean; message: string }>("/api/opendart/test", { method: "POST" });
  }

  // LOCAL-ONLY: hosted submit_intervention returns {ok: true}; method contract is {outcome, runId, nextRunId?}
  submitIntervention(runId: string, message: string): Promise<{ outcome: string; runId: string; nextRunId?: string }> {
    return this.request<{ outcome: string; runId: string; nextRunId?: string }>(`/api/runs/${runId}/intervention`, {
      method: "POST",
      body: { message }
    });
  }

  async abortRun(runId: string): Promise<AbortRunResult | unknown> {
    if (this.mode === "hosted") {
      return this.rpcCall<AbortRunResult>("abort_run", { runId });
    }
    return this.request(`/api/runs/${runId}/abort`, {
      method: "POST"
    });
  }

  async completeRun(projectSlug: string, runId: string): Promise<CompleteRunResult | unknown> {
    if (this.mode === "hosted") {
      return this.rpcCall<CompleteRunResult>("complete_run", { runId });
    }
    return this.request(`/api/projects/${projectSlug}/runs/${runId}/complete`, {
      method: "POST"
    });
  }

  // LOCAL-ONLY: hosted resume_run returns {ok: true}; method contract is {runId, resumedFromRunId}
  resumeRun(projectSlug: string, runId: string, message = ""): Promise<{ runId: string; resumedFromRunId: string }> {
    return this.request<{ runId: string; resumedFromRunId: string }>(`/api/projects/${projectSlug}/runs/${runId}/resume`, {
      method: "POST",
      body: { message }
    });
  }

  analyzeInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectRecord> {
    return this.request<ProjectRecord>(`/api/projects/${projectSlug}/insights/analyze`, { method: "POST", body: payload });
  }

  generateInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectInsightWorkspaceState> {
    return this.request<ProjectInsightWorkspaceState>(`/api/projects/${projectSlug}/insights/generate`, { method: "POST", body: payload });
  }

  /**
   * Hosted-mode RPC dispatcher. Sends a single envelope to POST /api/rpc and
   * returns the unwrapped `result`. Safe to call in both modes; callers should
   * gate by `this.mode` when the local REST path differs.
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

  private async request<T = unknown>(
    pathname: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      credentials: "include",
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json"
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = typeof payload.message === "string" ? payload.message : `Request failed (${response.status})`;
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async requestFormData<T = unknown>(pathname: string, body: FormData, method = "POST"): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      credentials: "include",
      method,
      body
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = typeof payload.message === "string" ? payload.message : `Request failed (${response.status})`;
      throw new Error(message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }
}

function toWsUrl(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

// ---------------------------------------------------------------------------
// BackendClient — typed client for the hosted backend API (Phase 5+)
// ---------------------------------------------------------------------------

export interface DeviceInfo {
  readonly id: string;
  readonly label: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

export interface StartPairingResult {
  readonly code: string;
  readonly expiresAt: string;
}

export class BackendClient {
  constructor(readonly baseUrl: string) {}

  async startPairing(opts: {
    label: string;
    workspaceRoot: string;
  }): Promise<StartPairingResult> {
    return this.request<StartPairingResult>("/api/pairing/start", {
      method: "POST",
      body: opts,
    });
  }

  async listDevices(): Promise<readonly DeviceInfo[]> {
    const result = await this.request<{ devices: DeviceInfo[] }>("/api/devices");
    return result.devices;
  }

  async revokeDevice(id: string): Promise<void> {
    await this.request(`/api/devices/${id}/revoke`, { method: "POST" });
  }

  private async request<T = unknown>(
    pathname: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      credentials: "include",
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
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
