import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { NotionMcpCheckResult } from "../core/notionMcp";
import { resolveNodeRuntime, resetNodeRuntimeCacheForTests } from "../core/nodeRuntimeResolver";
import { getProviderCapabilities } from "../core/providerOptions";
import { resolveProviderCommand, withCommandDirectoryInPath } from "../core/providerCommandResolver";
import { ProviderRegistry } from "../core/providers";
import { ProviderId, ProviderRuntimeState, RunAbortedError } from "../core/types";
import { cleanupTempWorkspace, createTempWorkspace } from "./helpers";

const FAKE_NODE_BIN_DIR = "/fake/node/bin";

function seedFakeNodeRuntime(): void {
  resetNodeRuntimeCacheForTests();
  resolveNodeRuntime(
    { listCandidates: () => [path.join(FAKE_NODE_BIN_DIR, "node")] },
    {
      realpath: (c) => c,
      isWindows: () => false,
      verifyNode: (bin) => bin === path.join(FAKE_NODE_BIN_DIR, "node"),
      verifyCompanion: (bin, _binDir) =>
        [path.join(FAKE_NODE_BIN_DIR, "npm"), path.join(FAKE_NODE_BIN_DIR, "npx")].includes(bin)
    }
  );
}

test("provider command resolver prefers the newest nvm-installed CLI", async (t) => {
  const fakeHome = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(fakeHome));

  const older = path.join(fakeHome, ".nvm", "versions", "node", "v20.12.2", "bin");
  const newer = path.join(fakeHome, ".nvm", "versions", "node", "v22.22.2", "bin");
  await fs.mkdir(older, { recursive: true });
  await fs.mkdir(newer, { recursive: true });
  await fs.writeFile(path.join(older, "codex"), "");
  await fs.writeFile(path.join(newer, "codex"), "");

  const command = await resolveProviderCommand("codex", "codex", fakeHome);
  assert.equal(command, path.join(newer, "codex"));
});

test("provider command resolver keeps explicit custom commands untouched", async () => {
  const command = await resolveProviderCommand("gemini", "/custom/tools/gemini");
  assert.equal(command, "/custom/tools/gemini");
});

test("runtime environment prepends the node runtime bin dir and command directory to PATH", () => {
  seedFakeNodeRuntime();

  const env = withCommandDirectoryInPath(
    {
      PATH: "/usr/local/bin:/usr/bin"
    },
    "/home/test/.nvm/versions/node/v22.22.2/bin/gemini"
  );

  assert.equal(
    env.PATH,
    `${FAKE_NODE_BIN_DIR}:/home/test/.nvm/versions/node/v22.22.2/bin:/usr/local/bin:/usr/bin`
  );
});

test("runtime environment moves command directory to front, node runtime bin dir is first", () => {
  seedFakeNodeRuntime();

  const env = withCommandDirectoryInPath(
    {
      PATH: "/home/test/.local/bin:/usr/local/bin:/home/test/.nvm/versions/node/v22.22.2/bin:/usr/bin"
    },
    "/home/test/.nvm/versions/node/v22.22.2/bin/codex"
  );

  assert.equal(
    env.PATH,
    `${FAKE_NODE_BIN_DIR}:/home/test/.nvm/versions/node/v22.22.2/bin:/home/test/.local/bin:/usr/local/bin:/usr/bin`
  );
});

test("provider execution rejects with RunAbortedError when aborted", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const commandPath = path.join(workspaceRoot, "fake-codex");
  await fs.writeFile(
    commandPath,
    "#!/usr/bin/env bash\nwhile true; do sleep 1; done\n",
    "utf8"
  );
  await fs.chmod(commandPath, 0o755);

  const registry = new ProviderRegistry(
    {
      get(key, fallback) {
        if (key === "providers.codex.command") {
          return commandPath;
        }
        return fallback;
      },
      async set() {}
    },
    {
      async get() {
        return undefined;
      },
      async store() {},
      async delete() {}
    },
    {
      storageRoot: workspaceRoot,
      async loadProviderStatuses() {
        return {
          codex: undefined,
          claude: undefined,
          gemini: undefined
        };
      },
      async saveProviderStatus() {}
    }
  );

  const controller = new AbortController();
  const execution = registry.execute("codex", "Reply with OK.", {
    cwd: workspaceRoot,
    authMode: "cli",
    abortSignal: controller.signal
  });

  setTimeout(() => controller.abort(), 25);

  await assert.rejects(execution, RunAbortedError);
});

test("gemini notion connect runs OAuth after MCP plan refresh", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const commandPath = path.join(workspaceRoot, "fake-gemini");
  await fs.writeFile(
    commandPath,
    "#!/usr/bin/env bash\nexit 0\n",
    "utf8"
  );
  await fs.chmod(commandPath, 0o755);

  class TestProviderRegistry extends ProviderRegistry {
    readonly oauthCalls: string[] = [];

    override async checkNotionMcp(_providerId: ProviderId): Promise<NotionMcpCheckResult> {
      return {
        configured: false,
        connected: false,
        configName: "notion",
        message: "Notion MCP is not configured for Gemini."
      };
    }

    override async refreshRuntimeState(providerId: ProviderId): Promise<ProviderRuntimeState> {
      return {
        providerId,
        installed: true,
        authMode: "cli",
        authStatus: "untested",
        command: commandPath,
        hasApiKey: false,
        capabilities: getProviderCapabilities(providerId)
      };
    }

    protected override async performGeminiNotionOAuth(serverName: string): Promise<void> {
      this.oauthCalls.push(serverName);
    }
  }

  const registry = new TestProviderRegistry(
    {
      get(key, fallback) {
        if (key === "providers.gemini.command") {
          return commandPath;
        }
        return fallback;
      },
      async set() {}
    },
    {
      async get() {
        return undefined;
      },
      async store() {},
      async delete() {}
    },
    {
      storageRoot: workspaceRoot,
      async loadProviderStatuses() {
        return {
          codex: undefined,
          claude: undefined,
          gemini: undefined
        };
      },
      async saveProviderStatus() {}
    }
  );

  await registry.connectNotionMcp("gemini");
  assert.deepEqual(registry.oauthCalls, ["notion"]);
});
