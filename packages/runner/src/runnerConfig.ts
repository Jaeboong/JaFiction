import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  AgentDefaults,
  AuthMode,
  ProviderId,
  authModes,
  defaultProviderCommands,
  essayRoleIds,
  providerIds
} from "@jasojeon/shared";

interface ProviderConfigRecord {
  command: string;
  authMode: AuthMode;
  model: string;
  effort: string;
}

interface WebSearchConfig {
  enabled: boolean;
  provider: "naver" | "brave";
  cacheTtlDays: number;
}

interface RunnerConfigData {
  port: number;
  providers: Record<ProviderId, ProviderConfigRecord>;
  agentDefaults: AgentDefaults;
  webSearch: WebSearchConfig;
}

const defaultWebSearchConfig = (): WebSearchConfig => ({
  enabled: false,
  provider: "naver",
  cacheTtlDays: 7
});

const defaultConfig = (): RunnerConfigData => ({
  port: 4123,
  providers: {
    codex: { command: defaultProviderCommands.codex, authMode: "cli", model: "", effort: "" },
    claude: { command: defaultProviderCommands.claude, authMode: "cli", model: "", effort: "" },
    gemini: { command: defaultProviderCommands.gemini, authMode: "cli", model: "", effort: "" }
  },
  agentDefaults: {},
  webSearch: defaultWebSearchConfig()
});

export class RunnerConfig {
  private cache?: RunnerConfigData;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const next = await this.readConfig();
    this.cache = next;
    await this.writeConfig(next);
  }

  async getPort(): Promise<number> {
    const config = await this.readConfig();
    return Number.isInteger(config.port) && config.port > 0 ? config.port : 4123;
  }

  get(key: string, fallback?: string): string | undefined {
    const config = this.cache ?? defaultConfig();
    const segments = key.split(".");
    let current: unknown = config;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !(segment in current)) {
        return fallback;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === "string" ? current : fallback;
  }

  async set(key: string, value: string): Promise<void> {
    const config = await this.readConfig();
    const segments = key.split(".");
    let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
    segments.slice(0, -1).forEach((segment) => {
      const next = current[segment];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    });
    current[segments.at(-1)!] = value;
    this.cache = sanitizeConfig(config);
    await this.writeConfig(this.cache);
  }

  async getAgentDefaults(): Promise<AgentDefaults> {
    const config = await this.readConfig();
    return config.agentDefaults;
  }

  async getWebSearchConfig(): Promise<WebSearchConfig> {
    const config = await this.readConfig();
    return config.webSearch;
  }

  async setAgentDefaults(raw: unknown): Promise<void> {
    const config = await this.readConfig();
    config.agentDefaults = sanitizeAgentDefaults(raw);
    this.cache = config;
    await this.writeConfig(config);
  }

  private async readConfig(): Promise<RunnerConfigData> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<RunnerConfigData>;
      this.cache = sanitizeConfig(raw);
      return this.cache;
    } catch {
      this.cache = defaultConfig();
      return this.cache;
    }
  }

  private async writeConfig(config: RunnerConfigData): Promise<void> {
    await fs.writeFile(this.filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

function sanitizeConfig(raw: Partial<RunnerConfigData>): RunnerConfigData {
  const base = defaultConfig();
  const providers = providerIds.reduce<Record<ProviderId, ProviderConfigRecord>>((accumulator, providerId) => {
    const candidate = raw.providers?.[providerId];
    accumulator[providerId] = {
      command: typeof candidate?.command === "string" && candidate.command.trim()
        ? candidate.command.trim()
        : base.providers[providerId].command,
      authMode: authModes.includes(candidate?.authMode as AuthMode) ? candidate!.authMode : base.providers[providerId].authMode,
      model: typeof candidate?.model === "string" ? candidate.model : "",
      effort: typeof candidate?.effort === "string" ? candidate.effort : ""
    };
    return accumulator;
  }, {} as Record<ProviderId, ProviderConfigRecord>);

  return {
    port: Number.isInteger(raw.port) && Number(raw.port) > 0 ? Number(raw.port) : base.port,
    providers,
    agentDefaults: sanitizeAgentDefaults(raw.agentDefaults),
    webSearch: sanitizeWebSearchConfig(raw.webSearch)
  };
}

function sanitizeWebSearchConfig(raw: unknown): WebSearchConfig {
  const base = defaultWebSearchConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const candidate = raw as Record<string, unknown>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : base.enabled,
    provider: candidate.provider === "brave" ? "brave" : base.provider,
    cacheTtlDays: Number.isInteger(candidate.cacheTtlDays) && Number(candidate.cacheTtlDays) > 0
      ? Number(candidate.cacheTtlDays)
      : base.cacheTtlDays
  };
}

function sanitizeAgentDefaults(raw: unknown): AgentDefaults {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const candidateMap = raw as Record<string, unknown>;
  return essayRoleIds.reduce<AgentDefaults>((accumulator, roleId) => {
    const candidate = candidateMap[roleId];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return accumulator;
    }

    const providerId = (candidate as { providerId?: unknown }).providerId;
    if (!providerIds.includes(providerId as ProviderId)) {
      return accumulator;
    }

    const useProviderDefaults = Boolean((candidate as { useProviderDefaults?: unknown }).useProviderDefaults);
    accumulator[roleId] = {
      providerId: providerId as ProviderId,
      useProviderDefaults,
      modelOverride: useProviderDefaults
        ? ""
        : typeof (candidate as { modelOverride?: unknown }).modelOverride === "string"
          ? (candidate as { modelOverride: string }).modelOverride
          : "",
      effortOverride: useProviderDefaults
        ? ""
        : typeof (candidate as { effortOverride?: unknown }).effortOverride === "string"
          ? (candidate as { effortOverride: string }).effortOverride
          : ""
    };
    return accumulator;
  }, {});
}
