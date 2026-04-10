import { spawn } from "node:child_process";
import {
  buildNotionDisconnectPlan,
  NotionConnectPlan,
  NotionMcpCheckResult,
  buildNotionConnectPlan,
  parseClaudeNotionStatus,
  parseCodexNotionStatus,
  parseGeminiNotionStatus
} from "./notionMcp";
import { buildProviderArgs, getProviderCapabilities, loadProviderCapabilities, normalizeProviderSettingValue } from "./providerOptions";
import { defaultProviderCommands, resolveProviderCommand, withCommandDirectoryInPath } from "./providerCommandResolver";
import { createProviderStreamProcessor, parseProviderFinalText } from "./providerStreaming";
import {
  AuthMode,
  isAbortError,
  isRunAbortedError,
  PromptExecutionOptions,
  ProviderAuthStatus,
  ProviderCommandResult,
  providerIds,
  ProviderId,
  ProviderRuntimeState,
  ProviderStatus,
  RunAbortedError,
  RunEvent
} from "./types";
import { ProviderStore } from "./storageInterfaces";
import { nowIso } from "./utils";

const providerNames: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini"
};

const IGNORED_PROVIDER_STDERR_PATTERNS = [
  /failed to warm featured plugin ids cache/i,
  /ignoring interface\.defaultPrompt/i,
  /failed to read OAuth tokens from keyring/i,
  /org\.freedesktop\.secrets/i,
  /Failed to delete shell snapshot/i,
  /Failed to read MCP server stderr/i,
  /stream did not contain valid UTF-8/i,
  /Failed to kill MCP process group/i
];

export interface ProviderSecretStore {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ProviderConfigStore {
  get(key: string, fallback?: string): string | undefined;
  set(key: string, value: string): Promise<void>;
}

export class ProviderRegistry {
  private runtimeStateCache = new Map<ProviderId, ProviderRuntimeState>();
  private notionStatusCache = new Map<ProviderId, NotionMcpCheckResult>();

  constructor(
    private readonly config: ProviderConfigStore,
    private readonly secrets: ProviderSecretStore,
    private readonly storage: ProviderStore
  ) {}

  async listRuntimeStates(options: { refresh?: boolean } = {}): Promise<ProviderRuntimeState[]> {
    if (!options.refresh && this.runtimeStateCache.size === providerIds.length) {
      return providerIds.map((providerId) => cloneRuntimeState(this.runtimeStateCache.get(providerId)!));
    }

    const savedStatuses = await this.storage.loadProviderStatuses();
    const states = await Promise.all(providerIds.map((providerId) => this.buildRuntimeState(providerId, savedStatuses[providerId])));
    this.runtimeStateCache = new Map(states.map((state) => [state.providerId, state]));
    return states.map(cloneRuntimeState);
  }

  async refreshRuntimeState(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const savedStatuses = await this.storage.loadProviderStatuses();
    const state = await this.buildRuntimeState(providerId, savedStatuses[providerId]);
    this.runtimeStateCache.set(providerId, state);
    return cloneRuntimeState(state);
  }

  async testProvider(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const command = await this.getCommand(providerId);
    const authMode = this.getAuthMode(providerId);
    const installation = await detectInstallation(command);
    const apiKey = await this.getApiKey(providerId);

    let status: ProviderStatus = {
      providerId,
      installed: installation.installed,
      authMode,
      authStatus: "untested",
      version: installation.version,
      lastCheckAt: nowIso(),
      lastError: installation.error
    };
    const capabilities = installation.installed
      ? await loadProviderCapabilities(providerId, command)
      : getProviderCapabilities(providerId);

    if (!installation.installed) {
      status = { ...status, authStatus: "unhealthy", lastError: installation.error ?? "CLI가 설치되어 있지 않습니다." };
      await this.storage.saveProviderStatus(status);
      return {
        ...status,
        command,
        hasApiKey: Boolean(apiKey),
        configuredModel: this.getModel(providerId),
        configuredEffort: this.getEffort(providerId),
        capabilities
      };
    }

    if (authMode === "apiKey" && !apiKey) {
      status = { ...status, authStatus: "missing", lastError: "API 키 방식에서는 API 키가 필요합니다." };
      await this.storage.saveProviderStatus(status);
      return {
        ...status,
        command,
        hasApiKey: false,
        configuredModel: this.getModel(providerId),
        configuredEffort: this.getEffort(providerId),
        capabilities
      };
    }

    try {
      await this.execute(providerId, "Reply with the single word OK.", {
        cwd: this.storage.storageRoot,
        authMode,
        apiKey
      }, true);
      status = { ...status, authStatus: "healthy", lastError: undefined };
    } catch (error) {
      status = {
        ...status,
        authStatus: "unhealthy",
        lastError: error instanceof Error ? error.message : String(error)
      };
    }

    await this.storage.saveProviderStatus(status);
    const nextState: ProviderRuntimeState = {
      ...status,
      command,
      hasApiKey: Boolean(apiKey),
      configuredModel: this.getModel(providerId),
      configuredEffort: this.getEffort(providerId),
      capabilities,
      notionMcpConfigured: this.notionStatusCache.get(providerId)?.configured,
      notionMcpConnected: this.notionStatusCache.get(providerId)?.connected,
      notionMcpMessage: this.notionStatusCache.get(providerId)?.message
    };
    this.runtimeStateCache.set(providerId, nextState);
    return cloneRuntimeState(nextState);
  }

