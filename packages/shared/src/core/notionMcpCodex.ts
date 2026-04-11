import {
  NotionConnectPlan,
  NotionMcpCheckResult,
  isMatchingNotionServer,
  joinPlanCommands,
  notionConfigName,
  notionMcpUrl
} from "./notionMcp";

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
