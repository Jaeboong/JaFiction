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
import { setDocumentPinned } from "../routes/projectsHandlers";
import type { RunnerContext } from "../runnerContext";
import { RunnerConfig } from "../runnerConfig";
import { FileSecretStore } from "../secretStore";
import { RunHub } from "../ws/runHub";
import { StateHub } from "../ws/stateHub";

interface Harness {
  ctx: RunnerContext;
  storage: ForJobStorage;
  cleanup(): Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-pin-"));
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

test("set_document_pinned: 업로드 기본값(unpinned) 문서를 핀하면 pinnedByDefault + project.pinnedDocumentIds 가 켜진다", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.cleanup());

  const project = await harness.storage.createProject({ companyName: "쏘카" });
  // 업로드 문서와 동일하게 pinnedByDefault=false 로 생성
  const doc = await harness.storage.saveProjectTextDocument(project.slug, "resume.md", "경험 정리", false);
  assert.equal(doc.pinnedByDefault, false, "precondition: 문서는 unpinned 상태");

  const result = await setDocumentPinned(harness.ctx, {
    slug: project.slug,
    documentId: doc.id,
    pinned: true
  });

  assert.equal(result.document.pinnedByDefault, true, "반환 문서가 pinned 상태여야 함");

  const refreshedDoc = await harness.storage.getProjectDocument(project.slug, doc.id);
  assert.equal(refreshedDoc.pinnedByDefault, true, "저장된 문서가 pinned 여야 함");

  const refreshedProject = await harness.storage.getProject(project.slug);
  assert.ok(
    refreshedProject.pinnedDocumentIds.includes(doc.id),
    "project.pinnedDocumentIds 에 문서가 포함돼야 함 (compiler 가 실행 컨텍스트에 넣는 조건)"
  );
});

test("set_document_pinned: pinned=false 면 다시 제외된다", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.cleanup());

  const project = await harness.storage.createProject({ companyName: "쏘카" });
  const doc = await harness.storage.saveProjectTextDocument(project.slug, "portfolio.md", "포트폴리오", true);

  const result = await setDocumentPinned(harness.ctx, {
    slug: project.slug,
    documentId: doc.id,
    pinned: false
  });

  assert.equal(result.document.pinnedByDefault, false);

  const refreshedProject = await harness.storage.getProject(project.slug);
  assert.ok(
    !refreshedProject.pinnedDocumentIds.includes(doc.id),
    "unpin 후 project.pinnedDocumentIds 에서 제거돼야 함"
  );
});
