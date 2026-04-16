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
import type {
  CompanyAnalysisPhaseResult,
  CompanyContextBundle,
  CompanyProfile
} from "@jasojeon/shared";
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
  generateSupportingInsightPhase: typeof import("@jasojeon/shared").generateSupportingInsightPhase;
} = require("../../../shared/dist/core/insights");

interface Harness {
  ctx: RunnerContext;
  storage: ForJobStorage;
  cleanup(): Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-insights-"));
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

test("generateProjectInsightsService skips DART when openDartSkipRequested is true", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.cleanup());

  const project = await harness.storage.createProject({
    companyName: "테스트회사",
    roleName: "Backend Engineer",
    jobPostingText: "백엔드 엔지니어 공고 본문",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });
  await harness.storage.updateProject({
    ...project,
    openDartSkipRequested: true
  });

  const companyProfile: CompanyProfile = {
    generatedAt: "2026-04-16T00:00:00.000Z",
    companyName: "테스트회사",
    businessModel: ["구독형 SaaS"],
    businessStructure: ["B2B 플랫폼"],
    growthDirection: ["시장 확대"],
    financialTakeaways: ["재무 데이터 없음"],
    officialDirection: ["제품 고도화"],
    roleRelevance: ["백엔드 안정성 강화"],
    essayAngles: ["확장성", "운영 안정성", "협업"],
    interviewQuestions: ["트래픽 피크 대응 경험"],
    coverage: {
      summaryLabel: "공고 파생",
      sourceTypes: ["공고 파생"],
      omissions: ["OpenDART 기업개황/재무 자료가 충분하지 않습니다."],
      coverageNote: "공고 중심으로 보수적으로 해석해야 합니다.",
      externalEnrichmentUsed: false
    }
  };
  const companyContextBundle: CompanyContextBundle = {
    collectedAt: "2026-04-16T00:00:00.000Z",
    companyName: "테스트회사",
    sources: {
      dart: undefined,
      web: {
        fetchedAt: "2026-04-16T00:00:00.000Z",
        entries: [],
        snippets: [],
        notes: []
      },
      posting: {
        companyName: "테스트회사",
        roleName: "Backend Engineer",
        keywords: [],
        jobPostingText: "백엔드 엔지니어 공고 본문",
        snippets: []
      }
    },
    coverage: companyProfile.coverage
  };

  const originalCollectCompanyContext = companyContextModule.collectCompanyContext;
  const originalGenerateCompanyAnalysisPhase = insightsModule.generateCompanyAnalysisPhase;
  const originalGenerateSupportingInsightPhase = insightsModule.generateSupportingInsightPhase;
  const originalGetServerDartApiKey = runnerContextModule.getServerDartApiKey;
  let seenDartApiKey: string | undefined = "not-called";

  t.after(() => {
    companyContextModule.collectCompanyContext = originalCollectCompanyContext;
    insightsModule.generateCompanyAnalysisPhase = originalGenerateCompanyAnalysisPhase;
    insightsModule.generateSupportingInsightPhase = originalGenerateSupportingInsightPhase;
    runnerContextModule.getServerDartApiKey = originalGetServerDartApiKey;
  });

  runnerContextModule.getServerDartApiKey = () => "server-dart-key";
  companyContextModule.collectCompanyContext = async (options: { dartApiKey?: string }) => {
    seenDartApiKey = options.dartApiKey;
    return companyContextBundle;
  };
  insightsModule.generateCompanyAnalysisPhase = async (): Promise<CompanyAnalysisPhaseResult> => ({
    providerId: "claude",
    companyProfile,
    companyInsight: "# 기업 분석\n테스트회사"
  });
  insightsModule.generateSupportingInsightPhase = async () => ({
    "job-insight.md": "# 직무 분석",
    "application-strategy.md": "# 지원 전략",
    "question-analysis.md": "# 문항 분석"
  });

  await generateProjectInsightsService(harness.ctx, {
    projectSlug: project.slug
  });

  const refreshed = await harness.storage.getProject(project.slug);
  assert.equal(seenDartApiKey, undefined);
  assert.equal(refreshed.insightStatus, "ready");
  assert.equal(refreshed.insightLastError, "dart: skipped by user");
});
