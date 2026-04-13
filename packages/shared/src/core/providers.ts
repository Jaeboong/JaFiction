import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NotionConnectPlan, NotionMcpCheckResult } from "./notionMcp";
import {
  buildCodexNotionConnectPlan,
  buildCodexNotionDisconnectPlan,
  parseCodexNotionStatus
} from "./notionMcpCodex";
import {
  buildClaudeNotionConnectPlan,
  buildClaudeNotionDisconnectPlan,
  parseClaudeNotionStatus
} from "./notionMcpClaude";
import {
  buildGeminiNotionConnectPlan,
  buildGeminiNotionDisconnectPlan,
  parseGeminiNotionStatus
} from "./notionMcpGemini";
import { performGeminiNotionOAuth } from "./notionOAuth";
import { buildProviderArgs, getProviderCapabilities, loadProviderCapabilities, normalizeProviderSettingValue } from "./providerOptions";
import { defaultProviderCommands, resolveProviderCommand, withCommandDirectoryInPath } from "./providerCommandResolver";
import { resolveNodeRuntime } from "./nodeRuntimeResolver";
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

  getCachedRuntimeState(providerId: ProviderId): ProviderRuntimeState | undefined {
    const cached = this.runtimeStateCache.get(providerId);
    return cached ? cloneRuntimeState(cached) : undefined;
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
    const hasNotionToken = providerId === "claude" ? Boolean(await this.getNotionToken()) : undefined;

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
        hasNotionToken,
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
        hasNotionToken,
        configuredModel: this.getModel(providerId),
        configuredEffort: this.getEffort(providerId),
        capabilities
      };
    }

    const env = buildEnvironment(providerId, authMode, apiKey, command);

    if (authMode === "apiKey") {
      // API 키가 있으면 낙관적으로 healthy로 표시 — 실제 검증은 실행 시점에
      status = { ...status, authStatus: "healthy", lastError: undefined };
    } else {
      try {
        const authOk = await checkProviderAuthStatus(providerId, command, env, AbortSignal.timeout(10_000));
        status = authOk
          ? { ...status, authStatus: "healthy", lastError: undefined }
          : { ...status, authStatus: "unhealthy", lastError: "인증되지 않았습니다. CLI 로그인이 필요합니다." };
      } catch (error) {
        status = {
          ...status,
          authStatus: "unhealthy",
          lastError: isAbortError(error) ? "인증 상태 확인 시간 초과" : error instanceof Error ? error.message : String(error)
        };
      }
    }

    await this.storage.saveProviderStatus(status);
    const nextState: ProviderRuntimeState = {
      ...status,
      command,
      hasApiKey: Boolean(apiKey),
      hasNotionToken,
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

    // On Windows, Claude is typically invoked as claude.cmd. Passing long prompts
    // with special characters (<<<, >>>, quotes) as argv causes cmd.exe to
    // misinterpret them as redirection operators. Use stdin delivery instead.
    const useStdin = providerId === "claude" && process.platform === "win32";
    const args = buildProviderArgs(providerId, useStdin ? "" : prompt, testOnly, {
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
      options.participantLabel,
      useStdin ? prompt : undefined
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

  async saveNotionToken(token: string): Promise<void> {
    if (token === "") {
      await this.secrets.delete("jasojeon.notionToken");
    } else {
      await this.secrets.store("jasojeon.notionToken", token);
    }
    this.runtimeStateCache.delete("claude");
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
    if (providerId === "claude" && !(await this.getNotionToken()) && !plan.steps?.length) {
      this.storeNotionStatus(providerId, {
        configured: false,
        connected: false,
        message: plan.message
      });
      return this.refreshRuntimeState(providerId);
    }
    await this.runNotionPlan(providerId, plan);
    if (providerId === "gemini" && plan.steps?.length) {
      await this.performGeminiNotionOAuth("notion");
    }
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
    const platform = process.platform;
    switch (providerId) {
      case "codex":
        return buildCodexNotionConnectPlan(command, status, platform);
      case "claude":
        return buildClaudeNotionConnectPlan(command, status, platform, await this.getNotionToken());
      case "gemini":
        return buildGeminiNotionConnectPlan(command, status, platform);
    }
  }

  async buildNotionDisconnectPlan(providerId: ProviderId): Promise<NotionConnectPlan> {
    const command = await this.getCommand(providerId);
    const status = await this.checkNotionMcp(providerId);
    const platform = process.platform;
    switch (providerId) {
      case "codex":
        return buildCodexNotionDisconnectPlan(command, status, platform);
      case "claude":
        return buildClaudeNotionDisconnectPlan(command, status, platform);
      case "gemini":
        return buildGeminiNotionDisconnectPlan(command, status, platform);
    }
  }

  private async runNotionPlan(providerId: ProviderId, plan: NotionConnectPlan): Promise<void> {
    if (!plan.steps?.length) {
      return;
    }

    const command = await this.getCommand(providerId);
    const env = withCommandDirectoryInPath(process.env, command);

    for (const step of plan.steps) {
      // `mcp login` is interactive (opens browser, waits for OAuth callback).
      // Run it detached so the RPC doesn't block indefinitely.
      if (step.args[0] === "mcp" && step.args[1] === "login") {
        const useShell = command.endsWith(".cmd");
        const child = spawn(command, step.args, {
          cwd: this.storage.storageRoot,
          env,
          stdio: "ignore",
          shell: useShell,
          detached: true,
          windowsHide: true
        });
        child.unref();
        continue;
      }
      await runProcess(command, step.args, this.storage.storageRoot, env);
    }
  }

  protected async performGeminiNotionOAuth(serverName: string): Promise<void> {
    await performGeminiNotionOAuth(serverName);
  }

  private async getNotionToken(): Promise<string | undefined> {
    return this.secrets.get("jasojeon.notionToken");
  }

  private async buildRuntimeState(providerId: ProviderId, saved?: ProviderStatus): Promise<ProviderRuntimeState> {
    const command = await this.getCommand(providerId);
    const installation = await detectInstallation(command);
    const authMode = this.getAuthMode(providerId);
    const hasApiKey = Boolean(await this.getApiKey(providerId));
    const hasNotionToken = providerId === "claude" ? Boolean(await this.getNotionToken()) : undefined;
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

    if (installation.installed && !this.notionStatusCache.has(providerId)) {
      try {
        await this.checkNotionMcp(providerId);
      } catch (err) {
        console.warn(`[ProviderRegistry] Notion MCP 초기 상태 확인 실패 (${providerId}):`, err);
      }
    }
    const notionStatus = installation.installed ? this.notionStatusCache.get(providerId) : undefined;
    return {
      providerId,
      command,
      authMode,
      hasApiKey,
      hasNotionToken,
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
  return `jasojeon.apiKey.${providerId}`;
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

async function checkProviderAuthStatus(
  providerId: ProviderId,
  command: string,
  env: NodeJS.ProcessEnv,
  abortSignal?: AbortSignal
): Promise<boolean> {
  switch (providerId) {
    case "claude": {
      const result = await runProcess(command, ["auth", "status"], process.cwd(), env, undefined, abortSignal);
      try {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        return parsed["loggedIn"] === true;
      } catch {
        return false;
      }
    }
    case "codex": {
      // 1차: auth.json 파일 존재 여부로 확인 (Windows에서 spawn+shell:false stderr 캡처 문제 회피)
      const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
      if (fs.existsSync(codexAuthPath)) {
        try {
          const raw = fs.readFileSync(codexAuthPath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed["auth_mode"] === "chatgpt" || parsed["OPENAI_API_KEY"]) {
            return true;
          }
        } catch { /* 파싱 실패 시 CLI 방식으로 폴백 */ }
      }
      // 2차: CLI 출력으로 확인 (폴백)
      try {
        const result = await runProcess(command, ["login", "status"], process.cwd(), env, undefined, abortSignal);
        const combined = `${result.stdout}\n${result.stderr}`.trim().toLowerCase();
        return combined.includes("logged in");
      } catch {
        return false;
      }
    }
    case "gemini": {
      const oauthCredsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
      return fs.existsSync(oauthCredsPath);
    }
  }
}

async function detectInstallation(command: string): Promise<{ installed: boolean; version?: string; error?: string }> {
  try {
    const result = await runProcess(command, ["--version"], process.cwd(), withCommandDirectoryInPath(process.env, command));
    return { installed: true, version: firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const userFacingError = classifyInstallationError(message);
    return { installed: false, error: userFacingError };
  }
}

function classifyInstallationError(errorMessage: string): string {
  if (/ENOENT|command not found|not recognized|not found/i.test(errorMessage)) {
    return "CLI가 설치되어 있지 않습니다.";
  }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(errorMessage)) {
    return "CLI 패키지가 손상되었습니다. 재설치가 필요합니다.";
  }
  if (/exited with code/i.test(errorMessage)) {
    return "CLI 실행 중 오류가 발생했습니다. 재설치가 필요할 수 있습니다.";
  }
  return "CLI가 설치되어 있지 않거나 실행할 수 없습니다.";
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

/**
 * On Windows, npm global installs produce a `.cmd` wrapper that forwards to a
 * Node.js entry script. Spawning the `.cmd` goes through cmd.exe, which has a
 * ~8KB command-line length limit and fragile metacharacter escaping. For large
 * prompts (insight generation, long conversations) this fails with
 * "명령이 너무 깁니다" (command is too long).
 *
 * This helper parses the `.cmd` wrapper to extract the underlying node script
 * path so the caller can `spawn(node, [script, ...args])` directly, bypassing
 * cmd.exe entirely. CreateProcess raises the limit to ~32KB and eliminates all
 * shell escaping concerns.
 */
async function resolveCmdWrapper(command: string): Promise<{ node: string; script: string } | undefined> {
  if (process.platform !== "win32" || !command.toLowerCase().endsWith(".cmd")) {
    return undefined;
  }
  let content: string;
  try {
    content = await fs.promises.readFile(command, "utf8");
  } catch {
    return undefined;
  }
  // Typical npm wrapper has lines like:
  //   "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
  // Extract the .js path.
  const scriptMatch = content.match(/"([^"]+\.js)"/i) ?? content.match(/(\S+\.js)/i);
  if (!scriptMatch?.[1]) {
    return undefined;
  }
  let scriptPath = scriptMatch[1];
  // Resolve %dp0% / %~dp0 (directory of the .cmd) and other relative bits.
  const cmdDir = path.dirname(command);
  scriptPath = scriptPath
    .replace(/%~?dp0%?\\?/gi, cmdDir + path.sep)
    .replace(/%~?dp0/gi, cmdDir + path.sep);
  if (!path.isAbsolute(scriptPath)) {
    scriptPath = path.resolve(cmdDir, scriptPath);
  }
  try {
    await fs.promises.access(scriptPath);
  } catch {
    return undefined;
  }
  const nodeRuntime = resolveNodeRuntime();
  return { node: nodeRuntime.nodeBin, script: scriptPath };
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
  participantLabel?: string,
  stdinData?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (abortSignal?.aborted) {
    throw new RunAbortedError();
  }

  // Resolve Windows .cmd wrappers → direct node invocation to bypass cmd.exe's
  // 8KB argv limit and metacharacter escaping issues.
  const resolvedCmd = await resolveCmdWrapper(command);
  let effectiveCommand = command;
  let effectiveArgs = args;
  let useShell = false;
  if (resolvedCmd) {
    effectiveCommand = resolvedCmd.node;
    effectiveArgs = [resolvedCmd.script, ...args];
  } else if (process.platform === "win32" && command.endsWith(".cmd")) {
    // Fallback: couldn't parse the .cmd wrapper, use shell as before.
    useShell = true;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(effectiveCommand, effectiveArgs, { cwd, env, shell: useShell, windowsHide: true });
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

    // Write prompt via stdin if provided (avoids shell escaping issues with
    // special characters like <<< >>> in prompts on Windows cmd.exe).
    // Otherwise close stdin immediately to avoid CLIs waiting for piped input.
    if (stdinData) {
      child.stdin.write(stdinData, () => { child.stdin.end(); });
    } else {
      child.stdin.end();
    }

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
