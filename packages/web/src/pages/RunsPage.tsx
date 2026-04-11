import type {
  DiscussionLedger,
  ProjectViewModel,
  ProviderId,
  RunChatMessage,
  RunEvent,
  RunLedgerEntry,
  SidebarState
} from "@jasojeon/shared";
import { renderMarkdown } from "../lib/markdown";
import { decodeInterventionRequestFrame, decodeRunEventFrame } from "../lib/wsFrames";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  buildParticipantSelectionFromDefaults,
  buildRoleAssignmentsFromDefaults,
  essayRoleIds,
  essayRoleLabels,
  materializeAgentDefaults
} from "../agentDefaults";
import { CustomSelect } from "../components/CustomSelect";
import { ReviewerCard, parseReviewerCardContent } from "../components/ReviewerCard";
import {
  formatRelative,
  providerName
} from "../formatters";
import "../styles/runs.css";
import { isInsightDocumentTitle } from "../insightDocuments";

interface RunsPageProps {
  state: SidebarState;
  projects: ProjectViewModel[];
  selectedProjectSlug?: string;
  selectedRunId?: string;
  onSelectProject(projectSlug: string): void;
  onSelectRun(runId: string): void;
  onClearRunSelection(): void;
  onDeleteRun(projectSlug: string, runId: string): Promise<void>;
  onStartRun(projectSlug: string, payload: Record<string, unknown>): Promise<string | undefined>;
  onSubmitIntervention(runId: string, message: string): Promise<void>;
  onAbortRun(runId: string): Promise<boolean>;
  onCompleteRun(projectSlug: string, runId: string): Promise<void>;
  onResumeRun(projectSlug: string, runId: string): Promise<void>;
  onSaveDraft(projectSlug: string, questionIndex: number, draft: string): Promise<void>;
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
  onAwaitingUserInput(): void;
}

interface RunListItem {
  project: ProjectViewModel;
  run: ProjectViewModel["runs"][number];
}

type RunVisualState =
  | "draft"
  | "cli-running"
  | "active-waiting"
  | "waiting"
  | "round-complete"
  | "aborting"
  | "failed"
  | "aborted"
  | "finished";

const ACTIVE_RUN_RESTART_CONFIRM_MESSAGE = "현재 실행 중인 작업이 있습니다. 중단하고 새 실행을 시작하시겠습니까?";
const IDLE_WAIT_POLL_MS = 100;
const IDLE_WAIT_TIMEOUT_MS = 15_000;
type InsertDraftHandler = (text: string) => void;

interface RunComposerHeaderActions {
  canStartThisProject: boolean;
  onStartRun?: () => void;
}

