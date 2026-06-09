import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import {
  buildProviderArgs,
  customModelOptionValue,
  getProviderCapabilities,
  isCustomModelSelection,
  loadProviderCapabilities,
  parseCodexDiscoveredModelOptions
} from "../core/providerOptions";
import { cleanupTempWorkspace, createTempWorkspace } from "./helpers";

test("codex args include model and effort config", () => {
  const args = buildProviderArgs("codex", "Reply with OK.", true, {
    model: "gpt-5.4",
    effort: "high"
  });

  assert.deepEqual(args, [
    "exec",
    "--skip-git-repo-check",
    "--json",
    "-m",
    "gpt-5.4",
    "-c",
    "model_reasoning_effort=\"high\"",
    "Reply with OK."
  ]);
});

test("codex args use stdin when the prompt argument is empty", () => {
  assert.deepEqual(
    buildProviderArgs("codex", "", false, {}),
    ["exec", "--skip-git-repo-check", "--json", "-"]
  );
});

test("claude args include model and effort flags", () => {
  const args = buildProviderArgs("claude", "Reply with OK.", false, {
    model: "sonnet",
    effort: "max"
  });

  assert.deepEqual(args, [
    "--model",
    "sonnet",
    "--effort",
    "max",
    "-p",
    "Reply with OK."
  ]);
});

test("gemini args request stream-json output", () => {
  const args = buildProviderArgs("gemini", "Reply with OK.", false, {
    model: "gemini-2.5-pro",
    effort: "high"
  });

  assert.deepEqual(args, [
    "-m",
    "gemini-2.5-pro",
    "-p",
    "Reply with OK.",
    "--output-format",
    "stream-json"
  ]);
});

test("provider capabilities expose custom model option and gemini has no effort support", () => {
  const codex = getProviderCapabilities("codex");
  const gemini = getProviderCapabilities("gemini");

  assert.ok(codex.modelOptions.some((option) => option.value === customModelOptionValue));
  assert.equal(gemini.supportsEffort, false);
  assert.deepEqual(gemini.effortOptions, []);
});

test("custom model detection distinguishes curated options from typed ones", () => {
  assert.equal(isCustomModelSelection("claude", "sonnet"), false);
  assert.equal(isCustomModelSelection("claude", "claude-sonnet-4-6"), true);
});

test("claude model discovery prefers explicit versions and keeps alias options available", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const commandPath = path.join(workspaceRoot, "claude");
  await fs.writeFile(
    commandPath,
    [
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-3-5",
      "claude-sonnet-4-5"
    ].join("\n"),
    "utf8"
  );

  const capabilities = await loadProviderCapabilities("claude", commandPath);
  assert.deepEqual(
    capabilities.modelOptions.slice(0, 5).map((option) => option.label),
    ["기본값", "Sonnet 4.6", "Sonnet 4.5", "Opus 4.6", "Haiku 3.5"]
  );
  assert.ok(capabilities.modelOptions.some((option) => option.value === "sonnet"));
  assert.ok(capabilities.modelOptions.some((option) => option.value === "opus"));
  assert.ok(capabilities.modelOptions.some((option) => option.value === "claude-haiku-3-5"));
  assert.equal(isCustomModelSelection("claude", "claude-sonnet-4-6", capabilities), false);
});

test("parseCodexDiscoveredModelOptions returns empty array for undefined source", () => {
  assert.deepEqual(parseCodexDiscoveredModelOptions(undefined), []);
});

test("parseCodexDiscoveredModelOptions returns empty array for invalid JSON", () => {
  assert.deepEqual(parseCodexDiscoveredModelOptions("not valid json"), []);
});

test("parseCodexDiscoveredModelOptions returns empty array when models field is missing", () => {
  assert.deepEqual(parseCodexDiscoveredModelOptions(JSON.stringify({ fetched_at: "2026-01-01" })), []);
});

test("parseCodexDiscoveredModelOptions returns empty array when models is not an array", () => {
  assert.deepEqual(parseCodexDiscoveredModelOptions(JSON.stringify({ models: "oops" })), []);
});

test("parseCodexDiscoveredModelOptions extracts only visibility:list entries", () => {
  const source = JSON.stringify({
    models: [
      { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
      { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide" },
      { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" }
    ]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.deepEqual(
    options.map((o) => o.value),
    ["gpt-5.5", "gpt-5.4"]
  );
});

test("parseCodexDiscoveredModelOptions uses slug as label, ignoring inconsistent display_name", () => {
  const source = JSON.stringify({
    models: [{ slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" }]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.equal(options[0]?.label, "gpt-5.5");
  assert.equal(options[0]?.value, "gpt-5.5");
});

test("parseCodexDiscoveredModelOptions falls back to slug when display_name is absent", () => {
  const source = JSON.stringify({
    models: [{ slug: "gpt-5.4", visibility: "list" }]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.equal(options[0]?.label, "gpt-5.4");
});

test("parseCodexDiscoveredModelOptions falls back to slug when display_name is empty string", () => {
  const source = JSON.stringify({
    models: [{ slug: "gpt-5.4", display_name: "", visibility: "list" }]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.equal(options[0]?.label, "gpt-5.4");
});

test("parseCodexDiscoveredModelOptions deduplicates entries with the same slug", () => {
  const source = JSON.stringify({
    models: [
      { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" },
      { slug: "gpt-5.5", display_name: "GPT-5.5 duplicate", visibility: "list" }
    ]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.value, "gpt-5.5");
});

test("parseCodexDiscoveredModelOptions skips non-object entries in models array", () => {
  const source = JSON.stringify({
    models: [null, "string-entry", 42, { slug: "gpt-5.4", visibility: "list" }]
  });
  const options = parseCodexDiscoveredModelOptions(source);
  assert.deepEqual(
    options.map((o) => o.value),
    ["gpt-5.4"]
  );
});

test("gemini exposes stable model aliases without dynamic discovery", () => {
  const capabilities = getProviderCapabilities("gemini");
  const values = capabilities.modelOptions.map((option) => option.value);

  assert.deepEqual(values, ["", "auto", "pro", "flash", "flash-lite", customModelOptionValue]);
  assert.equal(values.includes("gemini-2.5-pro"), false);
});
