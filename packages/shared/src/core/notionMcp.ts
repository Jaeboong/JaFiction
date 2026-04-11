import { ProviderId } from "./types";

export const notionMcpUrl = "https://mcp.notion.com/mcp";
export const notionConfigName = "notion";

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

export function joinPlanCommands(providerCommand: string, steps: NotionCliStep[], platform: string): string {
  return steps.map((step) => joinShellCommand([providerCommand, ...step.args], platform)).join(" && ");
}

export function joinShellCommand(parts: string[], platform: string): string {
  return parts.map((part) => quoteShellArg(part, platform)).join(" ");
}

export function quoteShellArg(value: string, platform: string): string {
  if (platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function isMatchingNotionServer(name?: string, url?: string): boolean {
  return (name?.toLowerCase().includes("notion") ?? false) || url === notionMcpUrl;
}

export function inferConnectedStatus(line: string): boolean | undefined {
  if (/disconnected|unauthorized|failed|error|needs\s+auth/i.test(line)) {
    return false;
  }
  if (/connected|available|configured|stored\s+oauth\s+token/i.test(line)) {
    return true;
  }
  return undefined;
}

export function providerLabel(providerId: ProviderId): string {
  switch (providerId) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "gemini":
      return "Gemini";
  }
}
