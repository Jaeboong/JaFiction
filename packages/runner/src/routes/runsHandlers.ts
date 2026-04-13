import {
  ListRunsPayload,
  ListRunsResult,
  GetRunMessagesPayload,
  GetRunMessagesResult,
  StartRunPayload,
  StartRunResult,
  ResumeRunPayload,
  ResumeRunResult,
  AbortRunPayload,
  AbortRunResult,
  CompleteRunPayload,
  CompleteRunResult,
  SubmitInterventionPayload,
  SubmitInterventionResult,
  SubmitInterventionOutcome,
  DeleteRunPayload,
  DeleteRunResult,
  AddressedRunMismatchError,
  RunRequest,
  RunEvent,
  RunLedgerEntry,
  resolveRoleAssignments,
  deriveLegacyParticipantsFromRoles,
  isRunAbortedError
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

export async function listRuns(
  ctx: RunnerContext,
  payload: ListRunsPayload
): Promise<ListRunsResult> {
  const runs = await ctx.storage().listRuns(payload.slug);
  return { runs };
}

export async function getRunMessages(
  ctx: RunnerContext,
  payload: GetRunMessagesPayload
): Promise<GetRunMessagesResult> {
  // cursor is reserved for future pagination; current storage loads all messages
  const { runId } = payload;
  // We need the projectSlug — for the RPC op we accept runId-only.
  // Look up which project owns this runId by listing all projects.
  const projects = await ctx.storage().listProjects();
  for (const project of projects) {
    try {
      const [messages, ledgers] = await Promise.all([
        ctx.storage().loadRunChatMessages(project.slug, runId),
        ctx.storage().loadRunLedgers(project.slug, runId)
      ]);
      if (messages !== undefined) {
        return {
          messages: messages ?? [],
          ledgers: ledgers ?? [],
          nextCursor: undefined
        };
      }
    } catch {
      // not in this project, try next
    }
  }
  return { messages: [], ledgers: [], nextCursor: undefined };
}

export async function startRun(
  ctx: RunnerContext,
  payload: StartRunPayload
): Promise<StartRunResult> {
  // TODO(phase-6): replace with a device-keyed run session map to support
  // concurrent runs per user once the relay layer can route by device_id.
  // For the 1-user MVP we enforce a single active session slot here.
  const snapshot = ctx.runSessions.snapshot();
  if (snapshot.status !== "idle") {
    throw Object.assign(
      new Error("A run is already active. Only one run can be active at a time."),
      { code: "busy" }
    );
  }

  const request: RunRequest = {
    projectSlug: payload.slug,
    question: payload.question,
    draft: payload.draft,
    reviewMode: payload.reviewMode,
    projectQuestionIndex: payload.projectQuestionIndex,
    notionRequest: payload.notionRequest,
    continuationFromRunId: payload.continuationFromRunId,
    continuationNote: payload.continuationNote,
    roleAssignments: payload.roleAssignments,
    coordinatorProvider: payload.coordinatorProvider,
    reviewerProviders: payload.reviewerProviders,
    rounds: payload.rounds,
    maxRoundsPerSection: payload.maxRoundsPerSection,
    selectedDocumentIds: payload.selectedDocumentIds,
    charLimit: payload.charLimit
  };
  const runId = await startRunInternal(ctx, request);
  return { runId };
}

export async function resumeRun(
  ctx: RunnerContext,
  payload: ResumeRunPayload
): Promise<ResumeRunResult> {
  const { runId } = payload;
  // Find which project owns this run
  const projects = await ctx.storage().listProjects();
  for (const project of projects) {
    try {
      const run = await ctx.storage().getRun(project.slug, runId);
      if (run) {
        const continuation = await ctx.storage().loadRunContinuationContext(project.slug, runId);
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

        await startRunInternal(ctx, {
          existingRunId: runId,
          projectSlug: project.slug,
          projectQuestionIndex: continuation.record.projectQuestionIndex,
          question: continuation.record.question,
          draft: continuation.revisedDraft?.trim() || continuation.record.draft,
          reviewMode: continuation.record.reviewMode,
          notionRequest: payload.message ?? "",
          continuationFromRunId: runId,
          continuationNote: payload.message ?? "",
          roleAssignments: resolvedRoles.all,
          coordinatorProvider: legacyParticipants.coordinatorProvider,
          reviewerProviders: legacyParticipants.reviewerProviders,
          rounds: 1,
          maxRoundsPerSection: continuation.record.maxRoundsPerSection ?? 1,
          selectedDocumentIds: continuation.record.selectedDocumentIds
        });
        // Stage 11.4 breaking schema expansion: return the resumed runId and
        // the originating runId. The runner currently reuses the same runId
        // slot on resume (startRunInternal with existingRunId), so these are
        // equal — downstream callers still treat them as distinct fields so a
        // future split into a fresh runId does not require another schema bump.
        return { runId, resumedFromRunId: runId };
      }
    } catch {
      // try next project
    }
  }
  throw Object.assign(new Error(`Run not found: ${runId}`), { code: "not_found" });
}

export async function abortRun(
  ctx: RunnerContext,
  payload: AbortRunPayload
): Promise<AbortRunResult> {
  try {
    ctx.runSessions.abort(payload.runId);
    ctx.stateStore.setRunState(ctx.runSessions.snapshot());
    await ctx.pushState();
    return { ok: true };
  } catch (error) {
    if (error instanceof AddressedRunMismatchError) {
      throw Object.assign(new Error(error.message), { code: "invalid_input" });
    }
    throw error;
  }
}

export async function completeRun(
  ctx: RunnerContext,
  payload: CompleteRunPayload
): Promise<CompleteRunResult> {
  const { runId } = payload;
  const runState = ctx.runSessions.snapshot();
  if (runState.runId !== runId || runState.status !== "paused") {
    throw Object.assign(
      new Error("완료 버튼은 현재 라운드가 종료된 활성 실행에서만 사용할 수 있습니다."),
      { code: "invalid_input" }
    );
  }

  const projects = await ctx.storage().listProjects();
  for (const project of projects) {
    if (runState.projectSlug && project.slug !== runState.projectSlug) {
      continue;
    }
    try {
      const continuation = await ctx.storage().loadRunContinuationContext(project.slug, runId);
      if (continuation.record.status !== "completed") {
        throw Object.assign(
          new Error("문항 완료는 라운드 종료 상태에서만 사용할 수 있습니다."),
          { code: "invalid_input" }
        );
      }

      const projectRecord = await ctx.storage().getProject(project.slug);
      const questionIndex = resolveRunQuestionIndex(
        projectRecord,
        continuation.record.projectQuestionIndex,
        continuation.record.question
      );
      if (questionIndex < 0) {
        throw Object.assign(
          new Error("현재 실행에 연결된 자소서 문항을 찾지 못했습니다."),
          { code: "not_found" }
        );
      }

      const answer = continuation.revisedDraft?.trim() || continuation.record.draft.trim();
      if (!answer) {
        throw Object.assign(
          new Error("완료 처리할 답안 초안이 비어 있습니다."),
          { code: "invalid_input" }
        );
      }

      await ctx.storage().saveCompletedEssayAnswer(
        project.slug,
        questionIndex,
        continuation.record.question,
        answer,
        runId
      );
      ctx.runSessions.finishAddressedRun(runId);
      ctx.stateStore.setRunState(ctx.runSessions.snapshot());
      await ctx.stateStore.refreshProjects(project.slug);
      await ctx.pushState();
      return { ok: true };
    } catch (error) {
      if ((error as { code?: string }).code) {
        throw error;
      }
      // not in this project
    }
  }
  throw Object.assign(new Error(`Run not found: ${runId}`), { code: "not_found" });
}

export async function submitIntervention(
  ctx: RunnerContext,
  payload: SubmitInterventionPayload
): Promise<SubmitInterventionResult> {
  const { runId, text } = payload;
  try {
    const outcome: SubmitInterventionOutcome = ctx.runSessions.submitIntervention(runId, text);
    let nextRunId: string | undefined;
    if (outcome === "continuation") {
      const runState = ctx.runSessions.snapshot();
      if (!runState.projectSlug) {
        throw Object.assign(
          new Error("현재 실행된 지원서 정보를 확인할 수 없습니다."),
          { code: "internal" }
        );
      }
      ctx.runSessions.finishAddressedRun(runId);
      nextRunId = await startRunInternal(ctx, {
        projectSlug: runState.projectSlug,
        question: "",
        draft: "",
        reviewMode: "realtime",
        continuationFromRunId: runId,
        continuationNote: text,
        roleAssignments: [],
        coordinatorProvider: "claude",
        reviewerProviders: [],
        rounds: 1,
        selectedDocumentIds: []
      });
    }
    ctx.stateStore.setRunState(ctx.runSessions.snapshot());
    await ctx.pushState();
    // Stage 11.4 breaking schema expansion: mirror the local REST shape
    // (createRunInterventionRouter). nextRunId is populated only on the
    // "continuation" path; otherwise it is omitted entirely.
    return nextRunId === undefined
      ? { outcome, runId }
      : { outcome, runId, nextRunId };
  } catch (error) {
    if (error instanceof AddressedRunMismatchError) {
      throw Object.assign(new Error(error.message), { code: "invalid_input" });
    }
    throw error;
  }
}

// Stage 11.4 new op — mirrors projectsRouter DELETE /:projectSlug/runs/:runId.
// User-scope invariant: ctx.storage() is bound to the calling user's
// per-device workspace via the device hub routing layer, so passing an
// arbitrary {slug, runId} pair here can only reach the caller's own runs.
export async function deleteRun(
  ctx: RunnerContext,
  payload: DeleteRunPayload
): Promise<DeleteRunResult> {
  const { slug, runId } = payload;
  await ctx.runBusy("실행 기록을 삭제하는 중...", async () => {
    await ctx.storage().deleteRun(slug, runId);
    await ctx.stateStore.refreshProjects(slug);
    await ctx.pushState();
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helpers (shared with Express routes via runsRouter.ts)
// ---------------------------------------------------------------------------

export async function startRunInternal(ctx: RunnerContext, request: RunRequest): Promise<string> {
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

  void (async () => {
    let shouldTearDownSession = false;
    try {
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
    // Phase 9 decision: we do NOT emit a separate `run_finished: failed` here.
    // The `run_event` envelope below already carries a `run-failed` RunEvent,
    // which browsers treat as the authoritative terminal signal for failed runs.
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
