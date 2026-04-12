import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getNodeRuntime } from "./nodeRuntimeResolver";
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
  const currentPath = baseEnv.PATH ?? "";
  const delimiter = detectPathDelimiter(currentPath);

  // Prepend the verified node runtime binDir so the provider's child
  // processes (e.g. MCP stdio servers) inherit the Linux node binary, not a
  // Windows stub that may appear earlier in the ambient PATH on WSL.
  // If Node.js is not found (e.g. end-user machine without Node), skip injection.
  let nodeDir: string | null = null;
  try {
    nodeDir = getNodeRuntime().binDir;
  } catch {
    // Node.js not available on this machine — proceed without injecting node path
  }

  const filterEntries = (entries: string[]): string[] =>
    nodeDir
      ? entries.filter((e) => !samePathEntry(e, nodeDir as string))
      : entries;

  if (!path.isAbsolute(command)) {
    const pathEntries = filterEntries(currentPath.split(delimiter).filter(Boolean));
    return {
      ...baseEnv,
      PATH: nodeDir
        ? [nodeDir, ...pathEntries].join(delimiter)
        : pathEntries.join(delimiter)
    };
  }

  const commandDir = path.dirname(command);
  const pathEntries = filterEntries(
    currentPath
      .split(delimiter)
      .filter(Boolean)
      .filter((entry) => !samePathEntry(entry, commandDir))
  );

  return {
    ...baseEnv,
    PATH: nodeDir
      ? [nodeDir, commandDir, ...pathEntries].join(delimiter)
      : [commandDir, ...pathEntries].join(delimiter)
  };
}

function shouldSearchKnownLocations(providerId: ProviderId, command: string): boolean {
  return command === defaultProviderCommands[providerId];
}

async function listPreferredCommandCandidates(providerId: ProviderId, homeDir: string): Promise<string[]> {
  const command = defaultProviderCommands[providerId];
  const isWindows = process.platform === "win32";
  const exe = isWindows ? `${command}.exe` : command;

  const candidates = [
    ...(await listNvmCandidates(homeDir, exe)),
    path.join(homeDir, ".local", "bin", exe),
    path.join(homeDir, "bin", exe)
  ];

  if (isWindows) {
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(homeDir, "AppData", "Local");
    candidates.push(path.join(localAppData, "Programs", command, exe));

    // npm global (AppData\Roaming\npm) — .cmd 래퍼 경로 추가
    const npmGlobal = process.env["APPDATA"]
      ? path.join(process.env["APPDATA"], "npm")
      : path.join(homeDir, "AppData", "Roaming", "npm");
    candidates.push(path.join(npmGlobal, `${command}.cmd`));
  }

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
