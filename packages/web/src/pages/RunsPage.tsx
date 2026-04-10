import type {
  DiscussionLedger,
  ProjectViewModel,
  ProviderId,
  RunChatMessage,
  RunEvent,
  RunLedgerEntry,
  SidebarState
} from "@jafiction/shared";
import { Renderer, marked, type Tokens } from "marked";
import { useEffect, useRef, useState } from "react";
import {
  buildParticipantSelectionFromDefaults,
  buildRoleAssignmentsFromDefaults,
  essayRoleIds,
  essayRoleLabels,
  materializeAgentDefaults
} from "../agentDefaults";
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
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
}

interface RunListItem {
  project: ProjectViewModel;
  run: ProjectViewModel["runs"][number];
}

type RunVisualState =
  | "draft"
  | "cli-running"
  | "active-waiting"
  | "round-complete"
  | "aborting"
  | "failed"
  | "aborted"
  | "finished";

const ACTIVE_RUN_RESTART_CONFIRM_MESSAGE = "현재 실행 중인 작업이 있습니다. 중단하고 새 실행을 시작하시겠습니까?";
const IDLE_WAIT_POLL_MS = 100;
const IDLE_WAIT_TIMEOUT_MS = 15_000;

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
  onCreateRunSocket,
  onGetRunMessages
}: RunsPageProps) {
  const selectedProject = projects.find((project) => project.record.slug === selectedProjectSlug) ?? projects[0];
  const runItems = projects
    .flatMap<RunListItem>((project) => project.runs.map((run) => ({ project, run })))
    .sort((left, right) => new Date(right.run.record.startedAt).getTime() - new Date(left.run.record.startedAt).getTime());

  const selectedRunItem = runItems.find((item) => item.run.record.id === selectedRunId);
  const liveRunId = state.runState.runId;
  const liveRunItem = liveRunId ? runItems.find((item) => item.run.record.id === liveRunId) : undefined;
  const [liveRunVisualState, setLiveRunVisualState] = useState<RunVisualState | undefined>(() => (
    deriveSessionRunVisualState(state.runState)
  ));

  useEffect(() => {
    if (!liveRunId || state.runState.status === "idle") {
      setLiveRunVisualState(undefined);
      return;
    }

    const sessionState = deriveSessionRunVisualState(state.runState);
    if (sessionState === "round-complete") {
      setLiveRunVisualState("round-complete");
      return;
    }

    if (sessionState === "aborting") {
      setLiveRunVisualState("aborting");
      return;
    }

    if (sessionState === "active-waiting") {
      setLiveRunVisualState((previous) => (
        previous === "cli-running" || previous === "failed" || previous === "finished" || previous === "aborting"
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

      const { event } = JSON.parse(ev.data as string) as { runId: string; event: RunEvent };
      setLiveRunVisualState((previous) => reduceLiveRunVisualState(previous, event));
    };

    return () => {
      disposed = true;
      socket.close();
    };
  }, [liveRunId, onCreateRunSocket, state.runState.status]);

  if (!selectedProject) {
    return (
      <section className="runs-page runs-page-empty">
        <div className="runs-empty-state">
          <h2>실행할 프로젝트가 없습니다.</h2>
          <p>먼저 프로젝트를 만든 뒤 다시 실행 화면을 열어 주세요.</p>
        </div>
      </section>
    );
  }

  const contextDocuments = selectedProject.documents.filter((document) => !isInsightDocumentTitle(document.title));
  const availableQuestion = deriveProjectQuestion(selectedProject);
  const availableDraft = deriveProjectDraft(selectedProject);
  const isNewRunMode = selectedRunId === undefined;
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
                    className="runs-history-item-select"
                    onClick={() => {
                      onSelectProject(item.project.record.slug);
                      onSelectRun(item.run.record.id);
                    }}
                  >
                    <div className="runs-history-topline">
                      <span className={`runs-history-dot is-${visualState}`} />
                    </div>

                    <div className="runs-history-copy">
                      <strong>{item.project.record.companyName}</strong>
                      <span>{item.project.record.roleName ?? "직무 미정"}</span>
                    </div>

                    <small>{formatRelative(item.run.record.startedAt)}</small>
                  </button>

                  <button
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
                문서 워크스페이스
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
              onCompleteRun={onCompleteRun}
              questionFallback={availableQuestion}
              draftFallback={availableDraft}
              contextDocuments={contextDocuments}
              isNewRunMode={isNewRunMode}
            />

            <RunControlPanel
              currentRunId={selectedRunId}
              currentRunStatus={state.runState.status}
              liveRunId={liveRunId}
              selectedRunItem={selectedRunItem}
              currentRunVisualState={selectedRunItem ? resolveRunVisualState(selectedRunItem, state.runState, liveRunVisualState) : undefined}
              currentRunVisualLabel={selectedRunItem ? labelForRunVisualState(
                resolveRunVisualState(selectedRunItem, state.runState, liveRunVisualState),
                selectedRunItem.run.record.reviewMode
              ) : undefined}
              onSubmitIntervention={onSubmitIntervention}
              onCreateRunSocket={onCreateRunSocket}
              onGetRunMessages={onGetRunMessages}
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
  onCompleteRun,
  questionFallback,
  draftFallback,
  contextDocuments,
  isNewRunMode
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
  onCompleteRun(projectSlug: string, runId: string): Promise<void>;
  questionFallback: string;
  draftFallback: string;
  contextDocuments: ProjectViewModel["documents"];
  isNewRunMode: boolean;
}) {
  const providers = state.providers;
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
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [maxRoundsPerSection, setMaxRoundsPerSection] = useState("1");
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  const runStateRef = useRef(state.runState);

  useEffect(() => {
    runStateRef.current = state.runState;
  }, [state.runState]);

  useEffect(() => {
    if (!isProjectDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isProjectDropdownOpen]);

  useEffect(() => {
    if (selectedRunItem) {
      setQuestion(selectedRunItem.run.record.question);
      setDraft(selectedRunItem.run.record.draft);
      setMaxRoundsPerSection(String(selectedRunItem.run.record.maxRoundsPerSection ?? 1));
      return;
    }

    setQuestion(questionFallback);
    setDraft(draftFallback);
    setMaxRoundsPerSection("1");
  }, [
    draftFallback,
    questionFallback,
    selectedRunItem?.run.record.draft,
    selectedRunItem?.run.record.id,
    selectedRunItem?.run.record.maxRoundsPerSection,
    selectedRunItem?.run.record.question
  ]);

  const matchedQuestionIndex = selectedProject.record.essayQuestions?.findIndex((item) => item.trim() === question.trim()) ?? -1;
  const selectedProjectHasLiveRun = state.runState.status !== "idle" && state.runState.projectSlug === selectedProject.record.slug;
  const liveRunId = selectedProjectHasLiveRun ? state.runState.runId : undefined;
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

  const startPayload = {
    projectQuestionIndex: matchedQuestionIndex >= 0 ? matchedQuestionIndex : undefined,
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

  return (
    <section className="runs-composer-card">
      <div className="runs-card-header">
        <h2>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          실행 파라미터 구성
        </h2>
      </div>

      <div className="runs-composer-body">
        <div className="runs-field">
          <label className="runs-field-label" id="runs-project-select-label">대상 프로젝트</label>
          <div
            className={`runs-custom-select${isProjectDropdownOpen ? " is-open" : ""}`}
            ref={projectDropdownRef}
          >
            <button
              id="runs-project-select"
              type="button"
              className="runs-custom-select-trigger"
              aria-haspopup="listbox"
              aria-expanded={isProjectDropdownOpen}
              aria-labelledby="runs-project-select-label"
              onClick={() => setIsProjectDropdownOpen((prev) => !prev)}
            >
              <span className="runs-custom-select-value">
                {selectedProject.record.companyName}{selectedProject.record.roleName ? ` - ${selectedProject.record.roleName}` : ""}
              </span>
              <span className="runs-custom-select-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            {isProjectDropdownOpen && (
              <ul
                className="runs-custom-select-dropdown"
                role="listbox"
                aria-labelledby="runs-project-select-label"
              >
                {projects.map((project) => (
                  <li
                    key={project.record.slug}
                    role="option"
                    aria-selected={project.record.slug === selectedProject.record.slug}
                    className={`runs-custom-select-option${project.record.slug === selectedProject.record.slug ? " is-selected" : ""}`}
                    onClick={() => {
                      onClearRunSelection();
                      onSelectProject(project.record.slug);
                      setIsProjectDropdownOpen(false);
                    }}
                  >
                    {project.record.companyName}{project.record.roleName ? ` - ${project.record.roleName}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="runs-field">
          <label className="runs-field-label" htmlFor="runs-question-textarea">작성 문항 (질문)</label>
          <textarea
            id="runs-question-textarea"
            rows={4}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="삼성전자를 지원한 이유와 입사 후 회사에서 이루고 싶은 꿈을 기술하십시오. (700자)"
          />
        </div>

        <div className="runs-field">
          <div className="runs-field-label-row">
            <label className="runs-field-label" htmlFor="runs-draft-textarea">초안 (Draft)</label>
            <button
              className="runs-inline-link"
              disabled={!draftFallback.trim()}
              onClick={() => {
                if (!draftFallback.trim()) {
                  return;
                }
                setDraft(draftFallback);
              }}
            >
              문서 불러오기
            </button>
          </div>
          <textarea
            id="runs-draft-textarea"
            rows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="어릴 적부터 전자기기에 관심이 많았고, 특히 삼성전자의 스마트폰을 사용하며 기술의 발전에 놀라움을 느꼈습니다."
          />
        </div>

        <div className="runs-field">
          <div className="runs-field-label-row">
            <label className="runs-field-label">역할 할당 (Role Assignment)</label>
            <label className="runs-field-label runs-rounds-label" htmlFor="runs-max-rounds-input">
              최대
              <select
                id="runs-max-rounds-input"
                className="runs-rounds-select"
                value={maxRoundsPerSection}
                onChange={(event) => setMaxRoundsPerSection(event.target.value)}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
              라운드
            </label>
          </div>
          <div className="runs-role-table" role="table" aria-label="실행 역할 배정 요약">
            <div className="runs-role-table-head" role="row">
              <span role="columnheader">역할</span>
              <span role="columnheader">프로바이더</span>
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
            선택된 프로젝트에 연결된 컨텍스트 문서 {contextDocuments.length}개를 실행에 사용할 수 있습니다.
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
          <div className="runs-empty-note">다른 프로젝트의 실행이 아직 활성 상태입니다. 현재 실행을 마친 뒤 다시 시작해 주세요.</div>
        ) : null}

        {!isNewRunMode && selectedProjectHasLiveRun && state.runState.status === "paused" && !liveRunCanComplete ? (
          <div className="runs-empty-note">현재 실행은 일시 중지되었지만 연결된 자소서 문항을 찾지 못해 완료 처리할 수 없습니다.</div>
        ) : null}

        {!isNewRunMode && selectedProjectHasLiveRun && state.runState.status === "running" ? (
          <button
            className="runs-start-button is-danger"
            disabled={!liveRunId}
            onClick={() => {
              if (!liveRunId) {
                return;
              }
              void onAbortRun(liveRunId);
            }}
          >
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
            </svg>
            중단
          </button>
        ) : null}

        {!isNewRunMode && selectedProjectHasLiveRun && state.runState.status === "paused" ? (
          <button
            className="runs-start-button is-success"
            disabled={!liveRunItem || !liveRunCanComplete}
            onClick={() => {
              if (!liveRunItem) {
                return;
              }
              void onCompleteRun(selectedProject.record.slug, liveRunItem.run.record.id);
            }}
          >
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            완료
          </button>
        ) : null}

        {(isNewRunMode || !selectedProjectHasLiveRun) ? (
          <button
            className="runs-start-button"
            disabled={!canStartThisProject}
            onClick={() => {
              void handleStartRun();
            }}
          >
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            실행 시작
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RunControlPanel({
  currentRunId,
  currentRunStatus,
  liveRunId,
  selectedRunItem,
  currentRunVisualState,
  currentRunVisualLabel,
  onSubmitIntervention,
  onCreateRunSocket,
  onGetRunMessages
}: {
  currentRunId?: string;
  currentRunStatus: SidebarState["runState"]["status"];
  liveRunId?: string;
  selectedRunItem?: RunListItem;
  currentRunVisualState?: RunVisualState;
  currentRunVisualLabel?: string;
  onSubmitIntervention(runId: string, message: string): Promise<void>;
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
}) {
  const [message, setMessage] = useState("");
  const isCurrentRunLive = currentRunId !== undefined && currentRunId === liveRunId;
  const canIntervene = isCurrentRunLive && (currentRunStatus === "running" || currentRunStatus === "paused");

  const projectSlug = selectedRunItem?.project.record.slug;

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
        {canIntervene && currentRunVisualState && currentRunVisualLabel ? (
          <div className={`runs-live-indicator state-${currentRunVisualState}`} aria-hidden="true">
            <span className="runs-live-dot" />
            <span className="runs-live-label">{currentRunVisualLabel}</span>
          </div>
        ) : null}
      </div>

      <RunFeed
        runId={currentRunId}
        projectSlug={projectSlug}
        isLive={isCurrentRunLive && currentRunStatus !== "idle"}
        onCreateRunSocket={onCreateRunSocket}
        onGetRunMessages={onGetRunMessages}
      />

      <div className="runs-intervention-bar">
        <input
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={!canIntervene}
          placeholder="실행 중인 세션에 개입 메시지를 보냅니다 (예: '조금 더 구체적인 사례를 강조해줘')"
        />
        <button
          className="runs-send-button"
          disabled={!canIntervene || !message.trim()}
          onClick={() => {
            if (!currentRunId) {
              return;
            }
            void onSubmitIntervention(currentRunId, message);
            setMessage("");
          }}
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

  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}

function filterDrafterMessageContent(
  content: string,
  speakerRole?: RunChatMessage["speakerRole"]
): string {
  if (speakerRole !== "drafter") {
    return content;
  }

  const sectionDraftIndex = content.indexOf("## Section Draft");
  if (sectionDraftIndex < 0) {
    return content;
  }

  return content
    .slice(sectionDraftIndex + "## Section Draft".length)
    .replace(/^\r?\n/, "");
}

function shouldRenderRunFeedMessage(message: RunChatMessage): boolean {
  return !(message.speakerRole === "drafter" && message.content === "");
}

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
            content: filterDrafterMessageContent(msg.content + (event.message ?? ""), msg.speakerRole)
          }
        : msg
    );
  }

  if (event.type === "chat-message-completed" && event.messageId) {
    return messages.map((msg) =>
      msg.id === event.messageId
        ? {
            ...msg,
            content: filterDrafterMessageContent(msg.content, msg.speakerRole),
            status: "completed" as const,
            finishedAt: event.timestamp
          }
        : msg
    );
  }

  return messages;
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
  isLive,
  onCreateRunSocket,
  onGetRunMessages
}: {
  runId?: string;
  projectSlug?: string;
  isLive: boolean;
  onCreateRunSocket(runId: string): WebSocket;
  onGetRunMessages(projectSlug: string, runId: string): Promise<{ messages: RunChatMessage[]; ledgers: RunLedgerEntry[] }>;
}) {
  const [messages, setMessages] = useState<RunChatMessage[]>([]);
  const [ledgerMap, setLedgerMap] = useState<ReadonlyMap<string, DiscussionLedger>>(new Map());
  const messagesRef = useRef<RunChatMessage[]>([]);
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
      setMessages([]);
      setLedgerMap(new Map());
      return;
    }

    setLedgerMap(new Map());
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
      const { event } = JSON.parse(ev.data as string) as { runId: string; event: RunEvent };
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
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  const visibleMessages = messages.filter(shouldRenderRunFeedMessage);

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
          return <RunFeedMessage key={msg.id} message={msg} ledger={ledger} />;
        })
      )}
    </div>
  );
}

const markdownRenderer = new Renderer();
const allowedLinkProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(raw: string, kind: "link" | "image"): string | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("?") ||
    value.startsWith("//")
  ) {
    return escapeHtml(value);
  }

  try {
    const parsed = new URL(value);
    const isAllowed = kind === "image"
      ? parsed.protocol === "http:" || parsed.protocol === "https:"
      : allowedLinkProtocols.has(parsed.protocol);
    return isAllowed ? escapeHtml(value) : undefined;
  } catch {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) ? undefined : escapeHtml(value);
  }
}

markdownRenderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escapeHtml(text);
markdownRenderer.link = ({ href, title, tokens }: Tokens.Link): string => {
  const safeHref = sanitizeUrl(href, "link");
  const label = markdownRenderer.parser.parseInline(tokens);
  if (!safeHref) {
    return label;
  }
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${safeHref}"${titleAttribute} rel="noreferrer noopener">${label}</a>`;
};
markdownRenderer.image = ({ href, title, text }: Tokens.Image): string => {
  const safeHref = sanitizeUrl(href, "image");
  if (!safeHref) {
    return escapeHtml(text);
  }
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<img src="${safeHref}" alt="${escapeHtml(text)}"${titleAttribute}>`;
};

marked.use({ async: false, breaks: true, gfm: true, renderer: markdownRenderer });

function renderMarkdown(raw: string): string {
  const parsed = marked.parse(raw);
  return typeof parsed === "string" ? parsed : "";
}

function RunFeedMessage({ message, ledger }: { message: RunChatMessage; ledger?: DiscussionLedger }) {
  const isCoordinator = message.speakerRole === "coordinator";
  const isReviewerCardRole = isReviewerRole(message.speakerRole as string);
  const color = providerColor(message.providerId);
  const roleLabel = ROLE_LABELS[message.speakerRole] ?? message.speakerRole;
  const isStreaming = message.status === "streaming";
  const renderedContent = filterDrafterMessageContent(message.content, message.speakerRole);

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
      {ledger ? (
        <CoordinatorLedgerCard ledger={ledger} color={color} />
      ) : isCoordinator && isStreaming ? (
        <div className="runs-feed-message-body is-streaming" style={{ borderLeftColor: color }}>
          <span className="runs-feed-typing-dots" aria-hidden="true">
            <span /><span /><span />
          </span>
        </div>
      ) : reviewerCard ? (
        <ReviewerCard color={color} review={reviewerCard} />
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

function deriveProjectDraft(project?: ProjectViewModel): string {
  if (!project) {
    return "";
  }

  return [...project.essayAnswerStates]
    .sort((left, right) => left.questionIndex - right.questionIndex)
    .map((state) => state.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
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
    return "round-complete";
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
      return "round-complete";
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