  async execute(
    providerId: ProviderId,
    prompt: string,
    options: PromptExecutionOptions,
    testOnly = false
  ): Promise<ProviderCommandResult> {
    const command = await this.getCommand(providerId);
    const authMode = options.authMode;
    const apiKey = options.apiKey ?? (await this.getApiKey(providerId));

    if (authMode === "apiKey" && !apiKey) {
      throw new Error(`${providerNames[providerId]}는 API 키 방식에서 API 키가 필요합니다.`);
    }

    const args = buildProviderArgs(providerId, prompt, testOnly, {
      model: normalizeProviderSettingValue(options.modelOverride) ?? this.getModel(providerId),
      effort: normalizeProviderSettingValue(options.effortOverride) ?? this.getEffort(providerId)
    });
    const env = buildEnvironment(providerId, authMode, apiKey, command);
    const result = await runProcess(
      command,
      args,
      options.cwd,
      env,
      options.onEvent,
      options.abortSignal,
      providerId,
      options.round,
      options.speakerRole,
      options.messageScope,
      options.participantId,
      options.participantLabel
    );
    return {
      ...result,
      text: parseProviderFinalText(providerId, result.stdout)
    };
  }

  async getCommand(providerId: ProviderId): Promise<string> {
    const configuredCommand = this.config.get(
      `providers.${providerId}.command`,
      defaultProviderCommands[providerId]
    ) ?? defaultProviderCommands[providerId];
    return resolveProviderCommand(providerId, configuredCommand);
  }

  getAuthMode(providerId: ProviderId): AuthMode {
    return this.config.get(`providers.${providerId}.authMode`, "cli") === "apiKey" ? "apiKey" : "cli";
  }

  getModel(providerId: ProviderId): string | undefined {
    return normalizeProviderSettingValue(this.config.get(`providers.${providerId}.model`, ""));
  }

  async setModel(providerId: ProviderId, model: string): Promise<void> {
    await this.config.set(`providers.${providerId}.model`, model.trim());
    this.runtimeStateCache.delete(providerId);
  }

  getEffort(providerId: ProviderId): string | undefined {
    return normalizeProviderSettingValue(this.config.get(`providers.${providerId}.effort`, ""));
  }

  async setEffort(providerId: ProviderId, effort: string): Promise<void> {
    await this.config.set(`providers.${providerId}.effort`, effort.trim());
    this.runtimeStateCache.delete(providerId);
  }

  async setAuthMode(providerId: ProviderId, authMode: AuthMode): Promise<void> {
    await this.config.set(`providers.${providerId}.authMode`, authMode);
    this.runtimeStateCache.delete(providerId);
  }

  async saveApiKey(providerId: ProviderId, apiKey: string): Promise<void> {
    await this.secrets.store(secretKey(providerId), apiKey);
    this.runtimeStateCache.delete(providerId);
  }

  async clearApiKey(providerId: ProviderId): Promise<void> {
    await this.secrets.delete(secretKey(providerId));
    this.runtimeStateCache.delete(providerId);
  }

  async getApiKey(providerId: ProviderId): Promise<string | undefined> {
    return this.secrets.get(secretKey(providerId));
  }

