import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  resolveNodeRuntime,
  resetNodeRuntimeCacheForTests,
  type CandidateProvider,
  type RuntimeVerifier
} from "../core/nodeRuntimeResolver";

// Fake npm/npx always pass so tests focus on node validation
function makeVerifier(options: {
  realpathMap?: Map<string, string>;
  executableSet?: Set<string>;
  isWindows?: boolean;
}): RuntimeVerifier {
  const { realpathMap = new Map(), executableSet = new Set(), isWindows = false } = options;

  return {
    realpath(candidate: string): string | null {
      if (realpathMap.has(candidate)) {
        return realpathMap.get(candidate)!;
      }
      // Default: resolved == candidate
      return candidate;
    },
    isWindows(): boolean {
      return isWindows;
    },
    verifyNode(bin: string): boolean {
      return executableSet.has(bin);
    },
    verifyCompanion(bin: string, _binDir: string): boolean {
      return executableSet.has(bin);
    }
  };
}

function makeProvider(candidates: readonly string[]): CandidateProvider {
  return { listCandidates: () => candidates };
}

test("skips WSL Windows stub (.exe realpath) and falls through to next candidate", () => {
  resetNodeRuntimeCacheForTests();

  const homeDir = os.homedir();
  const localBinNode = path.join(homeDir, ".local", "bin", "node");
  const nvmNode = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "node");
  const nvmNpm = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "npm");
  const nvmNpx = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "npx");

  const realpathMap = new Map([
    [localBinNode, "/mnt/c/Program Files/nodejs/node.exe"],
    [nvmNode, nvmNode],
    [nvmNpm, nvmNpm],
    [nvmNpx, nvmNpx]
  ]);
  const executableSet = new Set([nvmNode, nvmNpm, nvmNpx]);

  const provider = makeProvider([localBinNode, nvmNode]);
  const verifier = makeVerifier({ realpathMap, executableSet });

  const runtime = resolveNodeRuntime(provider, verifier);
  assert.equal(runtime.nodeBin, nvmNode);
});

test("skips WSL Windows stub (/mnt/ realpath) and falls through to next candidate", () => {
  resetNodeRuntimeCacheForTests();

  const homeDir = os.homedir();
  const localBinNode = path.join(homeDir, ".local", "bin", "node");
  const nvmNode = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "node");
  const nvmNpm = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "npm");
  const nvmNpx = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "npx");

  const realpathMap = new Map([
    [localBinNode, "/mnt/c/windows/node"]
  ]);
  const executableSet = new Set([nvmNode, nvmNpm, nvmNpx]);

  const provider = makeProvider([localBinNode, nvmNode]);
  const verifier = makeVerifier({ realpathMap, executableSet });

  const runtime = resolveNodeRuntime(provider, verifier);
  assert.equal(runtime.nodeBin, nvmNode);
});

test("selects the candidate provided first (caller is responsible for ordering by version)", () => {
  resetNodeRuntimeCacheForTests();

  const homeDir = os.homedir();
  const newerNode = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "node");
  const newerNpm = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "npm");
  const newerNpx = path.join(homeDir, ".nvm", "versions", "node", "v22.0.0", "bin", "npx");
  const olderNode = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "node");
  const olderNpm = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "npm");
  const olderNpx = path.join(homeDir, ".nvm", "versions", "node", "v20.0.0", "bin", "npx");

  const executableSet = new Set([newerNode, newerNpm, newerNpx, olderNode, olderNpm, olderNpx]);

  // Simulate caller listing newer first
  const provider = makeProvider([newerNode, olderNode]);
  const verifier = makeVerifier({ executableSet });

  const runtime = resolveNodeRuntime(provider, verifier);
  assert.equal(runtime.nodeBin, newerNode);
  assert.equal(runtime.binDir, path.dirname(newerNode));
});

test("throws with candidate list and JAFICTION_NODE_BIN hint when all candidates fail", () => {
  resetNodeRuntimeCacheForTests();

  const provider = makeProvider(["/fake/node/bin/node", "/another/fake/bin/node"]);
  // No executables pass
  const verifier = makeVerifier({ executableSet: new Set() });

  assert.throws(
    () => resolveNodeRuntime(provider, verifier),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("/fake/node/bin/node"), "should list checked candidates");
      assert.ok(error.message.includes("/another/fake/bin/node"), "should list all candidates");
      assert.ok(error.message.includes("JAFICTION_NODE_BIN"), "should mention override env var");
      return true;
    }
  );
});

test("does not skip .exe realpath on Windows", () => {
  resetNodeRuntimeCacheForTests();

  // Use forward-slash paths so path.join works correctly on the Linux test runner
  const winNode = "/c/Program Files/nodejs/node.exe";
  const winNpm = "/c/Program Files/nodejs/npm.cmd";
  const winNpx = "/c/Program Files/nodejs/npx.cmd";

  const realpathMap = new Map([[winNode, winNode]]);
  const executableSet = new Set([winNode, winNpm, winNpx]);

  const provider = makeProvider([winNode]);
  const verifier = makeVerifier({ realpathMap, executableSet, isWindows: true });

  const runtime = resolveNodeRuntime(provider, verifier);
  assert.equal(runtime.nodeBin, winNode);
});

test("returns npm.cmd and npx.cmd on Windows", () => {
  resetNodeRuntimeCacheForTests();

  const winBinDir = "/c/Program Files/nodejs";
  const winNode = `${winBinDir}/node.exe`;
  const winNpmCmd = `${winBinDir}/npm.cmd`;
  const winNpxCmd = `${winBinDir}/npx.cmd`;

  const realpathMap = new Map([[winNode, winNode]]);
  const executableSet = new Set([winNode, winNpmCmd, winNpxCmd]);

  const provider = makeProvider([winNode]);
  const verifier = makeVerifier({ realpathMap, executableSet, isWindows: true });

  const runtime = resolveNodeRuntime(provider, verifier);
  assert.equal(runtime.npmBin, winNpmCmd);
  assert.equal(runtime.npxBin, winNpxCmd);
});

test("caches result so second call returns the same object", () => {
  resetNodeRuntimeCacheForTests();

  const nodebin = "/usr/local/bin/node";
  const npmbin = "/usr/local/bin/npm";
  const npxbin = "/usr/local/bin/npx";

  const executableSet = new Set([nodebin, npmbin, npxbin]);
  const provider = makeProvider([nodebin]);
  const verifier = makeVerifier({ executableSet });

  const first = resolveNodeRuntime(provider, verifier);
  // Second call uses a provider/verifier that always fails — but the cache should win
  const alwaysFail = makeVerifier({ executableSet: new Set() });
  const second = resolveNodeRuntime(makeProvider([nodebin]), alwaysFail);

  assert.strictEqual(first, second);
});
