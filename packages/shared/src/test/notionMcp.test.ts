import * as assert from "node:assert/strict";
import test from "node:test";
import {
  buildNotionDisconnectPlan,
  buildNotionConnectPlan,
  parseClaudeNotionStatus,
  parseCodexNotionStatus,
  parseGeminiNotionStatus
} from "../core/notionMcp";

test("codex notion parser recognizes official notion server from JSON output", () => {
  const result = parseCodexNotionStatus(
    JSON.stringify([
      {
        name: "notion",
        transport: {
          type: "streamable_http",
          url: "https://mcp.notion.com/mcp"
        }
      }
    ])
  );

  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
  assert.equal(result.configName, "notion");
});

test("claude notion parser recognizes connected notion line", () => {
  const result = parseClaudeNotionStatus(
    "Checking MCP server health...\n\nclaude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected\n"
  );

  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
  assert.match(result.message, /Claude Code/i);
});

test("gemini notion parser recognizes missing configuration", () => {
  const result = parseGeminiNotionStatus("No MCP servers configured.\n");
  assert.equal(result.configured, false);
  assert.equal(result.connected, false);
});

test("gemini notion parser recognizes disconnected configuration", () => {
  const result = parseGeminiNotionStatus(
    "Notion MCP is configured for Gemini: ✗ notion: https://mcp.notion.com/mcp (http) - Disconnected\n"
  );

  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
});

test("codex connect plan adds and logs in when notion is not configured", () => {
  const plan = buildNotionConnectPlan("codex", "/home/test/.nvm/bin/codex", { configured: false, connected: false, message: "missing" }, "linux");
  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'add'/);
  assert.match(plan.commandLine!, /'mcp' 'login'/);
});

test("gemini reconnect plan refreshes a disconnected notion configuration", () => {
  const plan = buildNotionConnectPlan(
    "gemini",
    "/home/test/.nvm/bin/gemini",
    { configured: true, connected: false, configName: "notion", message: "disconnected" },
    "linux"
  );

  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'remove' 'notion'/);
  assert.match(plan.commandLine!, /'mcp' 'add' '--transport' 'http' '--scope' 'user' 'notion'/);
});

test("claude disconnect plan removes the notion connection", () => {
  const plan = buildNotionDisconnectPlan(
    "claude",
    "/home/test/.local/bin/claude",
    { configured: true, connected: true, configName: "notion", message: "configured" },
    "linux"
  );

  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'remove' '--scope' 'user' 'notion'/);
});
