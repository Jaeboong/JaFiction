import * as os from "node:os";
import * as path from "node:path";
import {
  ContextCompiler,
  ForJobStorage,
  ProviderRegistry,
  ReviewOrchestrator,
  RunEvent,
  RunSessionManager,
  SidebarState,
  SidebarStateStore
} from "@jasojeon/shared";
import { version } from "../package.json";
import { RunnerConfig } from "./runnerConfig";
import { FileSecretStore } from "./secretStore";
import { RunHub } from "./ws/runHub";
import { StateHub } from "./ws/stateHub";

export const openDartSecretKey = "jasojeon.apiKey.openDart";

export interface RunnerContext {
  readonly workspaceRoot: string;
  readonly storageRoot: string;
  readonly stateStore: SidebarStateStore;
  readonly runSessions: RunSessionManager;
  /** Exposed for hosted event forwarding — subscribe with onSnapshot/onEvent. */
  readonly stateHub: StateHub;
  /** Exposed for hosted event forwarding — subscribe with onEvent. */
  readonly runHub: RunHub;
  storage(): ForJobStorage;
  registry(): ProviderRegistry;
  orchestrator(): ReviewOrchestrator;
  config(): RunnerConfig;
  secrets(): FileSecretStore;
  snapshot(): SidebarState;
  pushState(): Promise<void>;
  emitRunEvent(runId: string, event: RunEvent): void;
  clearRunBuffer(runId: string): void;
  runBusy(message: string, work: () => Promise<void>, pushAfter?: boolean): Promise<void>;
  refreshAll(refreshProviders?: boolean): Promise<void>;
}

export async function createRunnerContext(): Promise<RunnerContext> {
  const workspaceRoot = os.homedir();
  const storageRoot = path.join(workspaceRoot, ".jasojeon");
  const config = new RunnerConfig(path.join(storageRoot, "runner.json"));
  const secrets = new FileSecretStore(path.join(storageRoot, "secrets.enc"));
  const storage = new ForJobStorage(workspaceRoot, storageRoot);
  const registry = new ProviderRegistry(config, secrets, storage);
  const compiler = new ContextCompiler(storage);
  const orchestrator = new ReviewOrchestrator(storage, compiler, registry);
  const runSessions = new RunSessionManager();
  const stateHub = new StateHub();
  const runHub = new RunHub();
  const stateStore = new SidebarStateStore({
    workspaceRoot,
    storage,
    registry,
    openDartConfigured: async () => Boolean(await secrets.get(openDartSecretKey)),
    agentDefaults: async () => config.getAgentDefaults(),
    extensionVersion: version
  });

  await Promise.all([config.initialize(), secrets.initialize(), storage.ensureInitialized()]);
  await stateStore.initialize();

  const ctx: RunnerContext = {
    workspaceRoot,
    storageRoot,
    stateStore,
    runSessions,
    stateHub,
    runHub,
    storage: () => storage,
    registry: () => registry,
    orchestrator: () => orchestrator,
    config: () => config,
    secrets: () => secrets,
    snapshot: () => stateStore.snapshot(),
    pushState: async () => {
      stateHub.broadcast(stateStore.snapshot());
    },
    emitRunEvent: (runId, event) => {
      runHub.emit(runId, event);
    },
    clearRunBuffer: (runId) => {
      runHub.clearBuffer(runId);
    },
    runBusy: async (message, work, pushAfter = true) => {
      stateStore.setBusyMessage(message);
      await ctx.pushState();
      try {
        await work();
      } finally {
        stateStore.setBusyMessage(undefined);
        if (pushAfter) {
          await ctx.pushState();
        }
      }
    },
    refreshAll: async (refreshProviders = false) => {
      await stateStore.refreshAll({ refreshProviders });
      await ctx.pushState();
    }
  };

  return ctx;
}
