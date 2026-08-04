import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import {
  parseCodexNotionStatus,
  buildCodexNotionConnectPlan,
  repairCodexNotionConfigFile,
  repairCodexNotionConfigText
} from "../core/notionMcpCodex";
import {
  parseClaudeNotionStatus,
  buildClaudeNotionConnectPlan,
  buildClaudeNotionDisconnectPlan
} from "../core/notionMcpClaude";
import {
  parseGeminiNotionStatus,
  buildGeminiNotionConnectPlan
} from "../core/notionMcpGemini";
import { cleanupTempWorkspace, createTempWorkspace } from "./helpers";

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

test("codex notion config repair replaces mixed stdio and HTTP settings", () => {
  const input = [
    'model = "gpt-5.4"',
    "",
    "[mcp_servers.notion]",
    'command = "npx"',
    'args = ["-y", "@notionhq/notion-mcp-server"]',
    'url = "https://mcp.notion.com/mcp"',
    "",
    "[mcp_servers.notion.env]",
    'OPENAPI_MCP_HEADERS = "{\\"Authorization\\": \\"Bearer secret\\"}"',
    "",
    "[mcp_servers.github]",
    'url = "https://example.com/mcp"',
    ""
  ].join("\n");

  const result = repairCodexNotionConfigText(input);

  assert.equal(result.repaired, true);
  assert.match(result.text, /\[mcp_servers\.notion\]\nurl = "https:\/\/mcp\.notion\.com\/mcp"/);
  assert.doesNotMatch(result.text, /@notionhq\/notion-mcp-server/);
  assert.doesNotMatch(result.text, /OPENAPI_MCP_HEADERS/);
  assert.match(result.text, /\[mcp_servers\.github\]\nurl = "https:\/\/example\.com\/mcp"/);
  assert.match(result.text, /model = "gpt-5\.4"/);
});

test("codex notion config repair leaves valid HTTP settings unchanged", () => {
  const input = [
    "[mcp_servers.notion]",
    'url = "https://mcp.notion.com/mcp"',
    "enabled = true",
    ""
  ].join("\n");

  assert.deepEqual(repairCodexNotionConfigText(input), {
    repaired: false,
    text: input
  });
});

test("codex notion config repair ignores unrelated custom notion servers", () => {
  const input = [
    "[mcp_servers.notion]",
    'command = "custom-notion-proxy"',
    'args = ["--stdio"]',
    ""
  ].join("\n");

  assert.deepEqual(repairCodexNotionConfigText(input), {
    repaired: false,
    text: input
  });
});

test("codex notion config file repair writes a backup before replacement", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const configPath = path.join(workspaceRoot, "config.toml");
  const source = [
    "[mcp_servers.notion]",
    'command = "npx"',
    'args = ["-y", "@notionhq/notion-mcp-server"]',
    'url = "https://mcp.notion.com/mcp"',
    ""
  ].join("\n");
  await fs.writeFile(configPath, source, "utf8");

  assert.equal(await repairCodexNotionConfigFile(configPath), true);
  assert.equal(await fs.readFile(`${configPath}.jasojeon-backup`, "utf8"), source);
  assert.equal(
    await fs.readFile(configPath, "utf8"),
    '[mcp_servers.notion]\nurl = "https://mcp.notion.com/mcp"'
  );
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