  async checkNotionMcp(providerId: ProviderId): Promise<NotionMcpCheckResult> {
    const command = await this.getCommand(providerId);
    const installation = await detectInstallation(command);
    let result: NotionMcpCheckResult;
    if (!installation.installed) {
      result = {
        configured: false,
        message: `${providerNames[providerId]} CLI가 설치되어 있지 않습니다.`
      };
      this.storeNotionStatus(providerId, result);
      return result;
    }

    const env = withCommandDirectoryInPath(process.env, command);
    try {
      switch (providerId) {
        case "codex": {
          const processResult = await runProcess(command, ["mcp", "list", "--json"], this.storage.storageRoot, env);
          result = parseCodexNotionStatus(processResult.stdout);
          break;
        }
        case "claude": {
          const processResult = await runProcess(command, ["mcp", "list"], this.storage.storageRoot, env);
          result = parseClaudeNotionStatus(`${processResult.stdout}\n${processResult.stderr}`);
          break;
        }
        case "gemini": {
          const processResult = await runProcess(command, ["mcp", "list"], this.storage.storageRoot, env);
          result = parseGeminiNotionStatus(`${processResult.stdout}\n${processResult.stderr}`);
          break;
        }
      }
    } catch (error) {
      result = {
        configured: false,
        message: error instanceof Error ? error.message : String(error)
      };
      this.storeNotionStatus(providerId, result);
      return result;
    }

    this.storeNotionStatus(providerId, result!);
    return result!;
  }

  async connectNotionMcp(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const plan = await this.buildNotionConnectPlan(providerId);
    await this.runNotionPlan(providerId, plan);
    await this.checkNotionMcp(providerId);
    return this.refreshRuntimeState(providerId);
  }

  async disconnectNotionMcp(providerId: ProviderId): Promise<ProviderRuntimeState> {
    const plan = await this.buildNotionDisconnectPlan(providerId);
    await this.runNotionPlan(providerId, plan);
    await this.checkNotionMcp(providerId);
    return this.refreshRuntimeState(providerId);
  }

  async buildNotionConnectPlan(providerId: ProviderId): Promise<NotionConnectPlan> {
    const command = await this.getCommand(providerId);
    const status = await this.checkNotionMcp(providerId);
    return buildNotionConnectPlan(providerId, command, status);
  }

  async buildNotionDisconnectPlan(providerId: ProviderId): Promise<NotionConnectPlan> {
    const command = await this.getCommand(providerId);
    const status = await this.checkNotionMcp(providerId);
    return buildNotionDisconnectPlan(providerId, command, status);
  }

  private async runNotionPlan(providerId: ProviderId, plan: NotionConnectPlan): Promise<void> {
    if (!plan.steps?.length) {
      return;
    }

    const command = await this.getCommand(providerId);
    const env = withCommandDirectoryInPath(process.env, command);

    for (const step of plan.steps) {
      await runProcess(command, step.args, this.storage.storageRoot, env);
    }
  }

  private async buildRuntimeState(providerId: ProviderId, saved?: ProviderStatus): Promise<ProviderRuntimeState> {
    const command = await this.getCommand(providerId);
    const installation = await detectInstallation(command);
    const authMode = this.getAuthMode(providerId);
    const hasApiKey = Boolean(await this.getApiKey(providerId));
    const capabilities = installation.installed
      ? await loadProviderCapabilities(providerId, command)
      : getProviderCapabilities(providerId);

    let authStatus: ProviderAuthStatus = saved?.authStatus ?? "untested";
    let lastError = saved?.lastError;
    const lastCheckAt = saved?.lastCheckAt;

    if (authMode === "apiKey" && !hasApiKey) {
      authStatus = "missing";
      lastError = "API 키 방식에서는 API 키가 필요합니다.";
    }

    const notionStatus = installation.installed ? this.notionStatusCache.get(providerId) : undefined;
    return {
      providerId,
      command,
      authMode,
      hasApiKey,
      configuredModel: this.getModel(providerId),
      configuredEffort: this.getEffort(providerId),
      capabilities,
      installed: installation.installed,
      version: installation.version,
      authStatus,
      lastError: installation.installed ? lastError : installation.error,
      lastCheckAt,
      notionMcpConfigured: notionStatus?.configured,
      notionMcpConnected: notionStatus?.connected,
      notionMcpMessage: notionStatus?.message
    };
  }

