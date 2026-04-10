import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { ProviderCapabilities, ProviderId, ProviderSettingOption } from "./types";

export const customModelOptionValue = "__custom__";

const defaultModelOption: ProviderSettingOption = { value: "", label: "기본값" };
const customModelOption: ProviderSettingOption = { value: customModelOptionValue, label: "직접 입력..." };
const defaultEffortOption: ProviderSettingOption = { value: "", label: "기본값" };
const execFileAsync = promisify(execFile);

const providerCapabilitiesMap: Record<ProviderId, ProviderCapabilities> = {
  codex: {
    modelOptions: [
      defaultModelOption,
      { value: "codex-mini-latest", label: "codex-mini-latest" },
      { value: "gpt-5.4", label: "gpt-5.4" },
      { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
      { value: "gpt-5.3-codex", label: "gpt-5.3-codex" },
      customModelOption
    ],
    effortOptions: [
      defaultEffortOption,
      { value: "low", label: "낮음" },
      { value: "medium", label: "중간" },
      { value: "high", label: "높음" },
      { value: "xhigh", label: "매우 높음" }
    ],
    supportsEffort: true
  },
  claude: {
    modelOptions: [
      defaultModelOption,
      { value: "sonnet", label: "Sonnet (alias)" },
      { value: "opus", label: "Opus (alias)" },
      customModelOption
    ],
    effortOptions: [
      defaultEffortOption,
      { value: "low", label: "낮음" },
      { value: "medium", label: "중간" },
      { value: "high", label: "높음" },
      { value: "max", label: "최대" }
    ],
    supportsEffort: true
  },
  gemini: {
    modelOptions: [
      defaultModelOption,
      { value: "auto", label: "Auto" },
      { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
      { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
      { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
      customModelOption
    ],
    effortOptions: [],
    supportsEffort: false
  }
};

export function getProviderCapabilities(providerId: ProviderId): ProviderCapabilities {
  return cloneProviderCapabilities(providerCapabilitiesMap[providerId]);
}

export async function loadProviderCapabilities(providerId: ProviderId, command: string): Promise<ProviderCapabilities> {
  const fallback = getProviderCapabilities(providerId);
  const discoveredOptions = await discoverProviderModelOptions(providerId, command);
  if (!discoveredOptions.length) {
    return fallback;
  }

  return {
    ...fallback,
    modelOptions: mergeModelOptions(fallback.modelOptions, discoveredOptions)
  };
}

export function normalizeProviderSettingValue(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isCustomModelSelection(
  providerId: ProviderId,
  configuredModel: string | undefined,
  capabilities = getProviderCapabilities(providerId)
): boolean {
  const normalizedModel = normalizeProviderSettingValue(configuredModel);
  if (!normalizedModel) {
    return false;
  }

  return !capabilities.modelOptions.some((option) => option.value === normalizedModel);
}

export function buildProviderArgs(
  providerId: ProviderId,
  prompt: string,
  _testOnly: boolean,
  settings: { model?: string; effort?: string }
): string[] {
  const model = normalizeProviderSettingValue(settings.model);
  const effort = normalizeProviderSettingValue(settings.effort);

  switch (providerId) {
    case "codex": {
      const args = ["exec", "--skip-git-repo-check", "--json"];
      if (model) {
        args.push("-m", model);
      }
      if (effort) {
        args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
      }
      args.push(prompt);
      return args;
    }
    case "claude": {
      const args: string[] = [];
      if (model) {
        args.push("--model", model);
      }
      if (effort) {
        args.push("--effort", effort);
      }
      args.push("-p", prompt);
      return args;
    }
    case "gemini": {
      const args: string[] = [];
      if (model) {
        args.push("-m", model);
      }
      args.push("-p", prompt, "--output-format", "stream-json");
      return args;
    }
    default:
      return [prompt];
  }
}

async function discoverProviderModelOptions(providerId: ProviderId, command: string): Promise<ProviderSettingOption[]> {
  switch (providerId) {
    case "claude":
      return parseClaudeDiscoveredModelOptions(await readCommandText(command));
    case "gemini":
      return parseGeminiDiscoveredModelOptions(await readGeminiModelsConfig(command));
    default:
      return [];
  }
}

export function parseClaudeDiscoveredModelOptions(source: string | undefined): ProviderSettingOption[] {
  if (!source) {
    return [];
  }

  const discovered = new Set<string>();
  for (const match of source.matchAll(/\bclaude-(?:haiku|sonnet|opus)-\d+-\d{1,2}\b/g)) {
    discovered.add(match[0]);
  }

  return [...discovered]
    .sort(compareClaudeModelValues)
    .map((value) => ({ value, label: formatClaudeModelLabel(value) }));
}

export function parseGeminiDiscoveredModelOptions(source: string | undefined): ProviderSettingOption[] {
  if (!source) {
    return [];
  }

  const discovered = new Set<string>();
  for (const match of source.matchAll(/["']((?:auto-)?gemini-[a-z0-9.-]+)["']/gi)) {
    const value = match[1];
    if (/customtools/i.test(value)) {
      continue;
    }

    discovered.add(value);
  }

  if (/["']auto["']/.test(source)) {
    discovered.add("auto");
  }

  return [...discovered].map((value) => ({ value, label: value === "auto" ? "Auto" : value }));
}

function mergeModelOptions(
  fallbackOptions: ProviderSettingOption[],
  discoveredOptions: ProviderSettingOption[]
): ProviderSettingOption[] {
  const merged: ProviderSettingOption[] = [];
  const seen = new Set<string>();

  const push = (option: ProviderSettingOption): void => {
    if (seen.has(option.value)) {
      return;
    }

    seen.add(option.value);
    merged.push({ ...option });
  };

  push(defaultModelOption);
  discoveredOptions.forEach(push);
  fallbackOptions.filter((option) => !isReservedModelOption(option.value)).forEach(push);
  push(customModelOption);
  return merged;
}

function cloneProviderCapabilities(capabilities: ProviderCapabilities): ProviderCapabilities {
  return {
    ...capabilities,
    modelOptions: capabilities.modelOptions.map((option) => ({ ...option })),
    effortOptions: capabilities.effortOptions.map((option) => ({ ...option }))
  };
}

async function readCommandText(command: string): Promise<string | undefined> {
  const locations = await resolveCommandLocations(command);

  for (const location of locations) {
    try {
      const buffer = await fs.readFile(location);
      return extractPrintableText(buffer);
    } catch {
      continue;
    }
  }

  return undefined;
}

async function readGeminiModelsConfig(command: string): Promise<string | undefined> {
  const locations = await resolveCommandLocations(command);
  const relativeCandidates = [
    "../node_modules/@google/gemini-cli-core/dist/src/config/models.js",
    "../node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js",
    "../lib/node_modules/@google/gemini-cli-core/dist/src/config/models.js",
    "../lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/config/models.js"
  ];

  for (const location of locations) {
    let currentDir = path.dirname(location);
    for (let depth = 0; depth < 6; depth += 1) {
      for (const relativeCandidate of relativeCandidates) {
        const filePath = path.resolve(currentDir, relativeCandidate);
        const text = await readTextFileIfExists(filePath);
        if (text) {
          return text;
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  return undefined;
}

async function resolveCommandLocations(command: string): Promise<string[]> {
  if (!path.isAbsolute(command)) {
    return [];
  }

  const locations = new Set<string>();
  const wslResolvedLocation = await resolveWslRealPath(command);
  if (wslResolvedLocation) {
    locations.add(wslResolvedLocation);
  }
  try {
    locations.add(await fs.realpath(command));
  } catch {
    // Ignore broken symlinks and unreadable commands; fallback discovery will apply.
  }
  locations.add(command);

  return [...locations];
}

async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function isReservedModelOption(value: string): boolean {
  return value === defaultModelOption.value || value === customModelOptionValue;
}

function compareClaudeModelValues(left: string, right: string): number {
  const leftParts = parseClaudeModelParts(left);
  const rightParts = parseClaudeModelParts(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right);
  }

  const familyDiff = claudeFamilyOrder(leftParts.family) - claudeFamilyOrder(rightParts.family);
  if (familyDiff !== 0) {
    return familyDiff;
  }

  if (leftParts.major !== rightParts.major) {
    return rightParts.major - leftParts.major;
  }

  return rightParts.minor - leftParts.minor;
}

function formatClaudeModelLabel(value: string): string {
  const parts = parseClaudeModelParts(value);
  if (!parts) {
    return value;
  }

  return `${capitalize(parts.family)} ${parts.major}.${parts.minor}`;
}

function parseClaudeModelParts(value: string): { family: string; major: number; minor: number } | undefined {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(value);
  if (!match) {
    return undefined;
  }

  return {
    family: match[1],
    major: Number(match[2]),
    minor: Number(match[3])
  };
}

function claudeFamilyOrder(family: string): number {
  switch (family) {
    case "sonnet":
      return 0;
    case "opus":
      return 1;
    case "haiku":
      return 2;
    default:
      return 3;
  }
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function extractPrintableText(buffer: Buffer): string {
  const segments: string[] = [];
  let current = "";

  for (const byte of buffer.values()) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= 4) {
      segments.push(current);
    }
    current = "";
  }

  if (current.length >= 4) {
    segments.push(current);
  }

  return segments.join("\n");
}

async function resolveWslRealPath(command: string): Promise<string | undefined> {
  if (process.platform !== "win32" || !command.startsWith("/")) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("wsl.exe", ["readlink", "-f", command], {
      windowsHide: true
    });
    const resolved = stdout.trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}
