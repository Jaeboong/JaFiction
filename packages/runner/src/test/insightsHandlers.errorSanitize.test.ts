import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  ContextCompiler,
  ForJobStorage,
  ProviderRegistry,
  ReviewOrchestrator,
  RunSessionManager,
  SidebarStateStore
} from "@jasojeon/shared";
import type { CompanyContextBundle } from "@jasojeon/shared";
import { generateProjectInsightsService } from "../routes/insightsHandlers";
import type { RunnerContext } from "../runnerContext";
import runnerContextModule = require("../runnerContext");
import { RunnerConfig } from "../runnerConfig";
import { FileSecretStore } from "../secretStore";
import { RunHub } from "../ws/runHub";
import { StateHub } from "../ws/stateHub";

const companyContextModule: {
  collectCompanyContext: typeof import("@jasojeon/shared").collectCompanyContext;
} = require("../../../shared/dist/core/companyContext");

const insightsModule: {
  generateCompanyAnalysisPhase: typeof import("@jasojeon/shared").generateCompanyAnalysisPhase;
} = require("../../../shared/dist/core/insights");

// 자소전.shop 에서 실제로 관측된 codex CLI 401 덤프(refresh_token_reused).
const RAW_CODEX_AUTH_DUMP =
  "C:\\Users\\cbkjh\\AppData\\Roaming\\npm\\codex.cmd exited with code 1: " +
  "Reading additional input from stdin... ERROR codex_models_manager::manager: " +
  "failed to refresh available models: unexpected status 401 Unauthorized: " +
  "Your authentication token has been invalidated. Please try signing in again., " +
  "code: token_invalidated ... Failed to refresh token: 401 Unauthorized: " +
  "Your refresh token has already been used to generate a new access token. code: refresh_token_reused";

interface Harness {
  ctx: RunnerContext;
  storage: ForJobStorage;
  cleanup(): Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-errsan-"));
  const storageRoot = path.join(workspaceRoot, ".forjob");
  const storage = new ForJobStorage(workspaceRoot, ".forjob");
  await storage.ensureInitialized();
  const config = new RunnerConfig(path.join(workspaceRoot, "runner.json"));
  const secrets = new FileSecretStore(path.join(workspaceRoot, "secrets.enc"));
  await config.initialize();
  await secrets.initialize();
  const registry = new ProviderRegistry(config, secrets, storage);
  const orchestrator = new ReviewOrchestrator(storage, new ContextCompiler(storage), registry);
  const runSessions = new RunSessionManager();
  const stateHub = new StateHub();
  const runHub = new RunHub();
  const stateStore = new SidebarStateStore({
    workspaceRoot,
    storage,
    registry,
    openDartConfigured: async () => false,
    agentDefaults: async () => ({}),
    extensionVersion: "test"
  });
  await stateStore.initialize();

  const ctx = {
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
    pushState: async () => undefined,
    emitRunEvent: () => undefined,
    clearRunBuffer: () => undefined,
    runBusy: async (_message: string, work: () => Promise<void>) => {
      await work();
    },
    refreshAll: async () => undefined
  } satisfies RunnerContext;

  return {
    ctx,
    storage,
    cleanup: async () => {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  };
}

function makeCompanyContextBundle(): CompanyContextBundle {
  return {
    collectedAt: "2026-05-26T00:00:00.000Z",
    companyName: "쏘카",
    sources: {
      dart: undefined,
      web: {
        fetchedAt: "2026-05-26T00:00:00.000Z",
        entries: [],
        snippets: [],
        notes: []
      },
      posting: {
        companyName: "쏘카",
        roleName: "백엔드 개발자",
        keywords: [],
        jobPostingText: "공고 본문",
        snippets: []
      }
    },
    coverage: {
      summaryLabel: "공고 파생",
      sourceTypes: ["공고 파생"],
      omissions: [],
      coverageNote: "공고 중심",
      externalEnrichmentUsed: false
    }
  };
}

test("기업 분석 실패 시 raw provider 에러 덤프가 insightLastError 에 노출되지 않는다", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.cleanup());

