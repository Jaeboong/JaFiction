import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderId } from "./types";

export const defaultProviderCommands: Record<ProviderId, string> = {
  codex: "codex",
  claude: "claude",
  gemini: "gemini"
};

export async function resolveProviderCommand(
  providerId: ProviderId,
  configuredCommand: string,
  homeDir = os.homedir()
): Promise<string> {
  const normalizedCommand = configuredCommand.trim() || defaultProviderCommands[providerId];
  if (!shouldSearchKnownLocations(providerId, normalizedCommand)) {
    return normalizedCommand;
  }

  const candidates = await listPreferredCommandCandidates(providerId, homeDir);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return normalizedCommand;
}

export function withCommandDirectoryInPath(baseEnv: NodeJS.ProcessEnv, command: string): NodeJS.ProcessEnv {
  if (!path.isAbsolute(command)) {
    return { ...baseEnv };
  }

  const commandDir = path.dirname(command);
  const currentPath = baseEnv.PATH ?? "";
  const delimiter = detectPathDelimiter(currentPath);
  const pathEntries = currentPath
    .split(delimiter)
    .filter(Boolean)
    .filter((entry) => !samePathEntry(entry, commandDir));

  return {
    ...baseEnv,
    PATH: [commandDir, ...pathEntries].join(delimiter)
  };
}

function shouldSearchKnownLocations(providerId: ProviderId, command: string): boolean {
  return command === defaultProviderCommands[providerId];
}

async function listPreferredCommandCandidates(providerId: ProviderId, homeDir: string): Promise<string[]> {
  const command = defaultProviderCommands[providerId];
  const candidates = [
    ...(await listNvmCandidates(homeDir, command)),
    path.join(homeDir, ".local", "bin", command),
    path.join(homeDir, "bin", command)
  ];

  return [...new Set(candidates)];
}

async function listNvmCandidates(homeDir: string, command: string): Promise<string[]> {
  const versionsRoot = path.join(homeDir, ".nvm", "versions", "node");

  try {
    const entries = await fs.readdir(versionsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true, sensitivity: "base" }))
      .map((entry) => path.join(versionsRoot, entry.name, "bin", command));
  } catch {
    return [];
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function detectPathDelimiter(currentPath: string): string {
  if (currentPath.includes(";")) {
    return ";";
  }

  if (currentPath.includes(":")) {
    return ":";
  }

  return path.delimiter;
}

function samePathEntry(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, "");
  return normalize(left) === normalize(right);
}
