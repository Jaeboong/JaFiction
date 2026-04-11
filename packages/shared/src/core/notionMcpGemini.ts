import {
  NotionConnectPlan,
  NotionMcpCheckResult,
  inferConnectedStatus,
  joinPlanCommands,
  notionConfigName,
  notionMcpUrl
} from "./notionMcp";

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

export function buildGeminiNotionConnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string
): NotionConnectPlan {
  if (currentStatus.configured && currentStatus.connected === false) {
    const steps = [
      { args: ["mcp", "remove", "--scope", "user", currentStatus.configName ?? notionConfigName] },
      { args: addArgs() }
    ];
    return {
      message: "Opening a terminal to refresh the Notion MCP connection for Gemini.",
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  if (currentStatus.configured) {
    return {
      message: "Gemini already has a Notion MCP connection. If you need to re-authenticate, use the provider's own MCP management flow."
    };
  }

  const steps = [{ args: addArgs() }];
  return {
    message: "Opening a terminal to add the official Notion MCP preset for Gemini.",
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

export function buildGeminiNotionDisconnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string
): NotionConnectPlan {
  if (!currentStatus.configured) {
    return { message: "Notion MCP is not configured for Gemini." };
  }

  const targetName = currentStatus.configName ?? notionConfigName;
  const steps = [{ args: ["mcp", "remove", "--scope", "user", targetName] }];
  return {
    message: "Opening a terminal to remove the Notion MCP connection from Gemini.",
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

function addArgs(): string[] {
  return ["mcp", "add", "--transport", "http", "--scope", "user", notionConfigName, notionMcpUrl];
}
