import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ForJobStorage, RunSessionManager, RunSessionState } from "@jafiction/shared";
import { createRunnerServer } from "../index";
import type { RunnerContext } from "../runnerContext";

test("stale tabs receive 409 instead of resuming a different paused run", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const sessionId = harness.ctx.runSessions.start("alpha", "realtime");
  const pendingIntervention = harness.ctx.runSessions.waitForIntervention(sessionId, {
    projectSlug: "alpha",
    runId: "active-run",
    round: 2,
    reviewMode: "realtime",
    coordinatorProvider: "codex"
  });

  const staleResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/stale-run/intervention", {
    method: "POST",
    body: { message: "stale tab message" }
  });

  assert.equal(staleResponse.status, 409);
  assert.deepEqual(await staleResponse.json(), {
    error: "run_conflict",
    message: "This run is no longer the active session.",
    activeRunId: "active-run"
  });
  assert.equal(harness.ctx.runSessions.snapshot().status, "paused");

  const activeResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/active-run/intervention", {
    method: "POST",
    body: { message: "fresh tab message" }
  });

  assert.equal(activeResponse.status, 200);
  assert.equal(await pendingIntervention, "fresh tab message");
});

test("stale tabs cannot queue intervention messages into another running session", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const sessionId = harness.ctx.runSessions.start("alpha", "realtime");
  harness.ctx.runSessions.setRunId(sessionId, "active-run");

  const staleResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/stale-run/intervention", {
    method: "POST",
    body: { message: "stale tab message" }
  });
  assert.equal(staleResponse.status, 409);
  assert.deepEqual(harness.ctx.runSessions.drainQueuedMessages(sessionId), []);

  const activeResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/active-run/intervention", {
    method: "POST",
    body: { message: "fresh tab message" }
  });
  assert.equal(activeResponse.status, 200);
  assert.deepEqual(harness.ctx.runSessions.drainQueuedMessages(sessionId), ["fresh tab message"]);
});

test("stale tabs cannot abort a different active run", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const sessionId = harness.ctx.runSessions.start("alpha", "realtime");
  harness.ctx.runSessions.setRunId(sessionId, "active-run");
  const signal = harness.ctx.runSessions.abortSignal(sessionId);

  const staleResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/stale-run/abort", {
    method: "POST"
  });
  assert.equal(staleResponse.status, 409);
  assert.equal(signal.aborted, false);
  assert.deepEqual(await staleResponse.json(), {
    error: "run_conflict",
    message: "This run is no longer the active session.",
    activeRunId: "active-run"
  });

  const activeResponse = await authenticatedJsonRequest(harness.baseUrl, "/api/runs/active-run/abort", {
    method: "POST"
  });
  assert.equal(activeResponse.status, 202);
  assert.equal(signal.aborted, true);
  assert.equal(harness.abortStateUpdates.at(-1)?.status, "aborting");
  assert.equal(harness.pushCount, 1);
});