export function RunsPage({
  state,
  projects,
  selectedProjectSlug,
  selectedRunId,
  onSelectProject,
  onSelectRun,
  onClearRunSelection,
  onDeleteRun,
  onStartRun,
  onSubmitIntervention,
  onAbortRun,
  onCompleteRun,
  onResumeRun,
  onSaveDraft,
  onCreateRunSocket,
  onGetRunMessages,
  onAwaitingUserInput
}: RunsPageProps) {
  const selectedProject = projects.find((project) => project.record.slug === selectedProjectSlug) ?? projects[0];
  const runItems = projects
    .flatMap<RunListItem>((project) => project.runs.map((run) => ({ project, run })))
    .sort((left, right) => new Date(right.run.record.startedAt).getTime() - new Date(left.run.record.startedAt).getTime());

  const selectedRunItem = runItems.find((item) => item.run.record.id === selectedRunId);
  const liveRunId = state.runState.runId;
  const liveRunItem = liveRunId ? runItems.find((item) => item.run.record.id === liveRunId) : undefined;
  const insertDraftRef = useRef<InsertDraftHandler | undefined>(undefined);
  const startRunActionRef = useRef<(() => void) | undefined>(undefined);
  const [composerCanStartThisProject, setComposerCanStartThisProject] = useState(false);
  const registerInsertDraftRef = useRef<(handler: InsertDraftHandler | undefined) => void>((handler) => {
    insertDraftRef.current = handler;
  });
  const registerHeaderActionsRef = useRef<(actions: RunComposerHeaderActions | undefined) => void>((actions) => {
    startRunActionRef.current = actions?.onStartRun;
    const nextCanStart = Boolean(actions?.canStartThisProject);
    setComposerCanStartThisProject((current) => current === nextCanStart ? current : nextCanStart);
  });
  const initialLiveRunVisualState = deriveSessionRunVisualState(state.runState);
  const [liveRunVisualState, setLiveRunVisualState] = useState<RunVisualState | undefined>(() => initialLiveRunVisualState);
  const liveRunVisualStateRef = useRef<RunVisualState | undefined>(initialLiveRunVisualState);
  const awaitingUserInputNoticeRunIdRef = useRef<string | undefined>(
    state.runState.status === "paused" ? state.runState.runId : undefined
  );

  const updateLiveRunVisualState = (
    next: RunVisualState | undefined | ((previous: RunVisualState | undefined) => RunVisualState | undefined)
  ) => {
    const resolved = typeof next === "function" ? next(liveRunVisualStateRef.current) : next;
    liveRunVisualStateRef.current = resolved;
    setLiveRunVisualState(resolved);
  };

  useEffect(() => {
    if (!liveRunId) {
      awaitingUserInputNoticeRunIdRef.current = undefined;
      return;
    }

    awaitingUserInputNoticeRunIdRef.current = state.runState.status === "paused" ? liveRunId : undefined;
  }, [liveRunId]);

  useEffect(() => {
    if (!liveRunId || state.runState.status === "idle") {
      updateLiveRunVisualState(undefined);
      return;
    }

    const sessionState = deriveSessionRunVisualState(state.runState);
    if (sessionState === "round-complete") {
      updateLiveRunVisualState("round-complete");
      return;
    }

    if (sessionState === "aborting") {
      updateLiveRunVisualState("aborting");
      return;
    }

    if (sessionState === "waiting") {
      updateLiveRunVisualState("waiting");
      return;
    }

    if (sessionState === "active-waiting") {
      updateLiveRunVisualState((previous) => (
        previous === "cli-running"
          || previous === "failed"
          || previous === "finished"
          || previous === "aborting"
          ? previous
          : "active-waiting"
      ));
    }
  }, [liveRunId, state.runState.reviewMode, state.runState.status]);

  useEffect(() => {
    if (!liveRunId || state.runState.status === "idle") {
      return;
    }

    let disposed = false;
    const socket = onCreateRunSocket(liveRunId);

    socket.onmessage = (ev) => {
      if (disposed) {
        return;
      }

      const parsed = JSON.parse(ev.data as string) as unknown;

      // intervention_request arrives as a hosted envelope — handle before run_event decode
      const interventionFrame = decodeInterventionRequestFrame(parsed);
      if (interventionFrame && interventionFrame.runId === liveRunId) {
        if (awaitingUserInputNoticeRunIdRef.current !== liveRunId) {
          awaitingUserInputNoticeRunIdRef.current = liveRunId;
          onAwaitingUserInput();
        }
        updateLiveRunVisualState("waiting");
        return;
      }

      const frame = decodeRunEventFrame(parsed);
      if (!frame || frame.runId !== liveRunId) {
        return;
      }
      const { event } = frame;
      const nextVisualState = reduceLiveRunVisualState(liveRunVisualStateRef.current, event);
      if (event.type === "awaiting-user-input" && awaitingUserInputNoticeRunIdRef.current !== liveRunId) {
        awaitingUserInputNoticeRunIdRef.current = liveRunId;
        onAwaitingUserInput();
      }
      updateLiveRunVisualState(nextVisualState);
    };

    return () => {
      disposed = true;
      socket.close();
    };
  }, [liveRunId, onAwaitingUserInput, onCreateRunSocket, state.runState.status]);

  if (!selectedProject) {
    return (
      <section className="runs-page runs-page-empty">
        <div className="runs-empty-state">
          <h2>실행할 지원서가 없습니다.</h2>
          <p>먼저 지원서를 만든 뒤 다시 실행 화면을 열어 주세요.</p>
        </div>
      </section>
    );
  }

  const contextDocuments = selectedProject.documents.filter((document) => !isInsightDocumentTitle(document.title));
  const availableQuestion = deriveProjectQuestion(selectedProject);
  const isNewRunMode = selectedRunId === undefined;
  const selectedProjectHasLiveRun = state.runState.status !== "idle" && state.runState.projectSlug === selectedProject.record.slug;
  const liveRunCanComplete = Boolean(
    liveRunItem
    && state.runState.status === "paused"
    && resolveRunQuestionIndex(selectedProject, liveRunItem.run.record) >= 0
  );
  const liveRunSelected = !isNewRunMode && (
    selectedRunItem?.run.record.id === liveRunId
    || (selectedRunId !== undefined && selectedRunId === liveRunId)
  );
  const activeVisualState = isNewRunMode
    ? "draft"
    : resolveActiveRunVisualState(selectedRunItem, state.runState, liveRunVisualState);
  const activeStatusLabel = isNewRunMode
    ? labelForRunVisualState("draft")
    : buildActiveStatusLabel(selectedRunItem, state.runState, liveRunVisualState);

  return (
    <section className="runs-page">
      <aside className="runs-sidebar">
        <div className="runs-sidebar-top">
          <div className="runs-sidebar-toggle" role="tablist" aria-label="실행 보기 전환">
            <button
              className={`runs-sidebar-toggle-button ${selectedRunId ? "" : "is-active"}`}
              onClick={onClearRunSelection}
            >
              <span className="runs-sidebar-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              새 실행
            </button>

            <button
              className={`runs-sidebar-toggle-button ${selectedRunId ? "is-active" : ""}`}
              disabled={!runItems.length}
              onClick={() => {
                const target = selectedRunItem ?? runItems[0];
                if (!target) {
                  return;
                }
                onSelectProject(target.project.record.slug);
                onSelectRun(target.run.record.id);
              }}
            >
              <span className="runs-sidebar-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              실행 기록
            </button>
          </div>
        </div>

        <div className="runs-sidebar-scroll">
          <div className="runs-sidebar-caption">최근 실행</div>

          <div className="runs-history-list">
            {runItems.length ? runItems.map((item) => {
              const visualState = resolveRunVisualState(item, state.runState, liveRunVisualState);
              return (
                <div
                  key={item.run.record.id}
                  className={`runs-history-item ${item.run.record.id === selectedRunId ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="runs-history-item-select"
                    onClick={() => {
                      onSelectProject(item.project.record.slug);
                      onSelectRun(item.run.record.id);
                    }}
                  >
                    <div className="runs-history-topline">
                      <strong>{item.project.record.companyName}</strong>
                    </div>

                    <div className="runs-history-copy">
                      <span>{item.project.record.roleName ?? "직무 미정"}</span>
                    </div>

                    <small className="runs-history-time">{formatRelative(item.run.record.startedAt)}</small>
                  </button>

                  <div className="runs-history-actions">
                    <span className={`runs-history-dot is-${visualState}`} aria-hidden="true" />

                    <button
                      type="button"
                      className="runs-history-delete"
                      aria-label="실행 삭제"
                      title="실행 삭제"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDeleteRun(item.project.record.slug, item.run.record.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            }) : (
              <div className="runs-history-empty">아직 실행 기록이 없습니다.</div>
            )}
          </div>
        </div>
      </aside>

      <main className="runs-workspace">
        <div className="runs-workspace-scroll">
          <header className="runs-page-header">
            <div className="runs-page-heading">
              <div className="runs-page-meta-row">
                <span
                  className={`runs-page-status state-${activeVisualState} ${liveRunSelected && state.runState.status !== "idle" ? "is-live" : ""}`}
                >
                  <span className="runs-page-status-dot" aria-hidden="true" />
                  {activeStatusLabel}
                </span>
              </div>
              <h1>에이전트 리뷰</h1>
              <p className="runs-page-subtitle">
                {selectedProject.record.companyName}
                {selectedProject.record.roleName ? (
                  <>
                    <span className="runs-page-subtitle-divider" aria-hidden="true" />
                    {selectedProject.record.roleName}
                  </>
                ) : null}
              </p>
            </div>
          </header>

          <div className="runs-workspace-grid">
            <RunComposerPanel
              key={selectedRunItem?.run.record.id ?? "new"}
              state={state}
              projects={projects}
              selectedProject={selectedProject}
              selectedRunItem={selectedRunItem}
              liveRunItem={liveRunItem}
              onSelectProject={onSelectProject}
              onClearRunSelection={onClearRunSelection}
              onStartRun={onStartRun}
              onAbortRun={onAbortRun}
              questionFallback={availableQuestion}
              essayAnswerStates={selectedProject.essayAnswerStates}
              contextDocuments={contextDocuments}
              isNewRunMode={isNewRunMode}
              onSaveDraft={onSaveDraft}
              onRegisterInsertDraft={registerInsertDraftRef.current}
              onRegisterHeaderActions={registerHeaderActionsRef.current}
            />

            <RunControlPanel
              currentRunId={selectedRunId}
              liveRunId={liveRunId}
              selectedRunItem={selectedRunItem}
              currentRunVisualState={selectedRunItem ? resolveRunVisualState(selectedRunItem, state.runState, liveRunVisualState) : undefined}
              currentRunVisualLabel={selectedRunItem ? labelForRunVisualState(
                resolveRunVisualState(selectedRunItem, state.runState, liveRunVisualState),
                selectedRunItem.run.record.reviewMode
              ) : undefined}
              hasRunHistory={selectedProject.runs.length > 0}
              isNewRunMode={isNewRunMode}
              canStartThisProject={composerCanStartThisProject}
              selectedProjectHasLiveRun={selectedProjectHasLiveRun}
              liveRunCanComplete={liveRunCanComplete}
              runState={state.runState}
              selectedProjectSlug={selectedProject.record.slug}
              liveRunItem={liveRunItem}
              onStartRun={() => {
                startRunActionRef.current?.();
              }}
              onAbortRun={onAbortRun}
              onCompleteRun={onCompleteRun}
              onResumeRun={onResumeRun}
              onSubmitIntervention={onSubmitIntervention}
              onCreateRunSocket={onCreateRunSocket}
              onGetRunMessages={onGetRunMessages}
              onInsertFinalDraft={(text) => {
                insertDraftRef.current?.(text);
              }}
            />
          </div>
        </div>
      </main>
    </section>
  );
}

function RunComposerPanel({
  state,
  projects,
  selectedProject,
  selectedRunItem,
  liveRunItem,
  onSelectProject,
  onClearRunSelection,
  onStartRun,
  onAbortRun,
  questionFallback,
  essayAnswerStates,
  contextDocuments,
  isNewRunMode,
  onSaveDraft,
  onRegisterInsertDraft,
  onRegisterHeaderActions
}: {
  state: SidebarState;
  projects: ProjectViewModel[];
  selectedProject: ProjectViewModel;
  selectedRunItem?: RunListItem;
  liveRunItem?: RunListItem;
  onSelectProject(projectSlug: string): void;
  onClearRunSelection(): void;
  onStartRun(projectSlug: string, payload: Record<string, unknown>): Promise<string | undefined>;
  onAbortRun(runId: string): Promise<boolean>;
  questionFallback: string;
  essayAnswerStates: ProjectViewModel["essayAnswerStates"];
  contextDocuments: ProjectViewModel["documents"];
  isNewRunMode: boolean;
  onSaveDraft(projectSlug: string, questionIndex: number, draft: string): Promise<void>;
  onRegisterInsertDraft?(handler: InsertDraftHandler | undefined): void;
  onRegisterHeaderActions?(actions: RunComposerHeaderActions | undefined): void;
}) {
  const providers = state.providers;
  const essayQuestions = selectedProject.record.essayQuestions ?? [];
  const healthyProviderIds = new Set(
    state.providers
      .filter((provider) => provider.authStatus === "healthy")
      .map((provider) => provider.providerId)
  );
  const resolvedAgentDefaults = materializeAgentDefaults(
    state.agentDefaults,
    state.providers,
    state.preferences.lastCoordinatorProvider
  );
  const roleAssignments = buildRoleAssignmentsFromDefaults(resolvedAgentDefaults);
  const participantSelection = buildParticipantSelectionFromDefaults(resolvedAgentDefaults);
  const unavailableRoles = essayRoleIds.filter((roleId) => !healthyProviderIds.has(resolvedAgentDefaults[roleId].providerId));
  const canStartRun = providers.length > 0 && unavailableRoles.length === 0;
  const essayQuestionsSignature = essayQuestions.join("\u0000");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(-1);
  const [draftCache, setDraftCache] = useState<Record<number, string>>({});
  const [maxRoundsPerSection, setMaxRoundsPerSection] = useState("1");
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null);
  const runStateRef = useRef(state.runState);

  useEffect(() => {
    runStateRef.current = state.runState;
  }, [state.runState]);

  const adjustDraftTextareaHeight = () => {
    const textarea = draftTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    adjustDraftTextareaHeight();
  }, [draft]);

  useEffect(() => {
    if (!onRegisterInsertDraft) {
      return;
    }

    const handleInsertDraft: InsertDraftHandler = (text) => {
      setDraft(text);
      draftTextareaRef.current?.focus();
    };

    onRegisterInsertDraft(handleInsertDraft);
    return () => {
      onRegisterInsertDraft(undefined);
    };
  }, [onRegisterInsertDraft]);

  useEffect(() => {
    setDraftCache({});
  }, [selectedProject.record.slug]);

  useEffect(() => {
    const initialQuestionIndex = resolveInitialSelectedQuestionIndex(
      selectedProject,
      selectedRunItem?.run.record,
      questionFallback
    );
    setSelectedQuestionIndex(initialQuestionIndex);

    if (selectedRunItem) {
      setQuestion(selectedRunItem.run.record.question);
      setDraft(selectedRunItem.run.record.draft);
      setMaxRoundsPerSection(String(selectedRunItem.run.record.maxRoundsPerSection ?? 1));
      return;
    }

    const initialQuestion = initialQuestionIndex >= 0
      ? essayQuestions[initialQuestionIndex] ?? ""
      : questionFallback;
    setQuestion(initialQuestion);
    setDraft(initialQuestionIndex >= 0 ? findEssayAnswerDraft(essayAnswerStates, initialQuestionIndex) : "");
    setMaxRoundsPerSection("1");
  }, [
    essayQuestionsSignature,
    questionFallback,
    selectedProject.record.slug,
    selectedRunItem?.run.record.draft,
    selectedRunItem?.run.record.id,
    selectedRunItem?.run.record.maxRoundsPerSection,
    selectedRunItem?.run.record.question
  ]);

  const selectedProjectHasLiveRun = state.runState.status !== "idle" && state.runState.projectSlug === selectedProject.record.slug;
  const liveRunCanComplete = Boolean(
    liveRunItem
    && state.runState.status === "paused"
    && resolveRunQuestionIndex(selectedProject, liveRunItem.run.record) >= 0
  );
  const hasAnyActiveRun = state.runState.status !== "idle" && Boolean(state.runState.runId);
  const blockedByOtherProject = state.runState.status !== "idle"
    && Boolean(state.runState.projectSlug)
    && state.runState.projectSlug !== selectedProject.record.slug;
  const canStartThisProject = canStartRun && !isStartingRun && (
    isNewRunMode
    || (!selectedProjectHasLiveRun && !blockedByOtherProject)
  );
  const canSaveDraft = selectedQuestionIndex >= 0 && draft.trim() !== "" && !isSavingDraft;
  const questionDropdownLabel = selectedQuestionIndex >= 0
    ? buildEssayQuestionOptionLabel(selectedQuestionIndex, essayQuestions[selectedQuestionIndex] ?? "")
    : essayQuestions.length
      ? "문항을 찾을 수 없습니다."
      : "문항이 없습니다.";

  const waitForIdleSession = async () => {
    const deadline = Date.now() + IDLE_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (runStateRef.current.status === "idle") {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, IDLE_WAIT_POLL_MS));
    }
    throw new Error("실행 중단 완료를 확인하지 못했습니다.");
  };

  const loadDraftForQuestion = (questionIndex: number): string => {
    const cachedDraft = draftCache[questionIndex];
    if (cachedDraft !== undefined) {
      return cachedDraft;
    }
    return findEssayAnswerDraft(essayAnswerStates, questionIndex);
  };

  const handleQuestionSelection = (questionIndex: number) => {
    if (questionIndex === selectedQuestionIndex) {
      return;
    }

    if (selectedQuestionIndex >= 0) {
      setDraftCache((current) => ({
        ...current,
        [selectedQuestionIndex]: draft
      }));
    }

    setSelectedQuestionIndex(questionIndex);
    setQuestion(essayQuestions[questionIndex] ?? "");
    setDraft(loadDraftForQuestion(questionIndex));
  };

  const startPayload = {
    projectQuestionIndex: selectedQuestionIndex >= 0 ? selectedQuestionIndex : undefined,
    question,
    draft,
    reviewMode: "realtime" as const,
    roleAssignments,
    coordinatorProvider: participantSelection.coordinatorProvider,
    reviewerProviders: participantSelection.reviewerProviders,
    rounds: 1,
    maxRoundsPerSection: normalizeMaxRoundsPerSectionInput(maxRoundsPerSection),
    selectedDocumentIds: contextDocuments
      .filter((document) => document.pinnedByDefault)
      .map((document) => document.id)
  };

  const handleStartRun = async () => {
    if (!canStartThisProject) {
      return;
    }

    setIsStartingRun(true);
    try {
      const activeRunId = runStateRef.current.runId;
      const hasReplaceableRun = Boolean(activeRunId && runStateRef.current.status !== "idle");

      if (hasReplaceableRun && runStateRef.current.status !== "aborting") {
        if (!window.confirm(ACTIVE_RUN_RESTART_CONFIRM_MESSAGE)) {
          return;
        }

        const aborted = await onAbortRun(activeRunId!);
        if (!aborted) {
          return;
        }
      }

      if (hasReplaceableRun) {
        await waitForIdleSession();
      }

      await onStartRun(selectedProject.record.slug, startPayload);
    } finally {
      setIsStartingRun(false);
    }
  };

  useEffect(() => {
    if (!onRegisterHeaderActions) {
      return;
    }

    onRegisterHeaderActions({
      canStartThisProject,
      onStartRun: () => {
        void handleStartRun();
      }
    });
  }, [canStartThisProject, handleStartRun, onRegisterHeaderActions]);

  useEffect(() => {
    if (!onRegisterHeaderActions) {
      return;
    }

    return () => {
      onRegisterHeaderActions(undefined);
    };
  }, [onRegisterHeaderActions]);

  return (
    <section className="runs-composer-card">
      <div className="runs-card-header">
        <h2>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          실행 구성
        </h2>
      </div>

      <div className="runs-composer-body">
        <div className="runs-field">
          <label className="runs-field-label" id="runs-project-select-label">대상 지원서</label>
          <CustomSelect
            value={selectedProject.record.slug}
            options={projects.map((project) => ({
              value: project.record.slug,
              label: `${project.record.companyName}${project.record.roleName ? ` - ${project.record.roleName}` : ""}`,
            }))}
            onChange={(slug) => {
              onClearRunSelection();
              onSelectProject(slug);
            }}
            ariaLabel="대상 지원서"
          />
        </div>

        <div className="runs-field">
          <label className="runs-field-label" id="runs-question-select-label">문항 선택</label>
          <CustomSelect
            value={selectedQuestionIndex}
            options={essayQuestions.map((essayQuestion, index) => ({
              value: index,
              label: buildEssayQuestionOptionLabel(index, essayQuestion),
              title: essayQuestion,
            }))}
            onChange={handleQuestionSelection}
            placeholder={essayQuestions.length ? "문항을 찾을 수 없습니다." : "문항이 없습니다."}
            disabled={!essayQuestions.length}
            ariaLabel="문항 선택"
          />
        </div>

        <div className="runs-field">
          <label className="runs-field-label">작성 문항 (질문)</label>
          <div className={`runs-question-display${question ? "" : " is-empty"}`}>
            {question || "표시할 문항이 없습니다."}
          </div>
        </div>

        <div className="runs-field">
          <div className="runs-field-label-row">
            <label className="runs-field-label" htmlFor="runs-draft-textarea">초안 (Draft)</label>
            <button
              type="button"
              className="runs-save-button"
              disabled={!canSaveDraft}
              onClick={() => {
                if (!canSaveDraft) {
                  return;
                }
                void (async () => {
                  setIsSavingDraft(true);
                  try {
                    setDraftCache((current) => ({
                      ...current,
                      [selectedQuestionIndex]: draft
                    }));
                    await onSaveDraft(selectedProject.record.slug, selectedQuestionIndex, draft);
                  } finally {
                    setIsSavingDraft(false);
                  }
                })();
              }}
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M5 21h14" />
                <path d="M7 21V7h8l2 2v12" />
                <path d="M9 7V3h6v4" />
                <path d="M9 13h6" />
              </svg>
              저장
            </button>
          </div>
          <textarea
            id="runs-draft-textarea"
            ref={draftTextareaRef}
            rows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="어릴 적부터 전자기기에 관심이 많았고, 특히 삼성전자의 스마트폰을 사용하며 기술의 발전에 놀라움을 느꼈습니다."
          />
        </div>

        <div className="runs-field">
          <div className="runs-field-label-row">
            <label className="runs-field-label">역할 할당 (Role Assignment)</label>
            <div className="runs-field-label runs-rounds-label">
              최대
              <CustomSelect
                value={maxRoundsPerSection}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                onChange={setMaxRoundsPerSection}
                className="runs-rounds-custom-select"
                ariaLabel="최대 라운드 수"
              />
              라운드
            </div>
          </div>
          <div className="runs-role-table" role="table" aria-label="실행 역할 배정 요약">
            <div className="runs-role-table-head" role="row">
              <span role="columnheader">
                <span className="runs-role-help">
                  역할
                  <span className="runs-role-help-icon-wrap is-left">
                    <svg className="runs-role-help-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
                    </svg>
                    <span className="runs-role-help-tooltip">
                      사용자님의 자기소개서 초안을 작성 및 검토해줄 에이전트의 역할입니다.
                    </span>
                  </span>
                </span>
              </span>
              <span role="columnheader">
                <span className="runs-role-help">
                  프로바이더
                  <span className="runs-role-help-icon-wrap">
                    <svg className="runs-role-help-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                      <line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
                    </svg>
                    <span className="runs-role-help-tooltip">
                      에이전트를 구동하는 AI 모델명입니다.
                    </span>
                  </span>
                </span>
              </span>
            </div>

            <div className="runs-role-table-body">
              {essayRoleIds.map((roleId, index) => {
                const config = resolvedAgentDefaults[roleId];
                return (
                  <div key={roleId} className={`runs-role-row ${index % 2 === 0 ? "is-alt" : ""}`} role="row">
                    <span className="runs-role-name" role="cell">{essayRoleLabels[roleId]}</span>
                    <span className="runs-role-provider" role="cell">
                      {providerName(config.providerId)}
                      <small>
                        {config.useProviderDefaults
                          ? "모델/에포트: 프로바이더 기본값"
                          : `모델: ${config.modelOverride || "기본값"} / 에포트: ${config.effortOverride || "기본값"}`}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {contextDocuments.length ? (
          <div className="runs-context-note">
            선택된 지원서에 연결된 컨텍스트 문서 {contextDocuments.length}개를 실행에 사용할 수 있습니다.
          </div>
        ) : null}

        {!providers.length ? (
          <div className="runs-empty-note">프로바이더를 먼저 연결해야 실행을 시작할 수 있습니다.</div>
        ) : null}

        {unavailableRoles.length ? (
          <div className="runs-empty-note">
            {`현재 역할 배정에 정상 연결되지 않은 프로바이더가 포함되어 있습니다: ${unavailableRoles.map((roleId) => essayRoleLabels[roleId]).join(", ")}. 개요 탭에서 역할 배정을 수정해 주세요.`}
          </div>
        ) : null}

        {isNewRunMode && hasAnyActiveRun ? (
          <div className="runs-empty-note">현재 활성 실행이 있습니다. 실행 시작을 누르면 기존 실행을 먼저 중단한 뒤 새 실행을 시작합니다.</div>
        ) : null}

        {!isNewRunMode && blockedByOtherProject ? (
          <div className="runs-empty-note">다른 지원서의 실행이 아직 활성 상태입니다. 현재 실행을 마친 뒤 다시 시작해 주세요.</div>
        ) : null}

        {!isNewRunMode && selectedProjectHasLiveRun && state.runState.status === "paused" && !liveRunCanComplete ? (
          <div className="runs-empty-note">현재 실행은 일시 중지되었지만 연결된 자소서 문항을 찾지 못해 완료 처리할 수 없습니다.</div>
        ) : null}
      </div>
    </section>
  );
}

function RunControlPanel({
  currentRunId,
  liveRunId,
  selectedRunItem,
  currentRunVisualState,
  currentRunVisualLabel,
  hasRunHistory,
  isNewRunMode,
  canStartThisProject,
  selectedProjectHasLiveRun,
  liveRunCanComplete,
  runState,
  selectedProjectSlug,
  liveRunItem,
  onStartRun,
  onAbortRun,
  onCompleteRun,
  onResumeRun,
  onSubmitIntervention,
  onCreateRunSocket,
  onGetRunMessages,
  onInsertFinalDraft
}: {
  currentRunId?: string;
  liveRunId?: string;
  selectedRunItem?: RunListItem;
  currentRunVisualState?: RunVisualState;
  currentRunVisualLabel?: string;
  hasRunHistory: boolean;
  isNewRunMode: boolean;
  canStartThisProject: boolean;
  selectedProjectHasLiveRun: boolean;
  liveRunCanComplete: boolean;
  runState: SidebarState["runState"];
  selectedProjectSlug: string;
  liveRunItem?: RunListItem;
  onStartRun(): void;
  onAbortRun(runId: string): Promise<boolean>;
  onCompleteRun(projectSlug: string, runId: string): Promise<void>;
  onResumeRun(projectSlug: string, runId: string): Promise<void>;
  onSubmitIntervention(runId: string, message: string): Promise<void>;
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
  onInsertFinalDraft?(text: string): void;
}) {
  const [message, setMessage] = useState("");
  const interventionInputRef = useRef<HTMLTextAreaElement>(null);
  const isCurrentRunLive = currentRunId !== undefined && currentRunId === liveRunId;
  const hasActiveRunSession = runState.status !== "idle" && runState.status !== "aborting" && Boolean(liveRunId);
  const canIntervene = Boolean(currentRunId) && isCurrentRunLive && hasActiveRunSession;
  const canSubmitIntervention = canIntervene && (runState.status === "paused" || Boolean(message.trim()));
  const shouldShowHeaderGuide = !hasRunHistory && selectedRunItem === undefined && runState.status === "idle";
  const projectSlug = selectedRunItem?.project.record.slug;
  const runQuestion = selectedRunItem?.run.record.question;
  const shouldShowStartAction = isNewRunMode;
  const shouldShowAbortAction = !isNewRunMode && selectedProjectHasLiveRun && runState.status === "running";
  const isCurrentRunPinned = Boolean(
    selectedRunItem && isQuestionFixedForRun(selectedRunItem.project, selectedRunItem.run.record.id)
  );
  const shouldShowCompleteAction = !isNewRunMode
    && selectedProjectHasLiveRun
    && runState.status === "paused"
    && currentRunVisualState === "round-complete"
    && !isCurrentRunPinned;
  const shouldShowResumeAction = !isNewRunMode && isCurrentRunPinned && Boolean(selectedRunItem);

  const resizeInterventionInput = () => {
    const input = interventionInputRef.current;
    if (!input) {
      return;
    }
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  };

  const submitIntervention = () => {
    if (!currentRunId || !canSubmitIntervention) {
      return;
    }
    void onSubmitIntervention(currentRunId, message);
    setMessage("");
  };

  const handleInterventionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    submitIntervention();
  };

  useEffect(() => {
    resizeInterventionInput();
  }, [message]);

  return (
    <section className="runs-control-card">
      <div className="runs-card-header">
        <h2>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          에이전트 대화
        </h2>
        <div className="runs-header-right">
          {shouldShowHeaderGuide ? (
            <span className="runs-header-guide">에이전트 대화를 시작하려면 ▶ 버튼을 누르세요</span>
          ) : null}
          {canIntervene && currentRunVisualState && currentRunVisualLabel ? (
            <div className={`runs-live-indicator state-${currentRunVisualState}`} aria-hidden="true">
              <span className="runs-live-dot" />
              <span className="runs-live-label">{currentRunVisualLabel}</span>
            </div>
          ) : null}
          {shouldShowResumeAction ? (
            <button
              type="button"
              className="runs-header-action-btn is-neutral"
              disabled={!selectedRunItem || !canStartThisProject}
              onClick={() => {
                if (!selectedRunItem) {
                  return;
                }
                void onResumeRun(selectedRunItem.project.record.slug, selectedRunItem.run.record.id);
              }}
              aria-label="재개"
              title="재개"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M7 7h6" />
                <path d="M7 7v6" />
                <path d="M7 7l10 10" />
                <polygon points="11 10 18 14 11 18 11 10" />
              </svg>
            </button>
          ) : null}
          {shouldShowCompleteAction ? (
            <button
              type="button"
              className="runs-header-action-btn is-success"
              disabled={!liveRunItem || !liveRunCanComplete}
              onClick={() => {
                if (!liveRunItem) {
                  return;
                }
                void onCompleteRun(selectedProjectSlug, liveRunItem.run.record.id);
              }}
              aria-label="문항 고정"
              title="문항 고정"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M12 17v5" />
                <path d="M6 9V4l6-2 6 2v5" />
                <path d="M6 9l6 4 6-4" />
                <path d="M8 13v4" />
                <path d="M16 13v4" />
              </svg>
            </button>
          ) : null}
          {shouldShowStartAction ? (
            <button
              type="button"
              className="runs-header-action-btn"
              disabled={!canStartThisProject}
              onClick={onStartRun}
              aria-label="실행 시작"
              title="실행 시작"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <polygon points="8 5 19 12 8 19 8 5" />
              </svg>
            </button>
          ) : null}
          {shouldShowAbortAction ? (
            <button
              type="button"
              className="runs-header-action-btn is-danger"
              disabled={!liveRunItem}
              onClick={() => {
                if (!liveRunItem) {
                  return;
                }
                void onAbortRun(liveRunItem.run.record.id);
              }}
              aria-label="중단"
              title="중단"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="1.5" ry="1.5" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <RunFeed
        runId={currentRunId}
        projectSlug={projectSlug}
        runQuestion={runQuestion}
        isLive={isCurrentRunLive && runState.status !== "idle"}
        onCreateRunSocket={onCreateRunSocket}
        onGetRunMessages={onGetRunMessages}
        onInsertFinalDraft={onInsertFinalDraft}
      />

      <div className="runs-intervention-bar">
        <textarea
          ref={interventionInputRef}
          rows={1}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleInterventionKeyDown}
          disabled={!canIntervene}
          placeholder="실행 중인 세션에 개입 메시지를 보냅니다 (Enter 전송, Shift+Enter/Alt+Enter 줄바꿈)"
        />
        <button
          className="runs-send-button"
          disabled={!canSubmitIntervention}
          onClick={submitIntervention}
          aria-label="메시지 전송"
          title="메시지 전송"
        >
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </section>
  );
}

function normalizeMaxRoundsPerSectionInput(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(5, Math.max(1, Math.trunc(parsed)));
}

function getVisibleRunFeedMessageContent(message: RunChatMessage): string | null {
  if (message.speakerRole === "finalizer") {
    const draftIndex = message.content.indexOf("## Final Draft");
    if (draftIndex < 0) {
      return message.status === "streaming" ? null : message.content.trimEnd();
    }
    const afterHeading = message.content.slice(draftIndex + "## Final Draft".length);
    const checksIndex = afterHeading.indexOf("## Final Checks");
    const body = checksIndex >= 0
      ? afterHeading.slice(0, checksIndex)
      : afterHeading;
    return body.trim() || null;
  }

  if (message.speakerRole !== "drafter") {
    const visibleContent = message.content;
    if (message.status === "streaming" && !visibleContent.trim()) {
      return null;
    }
    return visibleContent;
  }

  const sectionDraftIndex = message.content.indexOf("## Section Draft");
  if (sectionDraftIndex < 0) {
    if (message.status === "streaming") {
      return null;
    }
    return message.content === "" ? null : message.content;
  }

  const visibleContent = message.content
    .slice(sectionDraftIndex + "## Section Draft".length)
    .replace(/^\r?\n/, "");

  return message.status === "completed" ? visibleContent.trimEnd() : visibleContent;
}

function shouldRenderRunFeedMessage(message: RunChatMessage): boolean {
  return getVisibleRunFeedMessageContent(message) !== null;
}

type ParticipantStatus = "thinking" | "writing";

type ActiveParticipants = Map<string, {
  status: ParticipantStatus;
  label: string;
  providerId?: ProviderId;
}>;

function applyRunEvent(messages: RunChatMessage[], event: RunEvent): RunChatMessage[] {
  if (event.type === "chat-message-started" && event.messageId) {
    if (messages.some((message) => message.id === event.messageId)) {
      return messages;
    }

    const msg: RunChatMessage = {
      id: event.messageId,
      providerId: event.providerId,
      participantId: event.participantId,
      participantLabel: event.participantLabel,
      speaker: event.participantLabel ?? event.participantId ?? "Agent",
      speakerRole: (event.speakerRole as RunChatMessage["speakerRole"]) ?? "system",
      recipient: event.recipient,
      round: event.round,
      content: "",
      startedAt: event.timestamp,
      status: "streaming"
    };
    return [...messages, msg];
  }

  if (event.type === "chat-message-delta" && event.messageId) {
    return messages.map((msg) =>
      msg.id === event.messageId
        ? {
            ...msg,
            content: msg.content + (event.message ?? "")
          }
        : msg
    );
  }

  if (event.type === "chat-message-completed" && event.messageId) {
    return messages.map((msg) =>
      msg.id === event.messageId
        ? {
            ...msg,
            status: "completed" as const,
            finishedAt: event.timestamp
          }
        : msg
    );
  }

  return messages;
}

function getActiveParticipantKey(event: RunEvent): string | undefined {
  return event.participantId ?? event.speakerRole;
}

function applyRunEventToActiveParticipants(
  activeParticipants: ActiveParticipants,
  event: RunEvent
): ActiveParticipants {
  const participantKey = getActiveParticipantKey(event);
  if (!participantKey) {
    return activeParticipants;
  }

  if (event.type === "turn-started") {
    const next = new Map(activeParticipants);
    next.set(participantKey, {
      status: "thinking",
      label: event.participantLabel ?? event.participantId ?? "Agent",
      providerId: event.providerId
    });
    return next;
  }

  if (event.type === "chat-message-started") {
    const participant = activeParticipants.get(participantKey);
    if (!participant) {
      return activeParticipants;
    }

    const next = new Map(activeParticipants);
    next.set(participantKey, {
      ...participant,
      status: "writing",
      providerId: event.providerId ?? participant.providerId
    });
    return next;
  }

  if (event.type === "turn-completed") {
    if (!activeParticipants.has(participantKey)) {
      return activeParticipants;
    }

    const next = new Map(activeParticipants);
    next.delete(participantKey);
    return next;
  }

  return activeParticipants;
}

function buildLedgerMapKey(participantId?: string, round?: number, messageId?: string): string {
  return `${participantId ?? ""}:${round ?? ""}:${messageId ?? ""}`;
}

function findLedgerMessageId(messages: RunChatMessage[], participantId?: string, round?: number): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.participantId === participantId && message.round === round) {
      return message.id;
    }
  }

  return undefined;
}

const PROVIDER_COLORS: Record<string, string> = {
  claude: "#e8632c",
  anthropic: "#e8632c",
  gemini: "#1b9af7",
  google: "#1b9af7",
  codex: "#1a1a1a",
  openai: "#1a1a1a"
};

const ROLE_LABELS: Record<string, string> = {
  coordinator: "코디네이터",
  section_coordinator: "섹션 코디네이터",
  drafter: "초안 작성자",
  section_drafter: "섹션 초안 작성자",
  finalizer: "최종 편집자",
  evidence_reviewer: "근거 검토자",
  fit_reviewer: "적합성 검토자",
  tone_reviewer: "어조 검토자",
  context_researcher: "컨텍스트 연구자",
  system: "시스템",
  user: "사용자"
};

function isReviewerRole(role: string): boolean {
  return role.endsWith("_reviewer") || role === "reviewer";
}

function providerColor(providerId?: ProviderId): string {
  if (!providerId) {
    return "#64748b";
  }
  const lower = providerId.toLowerCase();
  for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
    if (lower.includes(key)) {
      return color;
    }
  }
  return "#64748b";
}

function RunFeed({
  runId,
  projectSlug,
  runQuestion,
  isLive,
  onCreateRunSocket,
  onGetRunMessages,
  onInsertFinalDraft
}: {
  runId?: string;
  projectSlug?: string;
  runQuestion?: string;
  isLive: boolean;
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
  onInsertFinalDraft?(text: string): void;
}) {
  const [messages, setMessages] = useState<RunChatMessage[]>([]);
  const [activeParticipants, setActiveParticipants] = useState<ActiveParticipants>(new Map());
  const [ledgerMap, setLedgerMap] = useState<ReadonlyMap<string, DiscussionLedger>>(new Map());
  const [pendingPrompt, setPendingPrompt] = useState<string | undefined>(undefined);
  const messagesRef = useRef<RunChatMessage[]>([]);
  const activeParticipantsRef = useRef<ActiveParticipants>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  // Stable refs so callbacks don't cause effect re-runs
  const onCreateRunSocketRef = useRef(onCreateRunSocket);
  const onGetRunMessagesRef = useRef(onGetRunMessages);
  onCreateRunSocketRef.current = onCreateRunSocket;
  onGetRunMessagesRef.current = onGetRunMessages;

  useEffect(() => {
    if (!runId) {
      messagesRef.current = [];
      activeParticipantsRef.current = new Map();
      setMessages([]);
      setActiveParticipants(new Map());
      setLedgerMap(new Map());
      setPendingPrompt(undefined);
      return;
    }

    activeParticipantsRef.current = new Map();
    setActiveParticipants(new Map());
    setLedgerMap(new Map());
    setPendingPrompt(undefined);
    let disposed = false;
    let pendingClear = true;
    let receivedCount = 0;

    // Always connect WebSocket — RunHub replays buffered events for live runs,
    // so even late-connecting clients receive the full stream.
    const socket = onCreateRunSocketRef.current(runId);

    socket.onmessage = (ev) => {
      if (disposed) {
        return;
      }
      const parsed = JSON.parse(ev.data as string) as unknown;

      const interventionFrame = decodeInterventionRequestFrame(parsed);
      if (interventionFrame && interventionFrame.runId === runId) {
        setPendingPrompt(interventionFrame.prompt);
        return;
      }

      const frame = decodeRunEventFrame(parsed);
      if (!frame || frame.runId !== runId) {
        return;
      }
      const { event } = frame;
      // Clear any pending prompt when user input is received
      if (event.type === "user-input-received") {
        setPendingPrompt(undefined);
      }
      receivedCount++;

      if (event.type === "discussion-ledger-updated" && event.discussionLedger) {
        const messageId = event.messageId
          ?? findLedgerMessageId(messagesRef.current, event.participantId, event.round);
        if (!messageId) {
          return;
        }

        const key = buildLedgerMapKey(event.participantId, event.round, messageId);
        setLedgerMap((prev) => {
          const next = new Map(prev);
          next.set(key, event.discussionLedger!);
          return next;
        });
        return;
      }

      if (event.type === "chat-message-started" && pendingClear) {
        messagesRef.current = [];
        setMessages([]);
        pendingClear = false;
      }

      const nextMessages = applyRunEvent(messagesRef.current, event);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      const nextActiveParticipants = applyRunEventToActiveParticipants(activeParticipantsRef.current, event);
      activeParticipantsRef.current = nextActiveParticipants;
      setActiveParticipants(nextActiveParticipants);
    };

    // Fallback for completed runs: if WebSocket delivers nothing after 1 s,
    // load the persisted chat-messages.json via HTTP.
    const historyTimer = setTimeout(() => {
      if (!disposed && receivedCount === 0 && projectSlug) {
        void onGetRunMessagesRef.current(projectSlug, runId).then(({ messages: loaded, ledgers: loadedLedgers }) => {
          if (!disposed && loaded.length > 0) {
            if (pendingClear) {
              messagesRef.current = [];
              setMessages([]);
              pendingClear = false;
            }
            messagesRef.current = loaded;
            setMessages(loaded);
          }

          if (!disposed && loadedLedgers.length > 0) {
            const nextLedgerMap = new Map<string, DiscussionLedger>();
            for (const entry of loadedLedgers) {
              nextLedgerMap.set(buildLedgerMapKey(entry.participantId, entry.round, entry.messageId), entry.ledger);
            }
            setLedgerMap(nextLedgerMap);
          }
        });
      }
    }, 1000);

    return () => {
      disposed = true;
      clearTimeout(historyTimer);
      socket.close();
    };
    // Only re-run when the selected run or its project changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, projectSlug]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeParticipants, messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  const visibleMessages = messages.filter(shouldRenderRunFeedMessage);
  const typingRows = activeParticipants.size > 0 ? (
    <div className="runs-feed-typing">
      {[...activeParticipants.entries()].map(([id, info]) => (
        <div key={id} className="runs-feed-typing-row">
          <span className="runs-feed-typing-name" style={{ color: providerColor(info.providerId) }}>
            {info.label}
          </span>
          <span className="runs-feed-typing-label">
            {info.status === "thinking" ? "생각중" : "작성중"}
          </span>
          <span className="runs-feed-typing-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="runs-feed" ref={scrollRef} onScroll={handleScroll}>
      {visibleMessages.length === 0 ? (
        <div className="runs-feed-empty">
          {isLive ? (
            <>
              <div className="runs-live-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p>에이전트들이 교차 검증을 준비 중입니다...</p>
            </>
          ) : runId ? (
            <p>이 실행의 대화 내용이 없습니다.</p>
          ) : (
            <p>실행을 시작하거나 이전 실행을 선택하면 대화 내용을 볼 수 있습니다.</p>
          )}
        </div>
      ) : (
        visibleMessages.map((msg) => {
          const ledger = ledgerMap.get(buildLedgerMapKey(msg.participantId, msg.round, msg.id));
          return (
            <RunFeedMessage
              key={msg.id}
              message={msg}
              ledger={ledger}
              runQuestion={runQuestion}
              onInsertFinalDraft={onInsertFinalDraft}
            />
          );
        })
      )}
      {typingRows}
      {pendingPrompt ? (
        <div className="runs-feed-intervention-prompt">
          <span className="runs-feed-intervention-prompt-label">에이전트 질문</span>
          <p className="runs-feed-intervention-prompt-text">{pendingPrompt}</p>
        </div>
      ) : null}
    </div>
  );
}


function FinalDraftCard({
  color,
  question,
  body,
  isStreaming,
  onInsert
}: {
  color: string;
  question?: string;
  body: string;
  isStreaming: boolean;
  onInsert?: InsertDraftHandler;
}) {
  const hasVisibleContent = body.trim().length > 0;
  const normalizedQuestion = question?.trim() || undefined;
  const html = hasVisibleContent ? renderMarkdown(body).trim() : "";
  const canInsert = !isStreaming && hasVisibleContent && onInsert !== undefined;
  const shouldRenderHeader = normalizedQuestion !== undefined || canInsert;

  return (
    <div
      className={`runs-finalizer-card${isStreaming ? " is-streaming" : ""}`}
      style={{ borderLeftColor: color }}
    >
      {shouldRenderHeader ? (
        <div className="runs-finalizer-card-header">
          {normalizedQuestion ? (
            <span className="runs-finalizer-card-question" title={normalizedQuestion}>
              {normalizedQuestion}
            </span>
          ) : null}
          {canInsert ? (
            <button
              type="button"
              className="runs-finalizer-insert-btn"
              aria-label="초안에 삽입"
              onClick={() => onInsert?.(body)}
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M12 4v10" />
                <polyline points="8 10 12 14 16 10" />
                <path d="M5 19h14" />
              </svg>
              <span className="runs-finalizer-insert-tooltip" role="tooltip">초안에 삽입</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="runs-finalizer-card-body">
        {isStreaming && !hasVisibleContent ? (
          <span className="runs-feed-typing-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        ) : (
          /* eslint-disable-next-line react/no-danger */
          <div dangerouslySetInnerHTML={{ __html: html || "(내용 없음)" }} />
        )}
      </div>
    </div>
  );
}

function RunFeedMessage({
  message,
  ledger,
  runQuestion,
  onInsertFinalDraft
}: {
  message: RunChatMessage;
  ledger?: DiscussionLedger;
  runQuestion?: string;
  onInsertFinalDraft?: InsertDraftHandler;
}) {
  const isCoordinator = message.speakerRole === "coordinator";
  const isReviewerCardRole = isReviewerRole(message.speakerRole as string);
  const isFinalizer = message.speakerRole === "finalizer";
  const color = providerColor(message.providerId);
  const roleLabel = ROLE_LABELS[message.speakerRole] ?? message.speakerRole;
  const isStreaming = message.status === "streaming";
  const renderedContent = getVisibleRunFeedMessageContent(message) ?? "";

  const targetRef = useRef(renderedContent);
  targetRef.current = renderedContent;

  // Typewriter: start empty for streaming messages, show full content immediately for completed ones.
  // The interval runs from mount and chases targetRef regardless of status changes,
  // so Codex (full text arrives at once on completion) still gets a typewriter effect.
  const initiallyStreaming = useRef(isStreaming);
  const [displayed, setDisplayed] = useState(() =>
    isStreaming ? "" : renderedContent
  );

  useEffect(() => {
    if (!isStreaming) {
      setDisplayed(renderedContent);
      return;
    }

    setDisplayed((prev) => (renderedContent.startsWith(prev) ? prev : ""));
  }, [isStreaming, renderedContent]);

  useEffect(() => {
    if (!initiallyStreaming.current) {
      return;
    }

    const tick = setInterval(() => {
      setDisplayed((prev) => {
        const target = targetRef.current;
        if (prev.length >= target.length) {
          return prev;
        }
        const lag = target.length - prev.length;
        const step = lag > 50 ? 3 : 1;
        return target.slice(0, prev.length + step);
      });
    }, 15);

    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasFinalDraftMarker = message.content.includes("## Final Draft");
  const hasVisibleContent = displayed.trim().length > 0;
  const html = hasVisibleContent ? renderMarkdown(displayed) : "";
  const reviewerCard = message.status === "completed" && isReviewerCardRole
    ? parseReviewerCardContent(message.content)
    : null;

  return (
    <div className="runs-feed-message">
      <div className="runs-feed-message-header">
        <span className="runs-feed-message-speaker" style={{ color }}>
          {message.speaker}
        </span>
        <span className="runs-feed-message-role">{roleLabel}</span>
        {message.round !== undefined ? (
          <span className="runs-feed-message-round">R{message.round}</span>
        ) : null}
        {message.recipient ? (
          <span className="runs-feed-message-recipient">→ {message.recipient}</span>
        ) : null}
      </div>
      {ledger && isCoordinator ? (
        <CoordinatorLedgerCard ledger={ledger} color={color} />
      ) : reviewerCard ? (
        <ReviewerCard color={color} review={reviewerCard} />
      ) : isFinalizer ? (
        <FinalDraftCard
          color={color}
          question={hasFinalDraftMarker ? runQuestion : undefined}
          body={displayed}
          isStreaming={isStreaming}
          onInsert={onInsertFinalDraft}
        />
      ) : (
        <div
          className={`runs-feed-message-body${isStreaming ? " is-streaming" : ""}`}
          style={{ borderLeftColor: color }}
        >
          {isStreaming && !hasVisibleContent ? (
            <span className="runs-feed-typing-dots" aria-hidden="true">
              <span /><span /><span />
            </span>
          ) : (
            <>
              {/* eslint-disable-next-line react/no-danger */}
              <div dangerouslySetInnerHTML={{ __html: html || "(내용 없음)" }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const SECTION_OUTCOME_LABELS: Partial<Record<string, string>> = {
  "close-section": "섹션 완료",
  "handoff-next-section": "다음 섹션으로 이동",
  "write-final": "최종 작성 단계"
};

function filterLedgerItems(items?: readonly string[]): string[] {
  if (!items) {
    return [];
  }
  return items.filter((item) => {
    const t = item.trim();
    return t && t !== "없음" && t !== "- 없음";
  });
}

function CoordinatorLedgerCard({ ledger, color }: { ledger: DiscussionLedger; color: string }) {
  const mustKeep = filterLedgerItems(ledger.mustKeep);
  const mustResolve = filterLedgerItems(ledger.mustResolve);
  const outcomeLabel = ledger.sectionOutcome
    ? SECTION_OUTCOME_LABELS[ledger.sectionOutcome]
    : undefined;

  return (
    <div className="runs-coordinator-card" style={{ borderLeftColor: color }}>
      <div className="runs-coordinator-section-header">
        {ledger.targetSection}
      </div>

      {ledger.currentFocus && (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">핵심 방향</span>
          <p className="runs-coordinator-text">{ledger.currentFocus}</p>
        </div>
      )}

      {ledger.rewriteDirection && (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">작성 방향</span>
          <p className="runs-coordinator-text">{ledger.rewriteDirection}</p>
        </div>
      )}

      {mustKeep.length > 0 && (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">유지할 것</span>
          <ul className="runs-coordinator-list">
            {mustKeep.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {mustResolve.length > 0 && (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label runs-coordinator-label-warn">해결할 것</span>
          <ul className="runs-coordinator-list">
            {mustResolve.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {ledger.miniDraft && (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">초안 방향</span>
          <p className="runs-coordinator-text runs-coordinator-draft">{ledger.miniDraft}</p>
        </div>
      )}

      {outcomeLabel && (
        <div className="runs-coordinator-outcome">
          {outcomeLabel}
        </div>
      )}
    </div>
  );
}

function buildActiveStatusLabel(
  selectedRunItem: RunListItem | undefined,
  runState: SidebarState["runState"],
  liveRunVisualState: RunVisualState | undefined
): string {
  if (selectedRunItem) {
    return labelForRunVisualState(
      resolveRunVisualState(selectedRunItem, runState, liveRunVisualState),
      selectedRunItem.run.record.reviewMode
    );
  }

  if (liveRunVisualState) {
    return labelForRunVisualState(liveRunVisualState, runState.reviewMode);
  }

  return labelForRunVisualState("active-waiting", runState.reviewMode);
}

function deriveProjectQuestion(project?: ProjectViewModel): string {
  return project?.record.essayQuestions?.find((question) => question.trim())?.trim() ?? "";
}

function findEssayAnswerDraft(
  essayAnswerStates: ProjectViewModel["essayAnswerStates"],
  questionIndex: number
): string {
  const answerState = essayAnswerStates.find((state) => state.questionIndex === questionIndex);
  return answerState?.content ?? "";
}

function resolveInitialSelectedQuestionIndex(
  project: ProjectViewModel,
  record: RunListItem["run"]["record"] | undefined,
  questionFallback: string
): number {
  const essayQuestions = project.record.essayQuestions ?? [];
  if (!essayQuestions.length) {
    return -1;
  }

  if (record) {
    return resolveRunQuestionIndex(project, record);
  }

  const fallbackIndex = essayQuestions.findIndex((question) => question.trim() === questionFallback.trim());
  return fallbackIndex >= 0 ? fallbackIndex : 0;
}

function buildEssayQuestionOptionLabel(questionIndex: number, question: string): string {
  return `${questionIndex + 1}. ${question}`;
}

function resolveRunQuestionIndex(
  project: ProjectViewModel,
  record?: RunListItem["run"]["record"]
): number {
  if (!record) {
    return -1;
  }
  if (typeof record.projectQuestionIndex === "number") {
    return record.projectQuestionIndex;
  }

  return project.record.essayQuestions?.findIndex((question) => question.trim() === record.question.trim()) ?? -1;
}

function deriveSessionRunVisualState(runState: SidebarState["runState"]): RunVisualState | undefined {
  if (runState.status === "aborting") {
    return "aborting";
  }
  if (runState.status === "paused") {
    return "waiting";
  }
  if (runState.status === "running") {
    return "active-waiting";
  }
  return undefined;
}

function reduceLiveRunVisualState(
  previous: RunVisualState | undefined,
  event: RunEvent
): RunVisualState | undefined {
  switch (event.type) {
    case "turn-started":
      return "cli-running";
    case "turn-completed":
      return "active-waiting";
    case "awaiting-user-input":
      return "waiting";
    case "user-input-received":
      return "active-waiting";
    case "turn-failed":
    case "run-failed":
      return "failed";
    case "run-started":
      return "active-waiting";
    case "run-aborted":
      return "aborted";
    case "run-completed":
      return "round-complete";
    default:
      return previous;
  }
}

function resolveRunVisualState(
  item: RunListItem,
  runState: SidebarState["runState"],
  liveRunVisualState: RunVisualState | undefined
): RunVisualState {
  if (item.run.record.id === runState.runId && liveRunVisualState) {
    return liveRunVisualState;
  }

  return runVisualStateForRecord(item, runState);
}

function resolveActiveRunVisualState(
  selectedRunItem: RunListItem | undefined,
  runState: SidebarState["runState"],
  liveRunVisualState: RunVisualState | undefined
): RunVisualState {
  if (selectedRunItem) {
    return resolveRunVisualState(selectedRunItem, runState, liveRunVisualState);
  }

  return deriveSessionRunVisualState(runState) ?? "active-waiting";
}

function runVisualStateForRecord(
  item: RunListItem,
  runState: SidebarState["runState"]
): RunVisualState {
  const { record } = item.run;
  if (record.status === "aborted") {
    return "aborted";
  }
  if (record.status === "failed") {
    return "failed";
  }
  if (record.status === "awaiting-user-input") {
    return "waiting";
  }
  if (isQuestionFixedForRun(item.project, record.id)) {
    return "finished";
  }
  if (record.status === "completed") {
    return "round-complete";
  }
  if (isStaleRunningRecord(record.id, runState)) {
    return "failed";
  }
  return "active-waiting";
}

function isQuestionFixedForRun(project: ProjectViewModel, runId: string): boolean {
  return project.essayAnswerStates.some((state) => state.status === "completed" && state.lastRunId === runId);
}

function isStaleRunningRecord(
  runId: string,
  runState: SidebarState["runState"]
): boolean {
  if (runState.runId === runId) {
    return false;
  }
  if (runState.status === "idle") {
    return true;
  }
  return Boolean(runState.runId && runState.runId !== runId);
}

function labelForRunVisualState(
  state: RunVisualState,
  reviewMode?: RunListItem["run"]["record"]["reviewMode"]
): string {
  switch (state) {
    case "draft":
      return "실행 준비";
    case "cli-running":
      return "CLI 실행 중";
    case "active-waiting":
      return "대기 중";
    case "waiting":
      return "입력 대기 중";
    case "round-complete":
      return reviewMode === "deepFeedback" ? "사이클 종료" : "라운드 종료";
    case "aborting":
      return "중단 중";
    case "failed":
      return "오류";
    case "aborted":
      return "중단됨";
    case "finished":
      return "문항 고정";
    default:
      return "대기 중";
  }
}
