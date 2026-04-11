import {
  NotionConnectPlan,
  NotionMcpCheckResult,
  inferConnectedStatus,
  joinPlanCommands,
  notionConfigName
} from "./notionMcp";

const notionMcpNpmPackage = "@notionhq/notion-mcp-server";

export function parseClaudeNotionStatus(output: string): NotionMcpCheckResult {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => /^[^:]*notion[^:]*:/i.test(line));
  if (!match) {
    return { configured: false, connected: false, message: "Notion MCP is not configured for Claude Code." };
  }

  const connected = inferConnectedStatus(match);
  return {
    configured: true,
    connected,
    configName: inferConfigName(match),
    message: `Notion MCP is available for Claude Code: ${match}`
  };
}

export function buildClaudeNotionConnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string,
  notionToken?: string
): NotionConnectPlan {
  if (!notionToken) {
    return {
      message: "Notion Integration Token이 필요합니다. Claude Code 카드의 인증 토큰 입력란에 토큰을 입력하세요."
    };
  }

  const targetName = currentStatus.configName ?? notionConfigName;
  const addSteps = [{ args: addStdioArgs(notionToken) }];

  if (currentStatus.configured) {
    const steps = [
      { args: ["mcp", "remove", "--scope", "user", targetName] },
      ...addSteps
    ];
    return {
      message: "Opening a terminal to refresh the Notion MCP connection for Claude Code.",
      steps,
      commandLine: joinPlanCommands(providerCommand, steps, platform)
    };
  }

  return {
    message: "Opening a terminal to add the Notion MCP preset for Claude Code.",
    steps: addSteps,
    commandLine: joinPlanCommands(providerCommand, addSteps, platform)
  };
}

export function buildClaudeNotionDisconnectPlan(
  providerCommand: string,
  currentStatus: NotionMcpCheckResult,
  platform: string
): NotionConnectPlan {
  if (!currentStatus.configured) {
    return { message: "Notion MCP is not configured for Claude Code." };
  }

  const targetName = currentStatus.configName ?? notionConfigName;
  const steps = [{ args: ["mcp", "remove", "--scope", "user", targetName] }];
  return {
    message: "Opening a terminal to remove the Notion MCP connection from Claude Code.",
    steps,
    commandLine: joinPlanCommands(providerCommand, steps, platform)
  };
}

function addStdioArgs(notionToken: string): string[] {
  const headerValue = `OPENAPI_MCP_HEADERS={"Authorization":"Bearer ${notionToken}","Notion-Version":"2022-06-28"}`;
  return [
    "mcp",
    "add",
    notionConfigName,
    "--scope",
    "user",
    "-e",
    headerValue,
    "--",
    "npx",
    "-y",
    notionMcpNpmPackage
  ];
}

function inferConfigName(line: string): string {
  const prefix = line.split(":")[0]?.trim();
  return prefix || notionConfigName;
}
