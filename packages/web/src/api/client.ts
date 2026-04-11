import type {
  AgentDefaults,
  JobPostingExtractionResult,
  ProjectInsightWorkspaceState,
  ProjectRecord,
  ProviderId,
  ProviderRuntimeState,
  RunChatMessage,
  RunLedgerEntry,
  SidebarState
} from "@jafiction/shared";

export interface SessionPayload {
  state: SidebarState;
  storageRoot: string;
}

export class RunnerClient {
  constructor(readonly baseUrl: string) {}

  static async bootstrap(baseUrl: string): Promise<SessionPayload> {
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
    return this.request<SidebarState>("/api/state");
  }

  async getAgentDefaults(): Promise<AgentDefaults> {
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
    return new WebSocket(toWsUrl(this.baseUrl, "/ws/state"));
  }

  createRunSocket(runId: string): WebSocket {
    return new WebSocket(toWsUrl(this.baseUrl, `/ws/runs/${runId}`));
  }

  listProjects() {
    return this.request("/api/projects");
  }

  createProject(payload: Record<string, unknown>): Promise<ProjectRecord> {
    return this.request<ProjectRecord>("/api/projects", { method: "POST", body: payload });
  }

  saveProjectDocument(projectSlug: string, payload: Record<string, unknown>) {
    return this.request(`/api/projects/${projectSlug}/documents`, { method: "POST", body: payload });
  }

  saveEssayDraft(projectSlug: string, questionIndex: number, draft: string): Promise<{ questionIndex: number }> {
    return this.request(`/api/projects/${projectSlug}/essay-draft/${questionIndex}`, {
      method: "PUT",
      body: { draft }
    });
  }

  uploadProjectDocuments(projectSlug: string, files: File[]): Promise<void> {
    const body = new FormData();
    for (const file of files) {
      body.append("files", file);
    }
    return this.requestFormData(`/api/projects/${projectSlug}/documents/upload`, body);
  }

  updateProject(projectSlug: string, payload: Record<string, unknown>) {
    return this.request(`/api/projects/${projectSlug}`, { method: "PUT", body: payload });
  }

  deleteProjectDocument(projectSlug: string, documentId: string): Promise<void> {
    return this.request(`/api/projects/${projectSlug}/documents/${documentId}`, { method: "DELETE" });
  }

  getProjectInsights(projectSlug: string): Promise<ProjectInsightWorkspaceState> {
    return this.request<ProjectInsightWorkspaceState>(`/api/projects/${projectSlug}/insights`);
  }

  analyzeProjectPosting(payload: Record<string, unknown>): Promise<JobPostingExtractionResult> {
    return this.request<JobPostingExtractionResult>("/api/projects/analyze-posting", { method: "POST", body: payload });
  }

  testProvider(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/test`, { method: "POST" });
  }

  updateProviderConfig(providerId: ProviderId, payload: Record<string, unknown>): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/config`, { method: "PUT", body: payload });
  }

  saveProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/apikey`, {
      method: "POST",
      body: { apiKey }
    });
  }

  clearProviderApiKey(providerId: ProviderId) {
    return this.request(`/api/providers/${providerId}/apikey`, { method: "DELETE" });
  }

  checkNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion`);
  }

  connectNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion/connect`, { method: "POST" });
  }

  disconnectNotion(providerId: ProviderId): Promise<ProviderRuntimeState> {
    return this.request<ProviderRuntimeState>(`/api/providers/${providerId}/notion/disconnect`, { method: "POST" });
  }

  startRun(projectSlug: string, payload: Record<string, unknown>): Promise<{ runId: string }> {
    return this.request(`/api/projects/${projectSlug}/runs`, { method: "POST", body: payload });
  }

  deleteRun(projectSlug: string, runId: string): Promise<void> {
    return this.request(`/api/projects/${projectSlug}/runs/${runId}`, { method: "DELETE" });
  }

  getRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }> {
    return this.request<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>(
      `/api/projects/${projectSlug}/runs/${runId}/messages`
    );
  }

  saveOpenDartApiKey(apiKey: string): Promise<void> {
    return this.request("/api/opendart/apikey", { method: "POST", body: { apiKey } });
  }

  deleteOpenDartApiKey(): Promise<void> {
    return this.request("/api/opendart/apikey", { method: "DELETE" });
  }

  testOpenDartConnection(): Promise<{ ok: boolean; message: string }> {
    return this.request<{ ok: boolean; message: string }>("/api/opendart/test", { method: "POST" });
  }

  submitIntervention(runId: string, message: string): Promise<{ outcome: string; runId: string; nextRunId?: string }> {
    return this.request<{ outcome: string; runId: string; nextRunId?: string }>(`/api/runs/${runId}/intervention`, {
      method: "POST",
      body: { message }
    });
  }

  abortRun(runId: string) {
    return this.request(`/api/runs/${runId}/abort`, {
      method: "POST"
    });
  }

  completeRun(projectSlug: string, runId: string) {
    return this.request(`/api/projects/${projectSlug}/runs/${runId}/complete`, {
      method: "POST"
    });
  }

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
