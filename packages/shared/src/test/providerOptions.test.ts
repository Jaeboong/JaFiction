import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import {
  buildProviderArgs,
  customModelOptionValue,
  getProviderCapabilities,
  isCustomModelSelection,
  loadProviderCapabilities
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

test("gemini model discovery reads installed config values and filters internal-only models", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const commandPath = path.join(workspaceRoot, "bin", "gemini");
  const modelsPath = path.join(
    workspaceRoot,
    "node_modules",
    "@google",
    "gemini-cli-core",
    "dist",
    "src",
    "config",
    "models.js"
  );
  await fs.mkdir(path.dirname(commandPath), { recursive: true });
  await fs.mkdir(path.dirname(modelsPath), { recursive: true });
  await fs.writeFile(commandPath, "", "utf8");
  await fs.writeFile(
    modelsPath,
    [
      "export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';",
      "export const PREVIEW_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';",
      "export const PREVIEW_GEMINI_CUSTOM_MODEL = 'gemini-3.1-pro-preview-customtools';",
      "export const GEMINI_MODEL_ALIAS_AUTO = 'auto';"
    ].join("\n"),
    "utf8"
  );

  const capabilities = await loadProviderCapabilities("gemini", commandPath);
  const values = capabilities.modelOptions.map((option) => option.value);

  assert.ok(values.includes("auto"));
  assert.ok(values.includes("gemini-2.5-pro"));
  assert.ok(values.includes("gemini-3-flash-preview"));
  assert.equal(values.includes("gemini-3.1-pro-preview-customtools"), false);
});
