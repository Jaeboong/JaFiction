import * as assert from "node:assert/strict";
import test from "node:test";
import { parseCodexNotionStatus, buildCodexNotionConnectPlan } from "../core/notionMcpCodex";
import {
  parseClaudeNotionStatus,
  buildClaudeNotionConnectPlan,
  buildClaudeNotionDisconnectPlan
} from "../core/notionMcpClaude";
import {
  parseGeminiNotionStatus,
  buildGeminiNotionConnectPlan
} from "../core/notionMcpGemini";

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

test("claude notion parser treats needs-authentication line as not connected", () => {
  const result = parseClaudeNotionStatus(
    "Checking MCP server health...\n\nnotion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication\n"
  );

  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
});

test("claude notion parser recognizes stdio notion-mcp-server line", () => {
  const result = parseClaudeNotionStatus(
    "Checking MCP server health...\n\nnotion: npx -y @notionhq/notion-mcp-server - ✓ Connected\n"
  );

  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
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
  const plan = buildCodexNotionConnectPlan(
    "/home/test/.nvm/bin/codex",
    { configured: false, connected: false, message: "missing" },
    "linux"
  );
  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'add'/);
  assert.match(plan.commandLine!, /'mcp' 'login'/);
});

test("gemini reconnect plan refreshes a disconnected notion configuration", () => {
  const plan = buildGeminiNotionConnectPlan(
    "/home/test/.nvm/bin/gemini",
    { configured: true, connected: false, configName: "notion", message: "disconnected" },
    "linux"
  );

  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'remove' '--scope' 'user' 'notion'/);
  assert.match(plan.commandLine!, /'mcp' 'add' '--transport' 'http' '--scope' 'user' 'notion'/);
});

test("claude connect plan without token returns guidance message only", () => {
  const plan = buildClaudeNotionConnectPlan(
    "/home/test/.local/bin/claude",
    { configured: false, connected: false, message: "missing" },
    "linux",
    undefined
  );
  assert.equal(plan.steps, undefined);
  assert.match(plan.message, /Integration Token/);
});

test("claude connect plan with token builds stdio npx add command", () => {
  const plan = buildClaudeNotionConnectPlan(
    "/home/test/.local/bin/claude",
    { configured: false, connected: false, message: "missing" },
    "linux",
    "ntn_exampleTokenValue123"
  );
  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'add' 'notion' '--scope' 'user' '-e'/);
  assert.match(plan.commandLine!, /OPENAPI_MCP_HEADERS/);
  assert.match(plan.commandLine!, /Bearer ntn_exampleTokenValue123/);
  assert.match(plan.commandLine!, /'--' 'npx' '-y' '@notionhq\/notion-mcp-server'/);
});

test("claude disconnect plan removes the notion connection", () => {
  const plan = buildClaudeNotionDisconnectPlan(
    "/home/test/.local/bin/claude",
    { configured: true, connected: true, configName: "notion", message: "configured" },
    "linux"
  );

  assert.ok(plan.commandLine);
  assert.match(plan.commandLine!, /'mcp' 'remove' '--scope' 'user' 'notion'/);
});