test("run messages endpoint returns persisted chat ledgers with chat history", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const project = await harness.ctx.storage().createProject("Naver");
  await harness.ctx.storage().createRun({
    id: "completed-run",
    projectSlug: project.slug,
    question: "왜 네이버인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: "2026-04-10T00:00:00.000Z",
    finishedAt: "2026-04-10T00:03:00.000Z"
  });
  await harness.ctx.storage().saveRunChatMessages(project.slug, "completed-run", [
    {
      id: "msg-1",
      providerId: "claude",
      participantId: "section-coordinator",
      participantLabel: "섹션 코디네이터",
      speaker: "Claude",
      speakerRole: "coordinator",
      recipient: "All",
      round: 1,
      content: "지원 동기를 더 선명하게 합시다.",
      startedAt: "2026-04-10T00:00:01.000Z",
      finishedAt: "2026-04-10T00:00:05.000Z",
      status: "completed"
    }
  ]);
  await harness.ctx.storage().saveRunLedgers(project.slug, "completed-run", [
    {
      participantId: "section-coordinator",
      round: 1,
      messageId: "msg-1",
      ledger: {
        currentFocus: "지원 동기 정교화",
        miniDraft: "문제 인식과 제품 임팩트를 연결한다.",
        acceptedDecisions: ["첫 문단은 사용자 관점으로 시작한다."],
        openChallenges: ["수치 근거가 부족하다."],
        deferredChallenges: [],
        targetSection: "지원 동기",
        targetSectionKey: "motivation",
        updatedAtRound: 1
      }
    }
  ]);

  const response = await authenticatedJsonRequest(
    harness.baseUrl,
    `/api/projects/${project.slug}/runs/completed-run/messages`,
    { method: "GET" }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    messages: [
      {
        id: "msg-1",
        providerId: "claude",
        participantId: "section-coordinator",
        participantLabel: "섹션 코디네이터",
        speaker: "Claude",
        speakerRole: "coordinator",
        recipient: "All",
        round: 1,
        content: "지원 동기를 더 선명하게 합시다.",
        startedAt: "2026-04-10T00:00:01.000Z",
        finishedAt: "2026-04-10T00:00:05.000Z",
        status: "completed"
      }
    ],
    ledgers: [
      {
        participantId: "section-coordinator",
        round: 1,
        messageId: "msg-1",
        ledger: {
          currentFocus: "지원 동기 정교화",
          miniDraft: "문제 인식과 제품 임팩트를 연결한다.",
          acceptedDecisions: ["첫 문단은 사용자 관점으로 시작한다."],
          openChallenges: ["수치 근거가 부족하다."],
          deferredChallenges: [],
          targetSection: "지원 동기",
          targetSectionKey: "motivation",
          updatedAtRound: 1
        }
      }
    ]
  });
});

test("complete route pins the answer and closes the active round-complete session", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const project = await harness.ctx.storage().createProject({
    companyName: "Naver",
    essayQuestions: ["왜 네이버인가?"]
  });

  await harness.ctx.storage().createRun({
    id: "run-1",
    projectSlug: project.slug,
    projectQuestionIndex: 0,
    question: "왜 네이버인가?",
    draft: "지원 동기 초안",
    reviewMode: "realtime",
    coordinatorProvider: "codex",
    reviewerProviders: ["claude"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: "2026-04-10T00:00:00.000Z",
    finishedAt: "2026-04-10T00:03:00.000Z"
  });

  const sessionId = harness.ctx.runSessions.start(project.slug, "realtime");
  harness.ctx.runSessions.setRunId(sessionId, "run-1");
  harness.ctx.runSessions.markRoundComplete(sessionId);

  const response = await authenticatedJsonRequest(
    harness.baseUrl,
    `/api/projects/${project.slug}/runs/run-1/complete`,
    { method: "POST" }
  );

  assert.equal(response.status, 200);
  assert.equal(harness.ctx.runSessions.snapshot().status, "idle");

  const refreshedProject = await harness.ctx.storage().getProject(project.slug);
  const answerState = refreshedProject.essayAnswerStates?.find((state) => state.questionIndex === 0);
  assert.equal(answerState?.status, "completed");
  assert.equal(answerState?.lastRunId, "run-1");
});

test("resume route reopens completed answer state on the same run id", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const project = await harness.ctx.storage().createProject({
    companyName: "Naver",
    essayQuestions: ["왜 네이버인가?"]
  });

  await harness.ctx.storage().createRun({
    id: "run-1",
    projectSlug: project.slug,
    projectQuestionIndex: 0,
    question: "왜 네이버인가?",
    draft: "지원 동기 초안",
    reviewMode: "realtime",
    coordinatorProvider: "codex",
    reviewerProviders: ["claude"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: "2026-04-10T00:00:00.000Z",
    finishedAt: "2026-04-10T00:03:00.000Z"
  });
  await harness.ctx.storage().saveCompletedEssayAnswer(project.slug, 0, "왜 네이버인가?", "완료 답안", "run-1");

  const response = await authenticatedJsonRequest(
    harness.baseUrl,
    `/api/projects/${project.slug}/runs/run-1/resume`,
    { method: "POST" }
  );

  assert.equal(response.status, 202);
  const payload = await response.json() as { runId: string; resumedFromRunId: string };
  assert.equal(payload.resumedFromRunId, "run-1");
  assert.equal(payload.runId, "run-1");

  const refreshedProject = await harness.ctx.storage().getProject(project.slug);
  const answerState = refreshedProject.essayAnswerStates?.find((state) => state.questionIndex === 0);
  assert.equal(answerState?.status, "drafting");
  assert.equal(answerState?.lastRunId, undefined);

  const resumedRun = await harness.ctx.storage().getRun(project.slug, "run-1");
  assert.ok(["running", "completed"].includes(resumedRun.status));

  const runs = await harness.ctx.storage().listRuns(project.slug);
  assert.equal(runs.length, 1);
});

