import { ProviderId } from "./types";

export const notionMcpUrl = "https://mcp.notion.com/mcp";
const notionConfigName = "notion";

export interface NotionMcpCheckResult {
  configured: boolean;
  connected?: boolean;
  message: string;
  configName?: string;
}

export interface NotionConnectPlan {
  message: string;
  steps?: NotionCliStep[];
  commandLine?: string;
}

export interface NotionCliStep {
  args: string[];
}

export function parseCodexNotionStatus(stdout: string): NotionMcpCheckResult {
  try {
    const parsed = JSON.parse(stdout) as Array<{ name?: string; transport?: { url?: string } }>;
    const match = parsed.find((server) => isMatchingNotionServer(server.name, server.transport?.url));
    if (!match) {
      return { configured: false, connected: false, message: "Notion MCP is not configured for Codex." };
    }

    return {
      configured: true,
      connected: true,
      configName: match.name ?? notionConfigName,
      message: `Notion MCP is configured for Codex as '${match.name ?? notionConfigName}'.`
    };
  } catch {
    const configured = /notion/i.test(stdout) && stdout.includes(notionMcpUrl);
    return {
      configured,
      connected: configured ? true : false,
      message: configured
        ? "Notion MCP is configured for Codex."
        : "Notion MCP is not configured for Codex."
    };
  }
}

export function parseClaudeNotionStatus(output: string): NotionMcpCheckResult {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => /notion/i.test(line) && (line.includes(notionMcpUrl) || /connected|configured/i.test(line)));
  if (!match) {
    return { configured: false, connected: false, message: "Notion MCP is not configured for Claude Code." };
  }

  const connected = inferConnectedStatus(match);
  return {
    configured: true,
    connected,
    configName: inferClaudeConfigName(match),
    message: `Notion MCP is available for Claude Code: ${match}`
  };
}

export function parseGeminiNotionStatus(output: string): NotionMcpCheckResult {
  if (/No MCP servers configured\./i.test(output)) {
    return { configured: false, connected: false, message: "Notion MCP is not configured for Gemini." };
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => /notion/i.test(line) || line.includes(notionMcpUrl));
  if (!match) {
    return { configured: false, connected: false, message: "Notion MCP is not configured for Gemini." };
  }

  const connected = inferConnectedStatus(match);
  return {
    configured: true,
    connected,
    configName: notionConfigName,
    message: `Notion MCP is configured for Gemini: ${match}`
  };
}

export function buildNotionConnectPlan(
  providerId: ProviderId,
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform = process.platform
): NotionConnectPlan {
  if (providerId === "codex") {
    const loginTarget = currentStatus.configName ?? notionConfigName;
    if (currentStatus.configured && currentStatus.connected === false) {
      const steps = [
        { args: buildNotionRemoveArgs(providerId, loginTarget) },
        { args: buildNotionAddArgs(providerId) },
        { args: buildCodexLoginArgs(loginTarget) }
      ];
      return {
        message: "Opening a terminal to refresh Codex Notion MCP and restart OAuth login.",
        steps,
        commandLine: joinPlanCommands(providerCommand, steps, platform)
      };
    }

    if (currentStatus.configured) {
      const steps = [{ args: buildCodexLoginArgs(loginTarget) }];
      return {
        message: "Opening a terminal to complete Codex Notion OAuth login.",
        steps,
        commandLine: joinPlanCommands(providerCommand, steps, platform)
      };
    }

    const steps = [
      { args: buildNotionAddArgs(providerId) },
      { args: buildCodexLoginArgs(notionConfigName) }
    ];
    return {
      message: "Opening a terminal to add the Notion MCP preset for Codex and start OAuth login.",
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  if (currentStatus.configured && currentStatus.connected === false) {
    const steps = [
      { args: buildNotionRemoveArgs(providerId, currentStatus.configName ?? notionConfigName) },
      { args: buildNotionAddArgs(providerId) }
    ];
    return {
      message: `Opening a terminal to refresh the Notion MCP connection for ${providerLabel(providerId)}.`,
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  if (currentStatus.configured) {
    return {
      message: `${providerLabel(providerId)} already has a Notion MCP connection. If you need to re-authenticate, use the provider's own MCP management flow.`
    };
  }

  const steps = [{ args: buildNotionAddArgs(providerId) }];
  return {
    message: `Opening a terminal to add the official Notion MCP preset for ${providerLabel(providerId)}.`,
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

export function buildNotionDisconnectPlan(
  providerId: ProviderId,
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform = process.platform
): NotionConnectPlan {
  if (!currentStatus.configured) {
    return {
      message: `Notion MCP is not configured for ${providerLabel(providerId)}.`
    };
  }

  const targetName = currentStatus.configName ?? notionConfigName;
  const steps = [{ args: buildNotionRemoveArgs(providerId, targetName) }];
  return {
    message: `Opening a terminal to remove the Notion MCP connection from ${providerLabel(providerId)}.`,
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

function joinPlanCommands(providerCommand: string, steps: NotionCliStep[], platform: string): string {
  return steps.map((step) => joinShellCommand([providerCommand, ...step.args], platform)).join(" && ");
}

function joinShellCommand(parts: string[], platform: string): string {
  return parts.map((part) => quoteShellArg(part, platform)).join(" ");
}

function quoteShellArg(value: string, platform: string): string {
  if (platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isMatchingNotionServer(name?: string, url?: string): boolean {
  return (name?.toLowerCase().includes("notion") ?? false) || url === notionMcpUrl;
}

function inferConnectedStatus(line: string): boolean | undefined {
  if (/disconnected|unauthorized|failed|error/i.test(line)) {
    return false;
  }
  if (/connected|available|configured/i.test(line)) {
    return true;
  }
  return undefined;
}

function inferClaudeConfigName(line: string): string {
  const prefix = line.split(":")[0]?.trim();
  return prefix || notionConfigName;
}

function buildCodexLoginArgs(targetName: string): string[] {
  return ["mcp", "login", targetName];
}

function buildNotionAddArgs(providerId: ProviderId): string[] {
  switch (providerId) {
    case "codex":
      return ["mcp", "add", notionConfigName, "--url", notionMcpUrl];
    case "claude":
      return ["mcp", "add", "--transport", "http", "--scope", "user", notionConfigName, notionMcpUrl];
    case "gemini":
      return ["mcp", "add", "--transport", "http", "--scope", "user", notionConfigName, notionMcpUrl];
  }
}

function buildNotionRemoveArgs(providerId: ProviderId, targetName: string): string[] {
  switch (providerId) {
    case "codex":
      return ["mcp", "remove", targetName];
    case "claude":
      return ["mcp", "remove", "--scope", "user", targetName];
    case "gemini":
      return ["mcp", "remove", targetName];
  }
}

function providerLabel(providerId: ProviderId): string {
  switch (providerId) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "gemini":
      return "Gemini";
  }
}
