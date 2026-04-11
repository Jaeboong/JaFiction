import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

export interface NodeRuntime {
  readonly nodeBin: string;
  readonly npmBin: string;
  readonly npxBin: string;
  readonly binDir: string;
}

// Injection points for testability
export interface CandidateProvider {
  listCandidates(homeDir: string): readonly string[];
}

export interface RuntimeVerifier {
  realpath(candidate: string): string | null;
  isWindows(): boolean;
  verifyNode(bin: string): boolean;
  verifyCompanion(bin: string, binDir: string): boolean;
}

let cachedRuntime: NodeRuntime | null = null;

export function resolveNodeRuntime(
  provider?: CandidateProvider,
  verifier?: RuntimeVerifier
): NodeRuntime {
  if (cachedRuntime !== null) {
    return cachedRuntime;
  }

  const effectiveProvider = provider ?? defaultCandidateProvider;
  const effectiveVerifier = verifier ?? defaultRuntimeVerifier;

  const homeDir = os.homedir();
  const candidates = effectiveProvider.listCandidates(homeDir);
  const checkedCandidates: string[] = [];

  for (const candidate of candidates) {
    checkedCandidates.push(candidate);

    const resolved = effectiveVerifier.realpath(candidate);
    if (resolved === null) {
      continue;
    }

    // Skip Windows stubs unless we're actually on Windows
    if (!effectiveVerifier.isWindows()) {
      if (resolved.endsWith(".exe") || resolved.startsWith("/mnt/")) {
        continue;
      }
    }

    if (!effectiveVerifier.verifyNode(resolved)) {
      continue;
    }

    const binDir = path.dirname(resolved);
    const npmBin = findCompanionBin(binDir, "npm", effectiveVerifier);
    const npxBin = findCompanionBin(binDir, "npx", effectiveVerifier);

    if (npmBin === null || npxBin === null) {
      continue;
    }

    const runtime: NodeRuntime = { nodeBin: resolved, npmBin, npxBin, binDir };
    cachedRuntime = runtime;
    return runtime;
  }

  const candidateList = checkedCandidates.map((c) => `  - ${c}`).join("\n");
  throw new Error(
    `Unable to locate a usable Node.js runtime.\n` +
      `Checked candidates:\n${candidateList}\n\n` +
      `To override, set the JAFICTION_NODE_BIN environment variable to an absolute path to the node binary.`
  );
}

export function getNodeRuntime(): NodeRuntime {
  if (cachedRuntime === null) {
    throw new Error(
      "Node runtime has not been initialized. Call resolveNodeRuntime() during startup before using getNodeRuntime()."
    );
  }
  return cachedRuntime;
}

export function resetNodeRuntimeCacheForTests(): void {
  cachedRuntime = null;
}

function findCompanionBin(
  binDir: string,
  name: string,
  verifier: RuntimeVerifier
): string | null {
  const isWin = verifier.isWindows();
  const names = isWin ? [`${name}.cmd`, name] : [name];

  for (const candidate of names) {
    const full = path.join(binDir, candidate);
    if (verifier.verifyCompanion(full, binDir)) {
      return full;
    }
  }
  return null;
}

// --- Default implementations ---

const defaultCandidateProvider: CandidateProvider = {
  listCandidates(homeDir: string): readonly string[] {
    const candidates: string[] = [];

    // 1. Explicit override
    const override = process.env["JAFICTION_NODE_BIN"];
    if (override) {
      candidates.push(override);
    }

    // 2. Version managers — nvm (newest version first)
    const nvmVersionsRoot = path.join(homeDir, ".nvm", "versions", "node");
    try {
      const entries = fs.readdirSync(nvmVersionsRoot, { withFileTypes: true });
      const sorted = entries
        .filter((e) => e.isDirectory())
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
        );
      for (const entry of sorted) {
        candidates.push(path.join(nvmVersionsRoot, entry.name, "bin", "node"));
      }
    } catch {
      // nvm not present
    }

    // fnm
    const fnmRoot = path.join(homeDir, ".local", "share", "fnm", "node-versions");
    try {
      const entries = fs.readdirSync(fnmRoot, { withFileTypes: true });
      const sorted = entries
        .filter((e) => e.isDirectory())
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
        );
      for (const entry of sorted) {
        candidates.push(path.join(fnmRoot, entry.name, "installation", "bin", "node"));
      }
    } catch {
      // fnm not present
    }

    // volta
    const voltaRoot = path.join(homeDir, ".volta", "tools", "image", "node");
    try {
      const entries = fs.readdirSync(voltaRoot, { withFileTypes: true });
      const sorted = entries
        .filter((e) => e.isDirectory())
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
        );
      for (const entry of sorted) {
        candidates.push(path.join(voltaRoot, entry.name, "bin", "node"));
      }
    } catch {
      // volta not present
    }

    // asdf
    const asdfRoot = path.join(homeDir, ".asdf", "installs", "nodejs");
    try {
      const entries = fs.readdirSync(asdfRoot, { withFileTypes: true });
      const sorted = entries
        .filter((e) => e.isDirectory())
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
        );
      for (const entry of sorted) {
        candidates.push(path.join(asdfRoot, entry.name, "bin", "node"));
      }
    } catch {
      // asdf not present
    }

    // 3. Package manager standard paths
    for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
      candidates.push(path.join(dir, "node"));
    }

    // 4. PATH entries in order
    const pathVar = process.env["PATH"] ?? "";
    const delimiter = pathVar.includes(";") ? ";" : ":";
    for (const dir of pathVar.split(delimiter).filter(Boolean)) {
      candidates.push(path.join(dir, "node"));
    }

    // 5. ~/.local/bin last (may contain WSL Windows stubs)
    candidates.push(path.join(homeDir, ".local", "bin", "node"));

    return candidates;
  }
};

const defaultRuntimeVerifier: RuntimeVerifier = {
  realpath(candidate: string): string | null {
    try {
      return fs.realpathSync(candidate);
    } catch {
      return null;
    }
  },

  isWindows(): boolean {
    return process.platform === "win32";
  },

  verifyNode(bin: string): boolean {
    const result = spawnSync(bin, ["-e", "process.exit(0)"], {
      timeout: 3000,
      stdio: "ignore"
    });
    return result.status === 0;
  },

  verifyCompanion(bin: string, binDir: string): boolean {
    // npm/npx는 #!/usr/bin/env node shebang을 가진 .js 심볼릭링크라서
    // PATH에 node가 없으면 exec 실패 → binDir을 env.PATH 앞에 주입.
    const parentPath = process.env["PATH"] ?? "";
    const delimiter = parentPath.includes(";") ? ";" : ":";
    const env = { ...process.env, PATH: `${binDir}${delimiter}${parentPath}` };
    const result = spawnSync(bin, ["--version"], {
      timeout: 3000,
      stdio: "ignore",
      env
    });
    return result.status === 0;
  }
};