test("essay draft save route persists the selected question draft and pushes refreshed state", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const project = await harness.ctx.storage().createProject({
    companyName: "Naver",
    essayQuestions: ["첫 번째 문항", "두 번째 문항"]
  });

  const response = await authenticatedJsonRequest(
    harness.baseUrl,
    `/api/projects/${project.slug}/essay-draft/1`,
    {
      method: "PUT",
      body: { draft: "두 번째 문항 초안" }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questionIndex: 1 });

  const refreshedProject = await harness.ctx.storage().getProject(project.slug);
  assert.equal(harness.refreshProjectsCalls.length, 1);
  assert.equal(harness.refreshProjectsCalls[0], project.slug);
  assert.equal(harness.pushCount, 1);
  assert.equal(refreshedProject.essayAnswerStates?.length, 1);
  assert.equal(refreshedProject.essayAnswerStates?.[0]?.questionIndex, 1);

  const documentId = refreshedProject.essayAnswerStates?.[0]?.documentId;
  assert.ok(documentId);

  const document = await harness.ctx.storage().getProjectDocument(project.slug, documentId);
  assert.equal(await harness.ctx.storage().readDocumentRawContent(document), "두 번째 문항 초안");
});

async function startHarness(): Promise<{
  abortStateUpdates: RunSessionState[];
  baseUrl: string;
  close(): Promise<void>;
  ctx: RunnerContext;
  pushCount: number;
  refreshProjectsCalls: Array<string | undefined>;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-runs-router-"));
  const storageRoot = path.join(tempDir, ".jafiction");
  const storage = new ForJobStorage(tempDir, storageRoot);
  await storage.ensureInitialized();
  const abortStateUpdates: RunSessionState[] = [];
  const refreshProjectsCalls: Array<string | undefined> = [];
  let pushCount = 0;

  const ctx = {
    workspaceRoot: tempDir,
    storageRoot,
    stateStore: {
      setRunState: (state: RunSessionState) => {
        abortStateUpdates.push(state);
      },
      refreshProjects: async (projectSlug?: string) => {
        refreshProjectsCalls.push(projectSlug);
      },
      refreshPreferences: async () => undefined
    } as unknown as RunnerContext["stateStore"],
    runSessions: new RunSessionManager(),
    sessionToken: "test-session-token",
    storage: () => storage,
    registry: () => missingDependency("registry"),
    orchestrator: () => createFakeOrchestrator(storage),
    config: () => ({
      getPort: async () => 4123
    }) as RunnerContext["config"] extends () => infer TResult ? TResult : never,
    secrets: () => missingDependency("secrets"),
    snapshot: () => ({
      workspaceOpened: true,
      extensionVersion: "test-version",
      openDartConfigured: false,
      openDartConnectionStatus: "untested",
      providers: [],
      profileDocuments: [],
      projects: [],
      preferences: {},
      agentDefaults: {},
      runState: { status: "idle" },
      defaultRubric: ""
    }) as RunnerContext["snapshot"] extends () => infer TResult ? TResult : never,
    pushState: async () => {
      pushCount += 1;
    },
    emitRunEvent: () => undefined,
    clearRunBuffer: () => undefined,
    addStateSocket: () => undefined,
    addRunSocket: () => undefined,
    runBusy: async (_message: string, work: () => Promise<void>) => {
      await work();
    },
    refreshAll: async () => undefined
  } as unknown as RunnerContext;

  const { close, server } = await createRunnerServer(ctx);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    abortStateUpdates,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await close();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
    ctx,
    get pushCount() {
      return pushCount;
    },
    refreshProjectsCalls
  };
}

