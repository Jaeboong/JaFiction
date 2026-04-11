import { Router } from "express";
import {
  AddressedRunMismatchError,
  deriveLegacyParticipantsFromRoles,
  isRunAbortedError,
  RunLedgerEntry,
  resolveRoleAssignments,
  RunEvent,
  RunRequest
} from "@jafiction/shared";
import { RunnerContext } from "../runnerContext";

export function createRunsRouter(ctx: RunnerContext): Router {
  const router = Router({ mergeParams: true });

  router.post("/", async (request, response, next) => {
    try {
      const { projectSlug } = request.params as { projectSlug: string };
      const runId = await startRun(ctx, {
        projectSlug,
        projectQuestionIndex: request.body?.projectQuestionIndex,
        question: String(request.body?.question ?? ""),
        draft: String(request.body?.draft ?? ""),
        reviewMode: request.body?.reviewMode === "deepFeedback" ? "deepFeedback" : "realtime",
        notionRequest: typeof request.body?.notionRequest === "string" ? request.body.notionRequest : undefined,
        continuationFromRunId: typeof request.body?.continuationFromRunId === "string" ? request.body.continuationFromRunId : undefined,
        continuationNote: typeof request.body?.continuationNote === "string" ? request.body.continuationNote : undefined,
        roleAssignments: Array.isArray(request.body?.roleAssignments) ? request.body.roleAssignments : undefined,
        coordinatorProvider: request.body?.coordinatorProvider,
        reviewerProviders: Array.isArray(request.body?.reviewerProviders) ? request.body.reviewerProviders : [],
        rounds: Number(request.body?.rounds ?? 1),
        maxRoundsPerSection: normalizeMaxRoundsPerSection(request.body?.maxRoundsPerSection),
        selectedDocumentIds: Array.isArray(request.body?.selectedDocumentIds) ? request.body.selectedDocumentIds : [],
        charLimit: typeof request.body?.charLimit === "number" ? request.body.charLimit : undefined
      } as RunRequest);
      response.status(202).json({ runId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:runId/messages", async (request, response, next) => {
    try {
      const { projectSlug, runId } = request.params as { projectSlug: string; runId: string };
      const [messages, ledgers] = await Promise.all([
        ctx.storage().loadRunChatMessages(projectSlug, runId),
        ctx.storage().loadRunLedgers(projectSlug, runId)
      ]);
      response.json({ messages: messages ?? [], ledgers: ledgers ?? [] });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:runId/continuation", async (request, response, next) => {
    try {
      const { projectSlug, runId } = request.params as { projectSlug: string; runId: string };
      response.json(await loadRunContinuation(ctx, projectSlug, runId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:runId/continue", async (request, response, next) => {
    try {
      const { projectSlug, runId: priorRunId } = request.params as { projectSlug: string; runId: string };
      const runId = await startContinuationRun(
        ctx,
        projectSlug,
        priorRunId,
        typeof request.body?.message === "string" ? request.body.message : undefined
      );
      response.status(202).json({ runId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:runId/complete", async (request, response, next) => {
    try {
      const { projectSlug, runId } = request.params as { projectSlug: string; runId: string };
      const runState = ctx.runSessions.snapshot();
      if (runState.runId !== runId || runState.projectSlug !== projectSlug || runState.status !== "paused") {
        throw new Error("완료 버튼은 현재 라운드가 종료된 활성 실행에서만 사용할 수 있습니다.");
      }

      const continuation = await ctx.storage().loadRunContinuationContext(projectSlug, runId);
      if (continuation.record.status !== "completed") {
        throw new Error("문항 완료는 라운드 종료 상태에서만 사용할 수 있습니다.");
      }
      const project = await ctx.storage().getProject(projectSlug);
      const questionIndex = resolveRunQuestionIndex(project, continuation.record.projectQuestionIndex, continuation.record.question);
      if (questionIndex < 0) {
        throw new Error("현재 실행에 연결된 자소서 문항을 찾지 못했습니다.");
      }

      const answer = continuation.revisedDraft?.trim() || continuation.record.draft.trim();
      if (!answer) {
        throw new Error("완료 처리할 답안 초안이 비어 있습니다.");
      }

      await ctx.storage().saveCompletedEssayAnswer(
        projectSlug,
        questionIndex,
        continuation.record.question,
        answer,
        runId
      );
      ctx.runSessions.finishAddressedRun(runId);
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.stateStore.refreshProjects(projectSlug);
      await ctx.pushState();
      response.json({ runId, questionIndex });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:runId/resume", async (request, response, next) => {
    try {
      const { projectSlug, runId } = request.params as { projectSlug: string; runId: string };
      const continuation = await ctx.storage().loadRunContinuationContext(projectSlug, runId);
      const project = await ctx.storage().getProject(projectSlug);
      const questionIndex = resolveRunQuestionIndex(project, continuation.record.projectQuestionIndex, continuation.record.question);
      if (questionIndex < 0) {
        throw new Error("현재 실행에 연결된 자소서 문항을 찾지 못했습니다.");
      }
      const answerState = project.essayAnswerStates?.find((state) => state.questionIndex === questionIndex);
      if (answerState?.status !== "completed" || answerState.lastRunId !== runId) {
        throw new Error("재개 버튼은 고정된 문항에서만 사용할 수 있습니다.");
      }

      await ctx.storage().reopenEssayAnswer(projectSlug, questionIndex);

      const runState = ctx.runSessions.snapshot();
      if (runState.runId === runId && runState.projectSlug === projectSlug) {
        ctx.runSessions.finishAddressedRun(runId);
      }

      const nextRunId = await resumeExistingRun(
        ctx,
        projectSlug,
        runId,
        typeof request.body?.message === "string" ? request.body.message : undefined
      );

      await ctx.stateStore.refreshProjects(projectSlug);
      await ctx.pushState();
      response.status(202).json({ runId: nextRunId, resumedFromRunId: runId, questionIndex });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createRunInterventionRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.post("/:runId/intervention", async (request, response, next) => {
    try {
      const runId = String(request.params.runId);
      const message = typeof request.body?.message === "string" ? request.body.message : "";
      const outcome = ctx.runSessions.submitIntervention(runId, message);
      if (outcome === "continuation") {
        const runState = ctx.runSessions.snapshot();
        if (!runState.projectSlug) {
          throw new Error("현재 실행된 지원서 정보를 확인할 수 없습니다.");
        }
        ctx.runSessions.finishAddressedRun(runId);
        const nextRunId = await startContinuationRun(ctx, runState.projectSlug, runId, message);
        ctx.stateStore.setRunState(ctx.runSessions.snapshot());
        await ctx.stateStore.refreshProjects(runState.projectSlug);
        await ctx.pushState();
        response.json({ outcome, runId, nextRunId });
        return;
      }
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.pushState();
      response.json({ outcome, runId });
    } catch (error) {
      if (error instanceof AddressedRunMismatchError) {
        response.status(409).json({
          error: "run_conflict",
          message: error.message,
          activeRunId: error.activeRunId
        });
        return;
      }
      next(error);
    }
  });

  router.post("/:runId/abort", async (request, response, next) => {
    try {
      const runId = String(request.params.runId);
      ctx.runSessions.abort(runId);
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.pushState();
      response.status(202).json({ runId, status: "aborting" });
    } catch (error) {
      if (error instanceof AddressedRunMismatchError) {
        response.status(409).json({
          error: "run_conflict",
          message: error.message,
          activeRunId: error.activeRunId
        });
        return;
      }
      next(error);
    }
  });

  return router;
}

async function startRun(ctx: RunnerContext, request: RunRequest): Promise<string> {
  const existingRunId = request.existingRunId?.trim() || undefined;
  const before = existingRunId
    ? undefined
    : new Set((await ctx.storage().listRuns(request.projectSlug)).map((run) => run.id));
  const bufferedEvents: RunEvent[] = [];
  const latestMessageIds = new Map<string, string>();
  let activeRunId: string | undefined;
  let persistedLedgers: Map<string, RunLedgerEntry> | undefined;
  const sessionId = ctx.runSessions.start(request.projectSlug, request.reviewMode);

  const trackRunEvent = (event: RunEvent) => {
    if (event.type !== "chat-message-started" || !event.messageId) {
      return;
    }

    latestMessageIds.set(buildParticipantRoundKey(event.participantId, event.round), event.messageId);
  };

  const persistLedgerUpdate = async (runId: string, event: RunEvent) => {
    if (event.type !== "discussion-ledger-updated" || !event.discussionLedger) {
      return;
    }

    const messageId = event.messageId ?? latestMessageIds.get(buildParticipantRoundKey(event.participantId, event.round));
    if (!messageId) {
      return;
    }

    if (!persistedLedgers) {
      persistedLedgers = new Map<string, RunLedgerEntry>(
        (await ctx.storage().loadRunLedgers(request.projectSlug, runId) ?? []).map((entry) => [
          buildLedgerEntryKey(entry.participantId, entry.round, entry.messageId),
          entry
        ])
      );
    }

    const nextEntry: RunLedgerEntry = {
      participantId: event.participantId,
      round: event.round,
      messageId,
      ledger: event.discussionLedger
    };
    persistedLedgers.set(buildLedgerEntryKey(nextEntry.participantId, nextEntry.round, nextEntry.messageId), nextEntry);
    await ctx.storage().saveRunLedgers(request.projectSlug, runId, [...persistedLedgers.values()]);
  };

  if (existingRunId) {
    activeRunId = existingRunId;
    ctx.clearRunBuffer(existingRunId);
    ctx.runSessions.setRunId(sessionId, existingRunId);
    ctx.stateStore.setRunState(ctx.runSessions.snapshot());
    await ctx.stateStore.refreshProjects(request.projectSlug);
    await ctx.pushState();
  }

  ctx.stateStore.setRunState(ctx.runSessions.snapshot());
  await ctx.pushState();

  void (async () => {
    let shouldTearDownSession = false;
    try {
      const resolvedRoles = resolveRoleAssignments(
        request.roleAssignments,
        request.coordinatorProvider,
        request.reviewerProviders
      );
      const legacyParticipants = deriveLegacyParticipantsFromRoles(
        resolvedRoles.all,
        request.coordinatorProvider,
        request.reviewerProviders
      );

      await ctx.orchestrator().run(
        {
          ...request,
          existingRunId,
          roleAssignments: resolvedRoles.all,
          coordinatorProvider: legacyParticipants.coordinatorProvider,
          reviewerProviders: legacyParticipants.reviewerProviders
        },
        async (event) => {
          trackRunEvent(event);
          if (activeRunId) {
            await persistLedgerUpdate(activeRunId, event);
            ctx.emitRunEvent(activeRunId, event);
          } else {
            bufferedEvents.push(event);
          }
        },
        async (prompt) => {
          const pending = ctx.runSessions.waitForIntervention(sessionId, prompt);
          ctx.stateStore.setRunState(ctx.runSessions.snapshot());
          await ctx.pushState();
          return pending;
        },
        () => ctx.runSessions.drainQueuedMessages(sessionId),
        ctx.runSessions.abortSignal(sessionId),
        (controller) => ctx.runSessions.bindExecutionAbortController(sessionId, controller)
      );
      ctx.runSessions.markRoundComplete(sessionId);
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.pushState();
    } catch (error) {
      shouldTearDownSession = true;
      throw error;
    } finally {
      if (shouldTearDownSession || ctx.runSessions.snapshot().status === "aborting") {
        ctx.runSessions.finish(sessionId);
      }
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.stateStore.refreshProjects(request.projectSlug);
      await ctx.stateStore.refreshPreferences();
      await ctx.pushState();
      if (activeRunId) {
        const runIdToClean = activeRunId;
        setTimeout(() => ctx.clearRunBuffer(runIdToClean), 60_000);
      }
    }
  })().catch(async (error) => {
    const hasTerminalEvent = bufferedEvents.some((event) => event.type === "run-failed" || event.type === "run-aborted");
    if (!hasTerminalEvent && !isRunAbortedError(error)) {
      bufferedEvents.push({
        timestamp: new Date().toISOString(),
        type: "run-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (activeRunId) {
      for (const event of bufferedEvents.splice(0)) {
        await persistLedgerUpdate(activeRunId, event);
        ctx.emitRunEvent(activeRunId, event);
      }
    }
    await ctx.pushState();
  });

  if (existingRunId) {
    return existingRunId;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await ctx.storage().listRuns(request.projectSlug);
    const created = current.find((run) => !before?.has(run.id));
    if (created) {
      activeRunId = created.id;
      ctx.runSessions.setRunId(sessionId, activeRunId);
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.stateStore.refreshProjects(request.projectSlug);
      await ctx.pushState();
      for (const event of bufferedEvents.splice(0)) {
        await persistLedgerUpdate(activeRunId, event);
        ctx.emitRunEvent(activeRunId, event);
      }
      return activeRunId;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("실행 세션 ID를 확인하지 못했습니다.");
}

async function loadRunContinuation(ctx: RunnerContext, projectSlug: string, runId: string) {
  const continuation = await ctx.storage().loadRunContinuationContext(projectSlug, runId);
  const resolvedRoles = resolveRoleAssignments(
    continuation.record.roleAssignments,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );
  const legacyParticipants = deriveLegacyParticipantsFromRoles(
    resolvedRoles.all,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );
  return {
    projectSlug,
    runId: continuation.record.id,
    projectQuestionIndex: continuation.record.projectQuestionIndex,
    question: continuation.record.question,
    draft: continuation.revisedDraft?.trim() || continuation.record.draft,
    reviewMode: continuation.record.reviewMode,
    notionRequest: "",
    roleAssignments: resolvedRoles.all,
    coordinatorProvider: legacyParticipants.coordinatorProvider,
    reviewerProviders: legacyParticipants.reviewerProviders,
    maxRoundsPerSection: continuation.record.maxRoundsPerSection ?? 1,
    selectedDocumentIds: continuation.record.selectedDocumentIds
  };
}

async function startContinuationRun(
  ctx: RunnerContext,
  projectSlug: string,
  runId: string,
  continuationNote?: string
): Promise<string> {
  const continuation = await ctx.storage().loadRunContinuationContext(projectSlug, runId);
  const resolvedRoles = resolveRoleAssignments(
    continuation.record.roleAssignments,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );
  const legacyParticipants = deriveLegacyParticipantsFromRoles(
    resolvedRoles.all,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );

  return startRun(ctx, {
    projectSlug,
    projectQuestionIndex: continuation.record.projectQuestionIndex,
    question: continuation.record.question,
    draft: continuation.revisedDraft?.trim() || continuation.record.draft,
    reviewMode: continuation.record.reviewMode,
    notionRequest: "",
    continuationFromRunId: continuation.record.id,
    continuationNote: continuationNote?.trim() || "",
    roleAssignments: resolvedRoles.all,
    coordinatorProvider: legacyParticipants.coordinatorProvider,
    reviewerProviders: legacyParticipants.reviewerProviders,
    rounds: 1,
    maxRoundsPerSection: continuation.record.maxRoundsPerSection ?? 1,
    selectedDocumentIds: continuation.record.selectedDocumentIds
  });
}

async function resumeExistingRun(
  ctx: RunnerContext,
  projectSlug: string,
  runId: string,
  continuationNote?: string
): Promise<string> {
  const continuation = await ctx.storage().loadRunContinuationContext(projectSlug, runId);
  const resolvedRoles = resolveRoleAssignments(
    continuation.record.roleAssignments,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );
  const legacyParticipants = deriveLegacyParticipantsFromRoles(
    resolvedRoles.all,
    continuation.record.coordinatorProvider,
    continuation.record.reviewerProviders
  );

  return startRun(ctx, {
    existingRunId: continuation.record.id,
    projectSlug,
    projectQuestionIndex: continuation.record.projectQuestionIndex,
    question: continuation.record.question,
    draft: continuation.revisedDraft?.trim() || continuation.record.draft,
    reviewMode: continuation.record.reviewMode,
    notionRequest: "",
    continuationFromRunId: continuation.record.id,
    continuationNote: continuationNote?.trim() || "",
    roleAssignments: resolvedRoles.all,
    coordinatorProvider: legacyParticipants.coordinatorProvider,
    reviewerProviders: legacyParticipants.reviewerProviders,
    rounds: 1,
    maxRoundsPerSection: continuation.record.maxRoundsPerSection ?? 1,
    selectedDocumentIds: continuation.record.selectedDocumentIds
  });
}

function normalizeMaxRoundsPerSection(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}

function resolveRunQuestionIndex(
  project: { essayQuestions?: string[] },
  projectQuestionIndex: number | undefined,
  question: string
): number {
  if (typeof projectQuestionIndex === "number") {
    return projectQuestionIndex;
  }
  return (project.essayQuestions ?? []).findIndex((candidate) => candidate.trim() === question.trim());
}

function buildParticipantRoundKey(participantId?: string, round?: number): string {
  return `${participantId ?? ""}:${round ?? ""}`;
}

function buildLedgerEntryKey(participantId?: string, round?: number, messageId?: string): string {
  return `${participantId ?? ""}:${round ?? ""}:${messageId ?? ""}`;
}