  const project = await harness.storage.createProject({
    companyName: "쏘카",
    roleName: "백엔드 개발자",
    jobPostingText: "공고 본문",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });
  await harness.storage.updateProject({
    ...project,
    postingReviewReasons: [],
    openDartSkipRequested: true
  });

  const originalCollectCompanyContext = companyContextModule.collectCompanyContext;
  const originalGenerateCompanyAnalysisPhase = insightsModule.generateCompanyAnalysisPhase;
  const originalGetServerDartApiKey = runnerContextModule.getServerDartApiKey;
  t.after(() => {
    companyContextModule.collectCompanyContext = originalCollectCompanyContext;
    insightsModule.generateCompanyAnalysisPhase = originalGenerateCompanyAnalysisPhase;
    runnerContextModule.getServerDartApiKey = originalGetServerDartApiKey;
  });

  runnerContextModule.getServerDartApiKey = () => undefined;
  companyContextModule.collectCompanyContext = async () => makeCompanyContextBundle();
  insightsModule.generateCompanyAnalysisPhase = async () => {
    throw new Error(RAW_CODEX_AUTH_DUMP);
  };

  await generateProjectInsightsService(harness.ctx, { projectSlug: project.slug });

  const refreshed = await harness.storage.getProject(project.slug);
  assert.equal(refreshed.insightStatus, "error");

  const shown = refreshed.insightLastError ?? "";
  // raw 덤프의 어떤 조각도 새어나가면 안 된다.
  for (const leak of ["401", "token_invalidated", "refresh_token", "Unauthorized", "codex.cmd", "C:\\", "exited with code"]) {
    assert.ok(!shown.includes(leak), `insightLastError must not leak "${leak}": ${shown}`);
  }
  // 사용자용 메시지(접두사 + 재로그인 안내)는 포함돼야 한다 — swallow 가 아님.
  assert.ok(shown.startsWith("기업 분석 실패:"), `expected prefix, got: ${shown}`);
  assert.ok(shown.includes("로그인"), `expected re-login hint, got: ${shown}`);
});

test("알 수 없는 에러는 일반 메시지로 분류된다", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.cleanup());

  const project = await harness.storage.createProject({
    companyName: "쏘카",
    roleName: "백엔드 개발자",
    jobPostingText: "공고 본문",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });
  await harness.storage.updateProject({
    ...project,
    postingReviewReasons: [],
    openDartSkipRequested: true
  });

  const originalCollectCompanyContext = companyContextModule.collectCompanyContext;
  const originalGenerateCompanyAnalysisPhase = insightsModule.generateCompanyAnalysisPhase;
  const originalGetServerDartApiKey = runnerContextModule.getServerDartApiKey;
  t.after(() => {
    companyContextModule.collectCompanyContext = originalCollectCompanyContext;
    insightsModule.generateCompanyAnalysisPhase = originalGenerateCompanyAnalysisPhase;
    runnerContextModule.getServerDartApiKey = originalGetServerDartApiKey;
  });

  runnerContextModule.getServerDartApiKey = () => undefined;
  companyContextModule.collectCompanyContext = async () => makeCompanyContextBundle();
  insightsModule.generateCompanyAnalysisPhase = async () => {
    throw new Error("Unexpected token < in JSON at position 1283 /tmp/run/internal-stack.js:42");
  };

  await generateProjectInsightsService(harness.ctx, { projectSlug: project.slug });

  const refreshed = await harness.storage.getProject(project.slug);
  assert.equal(refreshed.insightStatus, "error");
  const shown = refreshed.insightLastError ?? "";
  assert.ok(!shown.includes("internal-stack.js"), `must not leak stack path: ${shown}`);
  assert.ok(!shown.includes("position 1283"), `must not leak raw parser detail: ${shown}`);
  assert.ok(shown.startsWith("기업 분석 실패:"), shown);
  assert.ok(shown.includes("오류가 발생했습니다"), shown);
});