function createFakeOrchestrator(storage: ForJobStorage): RunnerContext["orchestrator"] extends () => infer TResult ? TResult : never {
  return {
    run: async (
      request: {
        projectSlug: string;
        existingRunId?: string;
        projectQuestionIndex?: number;
        question: string;
        draft: string;
        reviewMode: "realtime" | "deepFeedback";
        notionRequest?: string;
        continuationFromRunId?: string;
        continuationNote?: string;
        roleAssignments?: unknown[];
        coordinatorProvider?: "codex" | "claude" | "gemini";
        reviewerProviders?: Array<"codex" | "claude" | "gemini">;
        rounds?: number;
        maxRoundsPerSection?: number;
        selectedDocumentIds?: string[];
      },
      eventSink: (event: Record<string, unknown>) => Promise<void>
    ) => {
      const now = new Date().toISOString();
      const runId = request.existingRunId ?? `fake-run-${Math.random().toString(36).slice(2, 10)}`;
      if (request.existingRunId) {
        await storage.updateRun(request.projectSlug, runId, {
          projectQuestionIndex: request.projectQuestionIndex,
          question: request.question,
          draft: request.draft,
          reviewMode: request.reviewMode,
          notionRequest: request.notionRequest,
          continuationFromRunId: request.continuationFromRunId,
          continuationNote: request.continuationNote,
          roleAssignments: request.roleAssignments as never,
          coordinatorProvider: request.coordinatorProvider ?? "codex",
          reviewerProviders: request.reviewerProviders ?? [],
          rounds: request.rounds ?? 1,
          maxRoundsPerSection: request.maxRoundsPerSection ?? 1,
          selectedDocumentIds: request.selectedDocumentIds ?? [],
          status: "running",
          lastResumedAt: now,
          finishedAt: undefined
        });
      } else {
        await storage.createRun({
          id: runId,
          projectSlug: request.projectSlug,
          projectQuestionIndex: request.projectQuestionIndex,
          question: request.question,
          draft: request.draft,
          reviewMode: request.reviewMode,
          notionRequest: request.notionRequest,
          continuationFromRunId: request.continuationFromRunId,
          continuationNote: request.continuationNote,
          roleAssignments: request.roleAssignments as never,
          coordinatorProvider: request.coordinatorProvider ?? "codex",
          reviewerProviders: request.reviewerProviders ?? [],
          rounds: request.rounds ?? 1,
          maxRoundsPerSection: request.maxRoundsPerSection ?? 1,
          selectedDocumentIds: request.selectedDocumentIds ?? [],
          status: "completed",
          startedAt: now,
          finishedAt: now
        });
      }
      await storage.updateRun(request.projectSlug, runId, {
        status: "completed",
        finishedAt: now
      });
      await eventSink({
        timestamp: now,
        type: "run-started",
        message: "Fake run started"
      });
      await eventSink({
        timestamp: now,
        type: "run-completed",
        message: "Fake run completed"
      });
    }
  } as unknown as RunnerContext["orchestrator"] extends () => infer TResult ? TResult : never;
}

async function authenticatedJsonRequest(
  baseUrl: string,
  pathname: string,
  init: {
    body?: Record<string, unknown>;
    method: "GET" | "POST" | "PUT";
  }
): Promise<Response> {
  const bootstrapResponse = await fetch(`${baseUrl}/api/session`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });
  const cookie = bootstrapResponse.headers.get("set-cookie");
  assert.ok(cookie);

  return fetch(`${baseUrl}${pathname}`, {
    method: init.method,
    headers: {
      Cookie: cookie.split(";")[0],
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:4124"
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
}

function missingDependency(name: string): never {
  throw new Error(`${name} should not be used in this test.`);
}