  private storeNotionStatus(providerId: ProviderId, status: NotionMcpCheckResult): void {
    this.notionStatusCache.set(providerId, status);
    const cached = this.runtimeStateCache.get(providerId);
    if (!cached) {
      return;
    }

    this.runtimeStateCache.set(providerId, {
      ...cached,
      notionMcpConfigured: status.configured,
      notionMcpConnected: status.connected,
      notionMcpMessage: status.message
    });
  }
}

function secretKey(providerId: ProviderId): string {
  return `jafiction.apiKey.${providerId}`;
}

function cloneRuntimeState(state: ProviderRuntimeState): ProviderRuntimeState {
  return {
    ...state,
    capabilities: {
      ...state.capabilities,
      modelOptions: [...state.capabilities.modelOptions],
      effortOptions: [...state.capabilities.effortOptions]
    }
  };
}

function buildEnvironment(
  providerId: ProviderId,
  authMode: AuthMode,
  apiKey: string | undefined,
  command: string
): NodeJS.ProcessEnv {
  const env = withCommandDirectoryInPath(process.env, command);
  if (authMode !== "apiKey" || !apiKey) {
    return env;
  }

  switch (providerId) {
    case "codex":
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
      break;
    case "claude":
      env.ANTHROPIC_API_KEY = apiKey;
      break;
    case "gemini":
      env.GEMINI_API_KEY = apiKey;
      break;
  }

  return env;
}

async function detectInstallation(command: string): Promise<{ installed: boolean; version?: string; error?: string }> {
  try {
    const result = await runProcess(command, ["--version"], process.cwd(), withCommandDirectoryInPath(process.env, command));
    return { installed: true, version: firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr) };
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onEvent?: (event: RunEvent) => Promise<void> | void,
  abortSignal?: AbortSignal,
  providerId?: ProviderId,
  round?: number,
  speakerRole?: PromptExecutionOptions["speakerRole"],
  messageScope?: string,
  participantId?: string,
  participantLabel?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (abortSignal?.aborted) {
    throw new RunAbortedError();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let settled = false;
    const streamProcessor = providerId
      ? createProviderStreamProcessor(providerId, round, speakerRole, messageScope, participantId, participantLabel)
      : undefined;
    const clearAbortListener = () => {
      abortSignal?.removeEventListener("abort", handleAbort);
    };
    const rejectWith = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAbortListener();
      reject(error);
    };
    const resolveWith = (value: { stdout: string; stderr: string; exitCode: number }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAbortListener();
      resolve(value);
    };
    const handleAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 250).unref();
    };

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    // These CLIs are invoked with their full prompt in argv, so we can close
    // stdin immediately and avoid tools like Claude waiting for piped input.
    child.stdin.end();

    child.stdout.on("data", async (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      if (streamProcessor && onEvent) {
        await streamProcessor.handleStdout(text, onEvent);
      }
    });

    child.stderr.on("data", async (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      const meaningfulStderr = extractMeaningfulProviderStderr(text);
      if (meaningfulStderr && onEvent && providerId) {
        await onEvent({
          timestamp: nowIso(),
          type: "provider-stderr",
          providerId,
          participantId,
          participantLabel,
          round,
          message: meaningfulStderr
        });
      }
    });

    child.on("error", (error) => {
      if (aborted || isRunAbortedError(error) || isAbortError(error)) {
        rejectWith(new RunAbortedError());
        return;
      }

      rejectWith(new Error(`${command}: ${String(error)}`));
    });

    child.on("close", (exitCode) => {
      void (async () => {
        if (aborted) {
          rejectWith(new RunAbortedError());
          return;
        }

        if (streamProcessor && onEvent) {
          await streamProcessor.finalize(stdout, onEvent);
        }

        if (exitCode !== 0) {
          rejectWith(new Error(`${command} exited with code ${exitCode}: ${(stderr || stdout).trim()}`));
          return;
        }

        resolveWith({ stdout, stderr, exitCode: exitCode ?? 0 });
      })().catch((error) => {
        rejectWith(error instanceof Error ? error : new Error(String(error)));
      });
    });
  });
}

function extractMeaningfulProviderStderr(text: string): string | undefined {
  const cleaned = text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  if (IGNORED_PROVIDER_STDERR_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return undefined;
  }

  return cleaned;
}
