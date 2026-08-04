import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  NotionConnectPlan,
  NotionMcpCheckResult,
  isMatchingNotionServer,
  joinPlanCommands,
  notionConfigName,
  notionMcpUrl
} from "./notionMcp";

export interface CodexNotionConfigRepairResult {
  repaired: boolean;
  text: string;
}

export function repairCodexNotionConfigText(text: string): CodexNotionConfigRepairResult {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const notionLineIndexes = new Set<number>();
  let currentSection = "";
  let firstNotionLine = -1;
  let hasOfficialUrl = false;
  let hasStdioConflict = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
    }

    const isNotionSection = currentSection === "mcp_servers.notion"
      || currentSection.startsWith("mcp_servers.notion.");
    if (!isNotionSection) {
      continue;
    }

    notionLineIndexes.add(index);
    if (firstNotionLine < 0) {
      firstNotionLine = index;
    }
    if (line.includes(notionMcpUrl)) {
      hasOfficialUrl = true;
    }
    if (
      currentSection !== "mcp_servers.notion"
      || /^\s*(?:command|args|cwd)\s*=/i.test(line)
      || /^\s*transport\s*=\s*["']?stdio/i.test(line)
    ) {
      hasStdioConflict = true;
    }
  }

  if (!hasOfficialUrl || !hasStdioConflict || firstNotionLine < 0) {
    return { repaired: false, text };
  }

  const repairedLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index === firstNotionLine) {
      repairedLines.push("[mcp_servers.notion]", `url = "${notionMcpUrl}"`);
    }
    if (!notionLineIndexes.has(index)) {
      repairedLines.push(lines[index]);
    }
  }

  return {
    repaired: true,
    text: repairedLines.join(newline)
  };
}

export async function repairCodexNotionConfigFile(
  configPath = path.join(os.homedir(), ".codex", "config.toml")
): Promise<boolean> {
  let source: string;
  try {
    source = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const result = repairCodexNotionConfigText(source);
  if (!result.repaired) {
    return false;
  }

  const backupPath = `${configPath}.jasojeon-backup`;
  try {
    await fs.copyFile(configPath, backupPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }

  const temporaryPath = `${configPath}.jasojeon-${process.pid}-${Date.now()}.tmp`;
  try {
    const stats = await fs.stat(configPath);
    await fs.writeFile(temporaryPath, result.text, { encoding: "utf8", mode: stats.mode });
    await fs.rename(temporaryPath, configPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return true;
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

export function buildCodexNotionConnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string
): NotionConnectPlan {
  const loginTarget = currentStatus.configName ?? notionConfigName;

  if (currentStatus.configured && currentStatus.connected === false) {
    const steps = [
      { args: ["mcp", "remove", loginTarget] },
      { args: addArgs() },
      { args: loginArgs(loginTarget) }
    ];
    return {
      message: "Opening a terminal to refresh Codex Notion MCP and restart OAuth login.",
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  if (currentStatus.configured) {
    const steps = [{ args: loginArgs(loginTarget) }];
    return {
      message: "Opening a terminal to complete Codex Notion OAuth login.",
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  const steps = [
    { args: addArgs() },
    { args: loginArgs(notionConfigName) }
  ];
  return {
    message: "Opening a terminal to add the Notion MCP preset for Codex and start OAuth login.",
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

export function buildCodexNotionDisconnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string
): NotionConnectPlan {
  if (!currentStatus.configured) {
    return { message: "Notion MCP is not configured for Codex." };
  }

  const targetName = currentStatus.configName ?? notionConfigName;
  const steps = [{ args: ["mcp", "remove", targetName] }];
  return {
    message: "Opening a terminal to remove the Notion MCP connection from Codex.",
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

function addArgs(): string[] {
  return ["mcp", "add", notionConfigName, "--url", notionMcpUrl];
}

function loginArgs(targetName: string): string[] {
  return ["mcp", "login", targetName];
}
