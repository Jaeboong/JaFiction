import type {
  ProjectInsightWorkspaceState,
  ProjectRecord,
  ProviderId,
  ProviderRuntimeState,
  SidebarState
} from "@jasojeon/shared";
import { startTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RunnerClient, BackendClient, RunnerBootstrapError, type RunnerBootstrapErrorReason } from "./api/client";
import { BootstrapGate } from "./components/BootstrapGate";
import { UserMenu } from "./components/auth/UserMenu";
import { decodeSidebarStateFrame } from "./lib/wsFrames";
import { OverviewPage } from "./pages/OverviewPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage, type SettingsSection } from "./pages/SettingsPage";

const hostedApiBase = import.meta.env.VITE_HOSTED_API_BASE ?? "";
// Hosted mode is the only supported runtime. When VITE_HOSTED_API_BASE is
// unset we fall back to window.location.origin so local dev against a local
// backend (e.g. docker compose on 4000) still works by setting the env var.
const defaultRunnerBaseUrl = hostedApiBase || window.location.origin;
const backendBaseUrl = hostedApiBase || window.location.origin;
const backendClient = new BackendClient(backendBaseUrl);

type AppTab = "overview" | "providers" | "projects" | "runs" | "settings";
type ActionTone = "pending" | "success" | "warning" | "error";
type ProviderActionKind = "test" | "notion-check" | "notion-connect" | "notion-disconnect" | "logout";
type OpenDartActionKind = "save" | "delete" | "test";
const actionNoticeAutoDismissMs = 2200;
const actionNoticeExitMs = 200;

interface ActionNotice {
  tone: ActionTone;
  message: string;
  detail?: string;
}

interface ActionNoticeState extends ActionNotice {
  id: number;
  isLeaving: boolean;
}

interface TabIndicatorStyle {
  left: number;
  width: number;
}

const tabs: Array<{ id: AppTab; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "providers", label: "프로바이더" },
  { id: "projects", label: "지원서" },
  { id: "runs", label: "실행" },
];

export function App() {
  const [runnerBaseUrl, setRunnerBaseUrl] = useState(defaultRunnerBaseUrl);
  const [runnerBaseUrlDraft, setRunnerBaseUrlDraft] = useState(defaultRunnerBaseUrl);
  const [client, setClient] = useState<RunnerClient | undefined>();
  const [state, setState] = useState<SidebarState | undefined>();
  const [storageRoot, setStorageRoot] = useState("");
  const [selectedTab, setSelectedTab] = useState<AppTab>("overview");
  const [selectedSettingsSection, setSelectedSettingsSection] = useState<SettingsSection>("dashboard");
  const [pendingOpenDartAction, setPendingOpenDartAction] = useState<OpenDartActionKind | undefined>();
  const [selectedProjectSlug, setSelectedProjectSlug] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [actionNotice, setActionNotice] = useState<ActionNoticeState | undefined>();
  const [pendingProviderAction, setPendingProviderAction] = useState<{ providerId: ProviderId; kind: ProviderActionKind } | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [bootstrapErrorReason, setBootstrapErrorReason] = useState<RunnerBootstrapErrorReason | undefined>();
  const [bootstrapRetryNonce, setBootstrapRetryNonce] = useState(0);
  const [authModal, setAuthModal] = useState<{ providerId: ProviderId; authUrl: string } | null>(null);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | undefined>();
  const actionNoticeRef = useRef<ActionNoticeState | undefined>(undefined);
  const nextActionNoticeIdRef = useRef(0);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const noticeExitTimerRef = useRef<number | undefined>(undefined);
  const tabsRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState<TabIndicatorStyle>({ left: 0, width: 0 });
  const isAppReady = Boolean(client && state);

  const setActionNoticeState = (
    next: ActionNoticeState | undefined | ((current: ActionNoticeState | undefined) => ActionNoticeState | undefined)
  ) => {
    const resolved = typeof next === "function" ? next(actionNoticeRef.current) : next;
    actionNoticeRef.current = resolved;
    setActionNotice(resolved);
  };

  const clearActionNoticeTimers = () => {
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = undefined;
    }
    if (noticeExitTimerRef.current !== undefined) {
      window.clearTimeout(noticeExitTimerRef.current);
      noticeExitTimerRef.current = undefined;
    }
  };

  const scheduleActionNoticeRemoval = (noticeId: number) => {
    if (noticeExitTimerRef.current !== undefined) {
      window.clearTimeout(noticeExitTimerRef.current);
    }
    noticeExitTimerRef.current = window.setTimeout(() => {
      setActionNoticeState((current) => current?.id === noticeId ? undefined : current);
      noticeExitTimerRef.current = undefined;
    }, actionNoticeExitMs);
  };

  const dismissActionNotice = (noticeId = actionNoticeRef.current?.id) => {
    if (noticeId === undefined) {
      return;
    }
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = undefined;
    }

    const currentNotice = actionNoticeRef.current;
    if (!currentNotice || currentNotice.id !== noticeId || currentNotice.isLeaving) {
      return;
    }

    setActionNoticeState({ ...currentNotice, isLeaving: true });
    scheduleActionNoticeRemoval(noticeId);
  };

  useEffect(() => {
    let disposed = false;
    let stateSocket: WebSocket | undefined;

    setClient(undefined);
    setState(undefined);
    setErrorMessage(undefined);
    setBootstrapErrorReason(undefined);

    void RunnerClient.bootstrap(runnerBaseUrl)
      .then((session) => {
        if (disposed) {
          return;
        }

        const nextClient = new RunnerClient(runnerBaseUrl);
        setClient(nextClient);
        setStorageRoot(session.storageRoot);
        setLastUpdatedAt(Date.now());
        startTransition(() => {
          setState(session.state);
        });

        stateSocket = nextClient.createStateSocket();
        stateSocket.binaryType = "blob";
        stateSocket.onmessage = async (event) => {
          let raw: string;
          try {
            raw =
              typeof event.data === "string"
                ? event.data
                : await (event.data as Blob).text();
          } catch {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return;
          }
          // Hosted mode multiplexes frames through /ws/events as EventEnvelope;
          // local mode sends SidebarState directly on /ws/state.
          const snapshot = decodeSidebarStateFrame(parsed);
          if (!snapshot) {
            return;
          }
          setLastUpdatedAt(Date.now());
          startTransition(() => {
            setState(snapshot);
          });
        };
        stateSocket.onerror = () => {
          setErrorMessage("Runner state socket disconnected.");
        };
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        const reason = error instanceof RunnerBootstrapError ? error.reason : "unknown";
        setBootstrapErrorReason(reason);
        setErrorMessage(describeRunnerBootstrapError(runnerBaseUrl, error));
      });

    return () => {
      disposed = true;
      stateSocket?.close();
    };
  }, [runnerBaseUrl, bootstrapRetryNonce]);

  useEffect(() => {
    return () => {
      clearActionNoticeTimers();
    };
  }, []);

  useLayoutEffect(() => {
    const updateTabIndicator = () => {
      const tabsElement = tabsRef.current;
      const activeTabElement = activeTabRef.current;

      if (!tabsElement || !activeTabElement) {
        setTabIndicatorStyle((current) => current.width === 0 && current.left === 0 ? current : { left: 0, width: 0 });
        return;
      }

      const tabsRect = tabsElement.getBoundingClientRect();
      const activeTabRect = activeTabElement.getBoundingClientRect();
      const nextStyle = {
        left: activeTabRect.left - tabsRect.left,
        width: activeTabRect.width
      };

      setTabIndicatorStyle((current) => (
        current.left === nextStyle.left && current.width === nextStyle.width
          ? current
          : nextStyle
      ));
    };

    updateTabIndicator();
    window.addEventListener("resize", updateTabIndicator);

    return () => {
      window.removeEventListener("resize", updateTabIndicator);
    };
  }, [isAppReady, selectedTab]);

  const renderTabNav = () => (
    <nav className="app-tabs" aria-label="Main tabs" ref={tabsRef}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={selectedTab === tab.id ? activeTabRef : undefined}
          type="button"
          className={`app-tab ${selectedTab === tab.id ? "is-active" : ""}`}
          onClick={() => setSelectedTab(tab.id)}
          aria-current={selectedTab === tab.id ? "page" : undefined}
        >
          {tab.label}
        </button>
      ))}
      <div
        className="app-tab-indicator"
        aria-hidden="true"
        style={{
          width: `${tabIndicatorStyle.width}px`,
          transform: `translateX(${tabIndicatorStyle.left}px)`
        }}
      />
    </nav>
  );

  useEffect(() => {
    if (!state?.projects.length) {
      setSelectedProjectSlug(undefined);
      return;
    }

    setSelectedProjectSlug((current) => {
      if (current && state.projects.some((project) => project.record.slug === current)) {
        return current;
      }
      return state.projects[0]?.record.slug;
    });
  }, [state]);

  useEffect(() => {
    if (state?.runState.runId) {
      setSelectedRunId((current) => current ?? state.runState.runId);
    }
  }, [state?.runState.runId]);

  const selectedProject = state?.projects.find((project) => project.record.slug === selectedProjectSlug) ?? state?.projects[0];

  const showActionNotice = (notice: ActionNotice, duration = actionNoticeAutoDismissMs) => {
    clearActionNoticeTimers();

    const nextNotice: ActionNoticeState = {
      ...notice,
      id: nextActionNoticeIdRef.current + 1,
      isLeaving: false
    };
    nextActionNoticeIdRef.current = nextNotice.id;
    setActionNoticeState(nextNotice);

    if (notice.tone === "pending") {
      return;
    }
    noticeTimerRef.current = window.setTimeout(() => {
      dismissActionNotice(nextNotice.id);
      noticeTimerRef.current = undefined;
    }, duration);
  };

  const showAwaitingUserInputNotice = () => {
    showActionNotice({
      tone: "warning",
      message: "에이전트가 추가 정보를 요청했습니다."
    });
  };

  const runAction = async <T,>(options: {
    pending: ActionNotice;
    success: ActionNotice | ((result: T) => ActionNotice);
    failure?: ActionNotice | ((error: unknown) => ActionNotice);
  }, work: () => Promise<T>): Promise<T | undefined> => {
    showActionNotice(options.pending);
    try {
      const result = await work();
      const successNotice = typeof options.success === "function" ? options.success(result) : options.success;
      showActionNotice(successNotice, successNotice.tone === "error" ? 3400 : 2400);
      return result;
    } catch (error) {
      const failureNotice = typeof options.failure === "function"
        ? options.failure(error)
        : options.failure ?? { tone: "error", message: "작업에 실패했습니다.", detail: getErrorMessage(error) };
      showActionNotice(failureNotice, 3600);
      return undefined;
    }
  };

  const runProviderAction = async <T,>(
    providerId: ProviderId,
    kind: ProviderActionKind,
    options: Parameters<typeof runAction<T>>[0],
    work: () => Promise<T>
  ) => {
    setPendingProviderAction({ providerId, kind });
    try {
      return await runAction(options, work);
    } finally {
      setPendingProviderAction((current) => (
        current?.providerId === providerId && current.kind === kind ? undefined : current
      ));
    }
  };

  const refreshProviderState = async () => {
    if (!client) {
      return;
    }
    const nextState = await client.fetchState();
    setLastUpdatedAt(Date.now());
    setState(nextState);
  };

  if (!client || !state) {
    // Render the full shell chrome (header, tabs) with a gated content area
    // so the user can still see context and navigate. The gate body is
    // selected by the bootstrap error reason; the "still pending" case
    // (no reason yet) falls back to the legacy loading card.
    const retryBootstrap = () => setBootstrapRetryNonce((n) => n + 1);

    // 로그인 화면은 헤더 없이 풀스크린
    if (bootstrapErrorReason === "auth_required") {
      return (
        <main className="app-shell app-shell-login">
          <BootstrapGate
            reason={bootstrapErrorReason}
            errorMessage={errorMessage}
            runnerBaseUrl={runnerBaseUrl}
            backendClient={backendClient}
            onRetry={retryBootstrap}
          />
        </main>
      );
    }

    return (
      <main className="app-shell" data-bootstrap-state={bootstrapErrorReason ?? "pending"}>
        <header className="app-header" aria-label="Main navigation">
          <div className="app-header-left">
            <div className="app-brand" aria-hidden="true">
              <img src="/jasojeon.png" alt="자소전" className="app-brand-mark" />
              <span className="app-brand-name">자소전</span>
            </div>

            {renderTabNav()}
          </div>

          <div className="app-header-actions" aria-label="Header actions">
            <button className="app-icon-button" type="button" aria-label="Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <UserMenu backendClient={backendClient} projects={[]} />
          </div>
        </header>

        <div className="app-stage app-stage-loading">
          <BootstrapGate
            reason={bootstrapErrorReason}
            errorMessage={errorMessage}
            runnerBaseUrl={runnerBaseUrl}
            backendClient={backendClient}
            onRetry={retryBootstrap}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell" data-selected-tab={selectedTab}>
      <header className="app-header" aria-label="Main navigation">
        <div className="app-header-left">
          <div className="app-brand" aria-hidden="true">
            <img src="/jasojeon.png" alt="자소전" className="app-brand-mark" />
            <span className="app-brand-name">자소전</span>
          </div>

          {renderTabNav()}
        </div>

        <div className="app-header-actions" aria-label="Header actions">
          <button
            className={`app-icon-button ${selectedTab === "settings" ? "is-active" : ""}`}
            type="button"
            aria-label="Settings"
            aria-pressed={selectedTab === "settings"}
            onClick={() => setSelectedTab((current) => current === "settings" ? "overview" : "settings")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <UserMenu
            backendClient={backendClient}
            projects={state?.projects ?? []}
            onNavigateToProject={(slug) => {
              setSelectedProjectSlug(slug);
              setSelectedTab("projects");
            }}
          />
        </div>
      </header>

      {(actionNotice || errorMessage) ? (
        <div className="app-notice-stack" aria-live="polite">
          {actionNotice ? (
            <div className={`app-notice app-notice-${actionNotice.tone}${actionNotice.isLeaving ? " is-leaving" : ""}`}>
              <div className="app-notice-row">
                {actionNotice.tone === "pending" ? <span className="activity-indicator" aria-hidden="true" /> : <span className={`app-notice-badge app-notice-badge-${actionNotice.tone}`} aria-hidden="true" />}
                <div className="app-notice-copy">
                  <strong>{actionNotice.message}</strong>
                  {actionNotice.detail ? <p>{actionNotice.detail}</p> : null}
                </div>
              </div>
            </div>
          ) : null}
          {errorMessage ? <div className="app-error-banner">{errorMessage}</div> : null}
        </div>
      ) : null}

      <div className="app-stage">
        <section className="app-view">
          {selectedTab === "overview" ? (
            <OverviewPage />
          ) : null}

          {selectedTab === "settings" ? (
            <SettingsPage
              state={state}
              selectedSection={selectedSettingsSection}
              storageRoot={storageRoot}
              runnerBaseUrlDraft={runnerBaseUrlDraft}
              lastUpdatedAt={lastUpdatedAt}
              pendingOpenDartAction={pendingOpenDartAction}
              client={client}
              onSelectSection={setSelectedSettingsSection}
              onProfileDocumentsChanged={() => {
                void refreshProviderState();
              }}
              onRunnerBaseUrlDraftChange={setRunnerBaseUrlDraft}
              onApplyRunnerBaseUrl={() => setRunnerBaseUrl(runnerBaseUrlDraft)}
              onSaveAgentDefaults={async (agentDefaults) => {
                await runAction({
                  pending: { tone: "pending", message: "에이전트 배정을 저장중입니다..." },
                  success: { tone: "success", message: "에이전트 배정을 저장했습니다." },
                  failure: (error) => ({ tone: "error", message: "에이전트 배정 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.saveAgentDefaults(agentDefaults).then(() => undefined));
              }}
              onSaveOpenDartApiKey={async (apiKey) => {
                setPendingOpenDartAction("save");
                try {
                  await runAction({
                    pending: { tone: "pending", message: "OpenDART API 키를 저장중입니다..." },
                    success: { tone: "success", message: "OpenDART API 키가 저장되었습니다." },
                    failure: (error) => ({ tone: "error", message: "OpenDART API 키 저장에 실패했습니다.", detail: getErrorMessage(error) })
                  }, () => client.saveOpenDartApiKey(apiKey));
                } finally {
                  setPendingOpenDartAction(undefined);
                }
              }}
              onDeleteOpenDartApiKey={async () => {
                setPendingOpenDartAction("delete");
                try {
                  await runAction({
                    pending: { tone: "pending", message: "OpenDART API 키를 삭제중입니다..." },
                    success: { tone: "success", message: "OpenDART API 키가 삭제되었습니다." },
                    failure: (error) => ({ tone: "error", message: "OpenDART API 키 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                  }, () => client.deleteOpenDartApiKey());
                } finally {
                  setPendingOpenDartAction(undefined);
                }
              }}
              onTestOpenDartConnection={async () => {
                setPendingOpenDartAction("test");
                try {
                  await runAction({
                    pending: { tone: "pending", message: "OpenDART 연결을 확인중입니다..." },
                    success: (result) => result.ok
                      ? { tone: "success", message: "OpenDART 연결이 확인되었습니다.", detail: result.message }
                      : { tone: "error", message: "OpenDART 연결에 실패했습니다.", detail: result.message },
                    failure: (error) => ({ tone: "error", message: "OpenDART 연결 확인에 실패했습니다.", detail: getErrorMessage(error) })
                  }, () => client.testOpenDartConnection());
                } finally {
                  setPendingOpenDartAction(undefined);
                }
              }}
            />
          ) : null}

          {selectedTab === "providers" ? (
            <ProvidersPage
              providers={state.providers}
              agentDefaults={state.agentDefaults}
              pendingProviderAction={pendingProviderAction}
              onEditAgentDefaults={() => {
                setSelectedSettingsSection("agent-effort");
                setSelectedTab("settings");
              }}
              onSaveConfig={async (providerId, payload) => {
                await runAction({
                  pending: { tone: "pending", message: "프로바이더 설정을 저장중입니다..." },
                  success: { tone: "success", message: "프로바이더 설정이 저장되었습니다." },
                  failure: (error) => ({ tone: "error", message: "프로바이더 설정 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.updateProviderConfig(providerId, payload));
              }}
              onSaveApiKey={async (providerId, apiKey) => {
                await runAction({
                  pending: { tone: "pending", message: "API 키를 저장중입니다..." },
                  success: { tone: "success", message: "API 키가 저장되었습니다." },
                  failure: (error) => ({ tone: "error", message: "API 키 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.saveProviderApiKey(providerId, apiKey));
              }}
              onClearApiKey={async (providerId) => {
                await runAction({
                  pending: { tone: "pending", message: "API 키를 삭제중입니다..." },
                  success: { tone: "success", message: "API 키가 삭제되었습니다." },
                  failure: (error) => ({ tone: "error", message: "API 키 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.clearProviderApiKey(providerId).then(() => undefined));
              }}
              onSaveNotionToken={async (providerId, token) => {
                await runAction({
                  pending: { tone: "pending", message: "Notion Integration Token을 저장중입니다..." },
                  success: { tone: "success", message: "Notion Integration Token이 저장되었습니다." },
                  failure: (error) => ({ tone: "error", message: "Notion Integration Token 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, async () => {
                  await client.connectNotion(providerId, token);
                  await refreshProviderState();
                });
              }}
              onDeleteNotionToken={async (providerId) => {
                await runAction({
                  pending: { tone: "pending", message: "Notion Integration Token을 삭제중입니다..." },
                  success: { tone: "success", message: "Notion Integration Token이 삭제되었습니다." },
                  failure: (error) => ({ tone: "error", message: "Notion Integration Token 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                }, async () => {
                  await client.disconnectNotion(providerId);
                  await refreshProviderState();
                });
              }}
              onTest={async (providerId) => {
                const testResult = await runProviderAction(providerId, "test", {
                  pending: { tone: "pending", message: "연결 중..." },
                  success: (result) => {
                    if (result?.installed && result.authStatus !== "healthy" && result.authMode === "cli") {
                      return { tone: "pending", message: "CLI 인증이 필요합니다. 진행 중..." };
                    }
                    return buildProviderTestNotice(result);
                  },
                  failure: (error) => ({ tone: "error", message: "연결에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.testProvider(providerId));

                // testProvider가 상태를 변경했을 수 있으므로 UI 갱신
                await refreshProviderState();

                // 설치는 됐지만 인증 안 된 경우 → 자동 인증
                if (testResult?.installed && testResult.authStatus !== "healthy" && testResult.authMode === "cli") {
                  try {
                    const authResult = await client.startProviderCliAuth(providerId);
                    // 폴링 함수: 인증 완료될 때까지 5초 간격으로 상태 확인 (최대 2분)
                    const pollAuth = async () => {
                      for (let i = 0; i < 24; i++) {
                        await new Promise((r) => setTimeout(r, 5000));
                        const recheck = await client.testProvider(providerId);
                        if (recheck.authStatus === "healthy") {
                          await refreshProviderState();
                          showActionNotice({ tone: "success", message: `${providerId} 인증이 완료되었습니다.` });
                          return;
                        }
                      }
                      showActionNotice({ tone: "error", message: "인증 대기 시간이 초과되었습니다. 테스트 버튼을 눌러 다시 확인해주세요." }, 3600);
                    };

                    if (authResult.success && authResult.authUrl) {
                      // Claude: 브라우저에서 인증 진행 → 완료 후 자동 상태 재확인
                      window.open(authResult.authUrl, "_blank");
                      showActionNotice({ tone: "pending", message: "브라우저에서 인증을 완료해주세요..." });
                      pollAuth();
                    } else if (authResult.success) {
                      // Codex: CLI가 자동 콜백으로 즉시 완료
                      await refreshProviderState();
                      showActionNotice({ tone: "success", message: `${providerId} 인증이 완료되었습니다.` });
                    } else {
                      // Gemini 등: CLI가 브라우저를 열었지만 아직 완료 안 됨 → 폴링 시작
                      showActionNotice({ tone: "pending", message: authResult.message ?? "브라우저에서 인증을 완료해주세요..." });
                      pollAuth();
                    }
                  } catch (error) {
                    showActionNotice({ tone: "error", message: "인증 시작에 실패했습니다.", detail: getErrorMessage(error) }, 3600);
                  }
                }
              }}
              onLogout={async (providerId) => {
                await runProviderAction(providerId, "logout", {
                  pending: { tone: "pending", message: "연결을 해제하는 중입니다..." },
                  success: (result) => result?.ok
                    ? { tone: "success", message: "연결이 해제되었습니다." }
                    : { tone: "error", message: result?.message ?? "연결 해제에 실패했습니다." },
                  failure: (error) => ({ tone: "error", message: "연결 해제에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.logoutProvider(providerId));
                await refreshProviderState();
              }}
              onCheckNotion={async (providerId) => {
                await runProviderAction(providerId, "notion-check", {
                  pending: { tone: "pending", message: "Notion MCP 상태를 확인중입니다..." },
                  success: (result) => buildNotionCheckNotice(result),
                  failure: (error) => ({ tone: "error", message: "Notion MCP 상태 확인에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.checkNotion(providerId));
                await refreshProviderState();
              }}
              onConnectNotion={async (providerId) => {
                await runProviderAction(providerId, "notion-connect", {
                  pending: { tone: "pending", message: providerId === "claude" ? "Notion MCP를 연결하는 중..." : "브라우저에서 Notion 인증을 완료해주세요..." },
                  success: (result) => buildNotionConnectNotice(result),
                  failure: (error) => ({ tone: "error", message: "Notion MCP 연결에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.connectNotion(providerId));
                await refreshProviderState();
              }}
              onDisconnectNotion={async (providerId) => {
                await runProviderAction(providerId, "notion-disconnect", {
                  pending: { tone: "pending", message: "Notion MCP를 해제중입니다..." },
                  success: (result) => buildNotionDisconnectNotice(result),
                  failure: (error) => ({ tone: "error", message: "Notion MCP 해제에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.disconnectNotion(providerId));
                await refreshProviderState();
              }}
            />
          ) : null}

          {selectedTab === "projects" ? (
            <ProjectsPage
              projects={state.projects}
              selectedProjectSlug={selectedProject?.record.slug}
              onSelectProject={setSelectedProjectSlug}
              onAnalyzePosting={async (payload) => client.analyzeProjectPosting(payload)}
              onFetchProjectInsights={async (projectSlug) => client.getProjectInsights(projectSlug)}
              onCreateProject={async (payload) => {
                return runAction<ProjectRecord>({
                  pending: { tone: "pending", message: "새 지원서를 만드는 중입니다..." },
                  success: { tone: "success", message: "새 지원서를 만들었습니다." },
                  failure: (error) => ({ tone: "error", message: "지원서 생성에 실패했습니다.", detail: getErrorMessage(error) })
                }, async () => {
                  const project = await client.createProject(payload);
                  await refreshProviderState();
                  return project;
                });
              }}
              onSaveProjectDocument={async (projectSlug, payload) => {
                showActionNotice({ tone: "pending", message: "지원서 문서를 저장중입니다..." });
                try {
                  await client.saveProjectDocument(projectSlug, payload);
                  showActionNotice({ tone: "success", message: "지원서 문서를 저장했습니다." });
                } catch (error) {
                  showActionNotice({
                    tone: "error",
                    message: "지원서 문서 저장에 실패했습니다.",
                    detail: getErrorMessage(error)
                  }, 3600);
                  throw error;
                }
              }}
              onUploadProjectDocuments={async (projectSlug, files) => {
                showActionNotice({ tone: "pending", message: "지원서 파일을 업로드중입니다..." });
                try {
                  await client.uploadProjectDocuments(projectSlug, files);
                  showActionNotice({ tone: "success", message: "지원서 문서를 업로드했습니다." });
                } catch (error) {
                  showActionNotice({
                    tone: "error",
                    message: "지원서 문서 업로드에 실패했습니다.",
                    detail: getErrorMessage(error)
                  }, 3600);
                  throw error;
                }
              }}
              onDeleteProjectDocument={async (projectSlug, documentId) => {
                await runAction({
                  pending: { tone: "pending", message: "문서를 삭제하는 중입니다..." },
                  success: { tone: "success", message: "문서를 삭제했습니다." },
                  failure: (error) => ({ tone: "error", message: "문서 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.deleteProjectDocument(projectSlug, documentId));
              }}
              onUpdateProject={async (projectSlug, payload) => {
                await runAction({
                  pending: { tone: "pending", message: "지원서 정보를 저장하는 중입니다..." },
                  success: { tone: "success", message: "지원서 정보를 저장했습니다." },
                  failure: (error) => ({ tone: "error", message: "지원서 정보 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.updateProject(projectSlug, payload));
              }}
              onAnalyzeInsights={async (projectSlug, payload) => {
                await runAction({
                  pending: { tone: "pending", message: "공고 분석을 요청중입니다..." },
                  success: { tone: "success", message: "공고 분석을 완료했습니다." },
                  failure: (error) => ({ tone: "error", message: "공고 분석 요청에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.analyzeInsights(projectSlug, payload).then(() => undefined));
              }}
              onGenerateInsights={async (projectSlug, payload) => {
                return runAction<ProjectInsightWorkspaceState>({
                  pending: { tone: "pending", message: "인사이트 생성을 요청중입니다..." },
                  success: { tone: "success", message: "인사이트 생성을 요청했습니다." },
                  failure: (error) => ({ tone: "error", message: "인사이트 생성 요청에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.generateInsights(projectSlug, payload));
              }}
              onDeleteProject={async (projectSlug) => {
                await runAction({
                  pending: { tone: "pending", message: "프로젝트를 삭제하는 중입니다..." },
                  success: { tone: "success", message: "프로젝트를 삭제했습니다." },
                  failure: (error) => ({ tone: "error", message: "프로젝트 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                }, async () => {
                  await client.deleteProject(projectSlug);
                  if (selectedProject?.record.slug === projectSlug) {
                    setSelectedProjectSlug(undefined);
                  }
                });
              }}
            />
          ) : null}

          {selectedTab === "runs" ? (
            <RunsPage
              state={state}
              projects={state.projects}
              selectedProjectSlug={selectedProject?.record.slug}
              selectedRunId={selectedRunId}
              onSelectProject={setSelectedProjectSlug}
              onSelectRun={setSelectedRunId}
              onClearRunSelection={() => setSelectedRunId(undefined)}
              onDeleteRun={async (projectSlug, runId) => {
                await runAction({
                  pending: { tone: "pending", message: "실행 기록을 삭제하는 중..." },
                  success: { tone: "success", message: "실행 기록이 삭제되었습니다." },
                  failure: (error) => ({ tone: "error", message: "실행 삭제에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.deleteRun(projectSlug, runId).then(() => {
                  if (selectedRunId === runId) {
                    setSelectedRunId(undefined);
                  }
                }));
              }}
              onStartRun={async (projectSlug, payload) => {
                const result = await runAction({
                  pending: { tone: "pending", message: "새 실행을 시작중입니다..." },
                  success: { tone: "success", message: "새 실행을 시작했습니다." },
                  failure: (error) => ({ tone: "error", message: "실행 시작에 실패했습니다.", detail: getErrorMessage(error) })
                }, async () => {
                  const startResult = await client.startRun(projectSlug, payload);
                  setSelectedRunId(startResult.runId);
                  await refreshProviderState();
                  return startResult;
                });
                return result?.runId;
              }}
              onSubmitIntervention={async (runId, message) => {
                await runAction({
                  pending: { tone: "pending", message: "개입 메시지를 전달중입니다..." },
                  success: { tone: "success", message: "개입 메시지를 전달했습니다." },
                  failure: (error) => ({ tone: "error", message: "개입 메시지 전달에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.submitIntervention(runId, message).then((result) => {
                  if (result.nextRunId) {
                    setSelectedRunId(result.nextRunId);
                  }
                }));
              }}
              onAbortRun={async (runId) => {
                const result = await runAction({
                  pending: { tone: "pending", message: "실행 중단을 요청중입니다..." },
                  success: { tone: "success", message: "실행 중단을 요청했습니다." },
                  failure: (error) => ({ tone: "error", message: "실행 중단 요청에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.abortRun(runId).then(() => true));
                return result === true;
              }}
              onCompleteRun={async (projectSlug, runId) => {
                await runAction({
                  pending: { tone: "pending", message: "문항 완료 처리를 진행중입니다..." },
                  success: { tone: "success", message: "문항을 고정했습니다." },
                  failure: (error) => ({ tone: "error", message: "문항 완료 처리에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.completeRun(projectSlug, runId).then(() => undefined));
              }}
              onResumeRun={async (projectSlug, runId) => {
                await runAction({
                  pending: { tone: "pending", message: "문항 재개를 진행중입니다..." },
                  success: { tone: "success", message: "문항을 다시 재개했습니다." },
                  failure: (error) => ({ tone: "error", message: "문항 재개에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.resumeRun(projectSlug, runId).then((result) => {
                  setSelectedRunId(result.runId);
                }));
              }}
              onSaveDraft={async (projectSlug, questionIndex, draft) => {
                await runAction({
                  pending: { tone: "pending", message: "초안을 저장하는 중입니다..." },
                  success: { tone: "success", message: "초안이 저장되었습니다." },
                  failure: (error) => ({ tone: "error", message: "초안 저장에 실패했습니다.", detail: getErrorMessage(error) })
                }, () => client.saveEssayDraft(projectSlug, questionIndex, draft).then(() => undefined));
              }}
              onCreateRunSocket={(runId) => client.createRunSocket(runId)}
              onGetRunMessages={(projectSlug, runId) => client.getRunMessages(projectSlug, runId)}
              onAwaitingUserInput={showAwaitingUserInputNotice}
            />
          ) : null}

        </section>
      </div>

      {authModal && (
        <AuthCodeModal
          providerId={authModal.providerId}
          authUrl={authModal.authUrl}
          onSubmit={async (code) => {
            try {
              const result = await client.submitProviderCliCode(authModal.providerId, code);
              if (result.success) {
                showActionNotice({ tone: "success", message: "인증이 완료되었습니다." });
                await refreshProviderState();
              } else {
                showActionNotice({ tone: "error", message: result.message ?? "인증에 실패했습니다." }, 3600);
              }
            } catch (error) {
              showActionNotice({ tone: "error", message: "코드 제출에 실패했습니다.", detail: getErrorMessage(error) }, 3600);
            }
            setAuthModal(null);
          }}
          onCancel={() => setAuthModal(null)}
        />
      )}

      <footer className="app-footer">
        <div className="app-footer-metrics">
          <FooterMetric
            label={`${state.providers.length}개 프로바이더`}
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            )}
          />
          <FooterMetric
            label={`${state.projects.length}개 지원서`}
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )}
          />
          <FooterMetric
            label={`${state.profileDocuments.length}개 프로필 문서`}
            accent
            icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            )}
          />
        </div>
        <div className="app-footer-spacer" />
        <div className="app-footer-status">
          <span className="app-footer-status-dot" aria-hidden="true">
            <span className="app-footer-status-dot-pulse" />
            <span className="app-footer-status-dot-core" />
          </span>
          <span>LOCAL ENGINE ONLINE</span>
        </div>
      </footer>
    </main>
  );
}

function FooterMetric({
  label,
  icon,
  accent = false
}: {
  label: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`app-footer-item ${accent ? "is-accent" : ""}`}>
      <span className="app-footer-icon">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function buildProviderTestNotice(state: ProviderRuntimeState): ActionNotice {
  if (state.authStatus === "healthy") {
    return { tone: "success", message: "CLI 연결이 확인되었습니다." };
  }
  if (!state.installed) {
    return { tone: "error", message: "CLI가 설치되어 있지 않습니다." };
  }
  if (state.authMode === "cli") {
    return { tone: "warning", message: "CLI 인증이 필요합니다." };
  }
  return { tone: "error", message: "연결 설정을 확인해 주세요." };
}

function buildNotionCheckNotice(state: ProviderRuntimeState): ActionNotice {
  if (state.notionMcpConnected) {
    return { tone: "success", message: "Notion MCP가 연결되어 있습니다.", detail: state.notionMcpMessage };
  }
  if (state.notionMcpConfigured) {
    return { tone: "warning", message: "Notion MCP가 구성되어 있지만 인증이 필요합니다.", detail: state.notionMcpMessage };
  }
  return { tone: "error", message: "Notion MCP가 연결되어 있지 않습니다.", detail: state.notionMcpMessage };
}

function buildNotionConnectNotice(state: ProviderRuntimeState): ActionNotice {
  if (state.notionMcpConnected) {
    return { tone: "success", message: "Notion MCP가 연결되었습니다.", detail: state.notionMcpMessage };
  }
  if (state.notionMcpConfigured) {
    return { tone: "warning", message: "Notion MCP 설정이 추가됐습니다. 인증은 해당 CLI를 직접 실행해 진행해 주세요.", detail: state.notionMcpMessage };
  }
  return { tone: "error", message: "Notion MCP 연결에 실패했습니다.", detail: state.notionMcpMessage };
}

function buildNotionDisconnectNotice(state: ProviderRuntimeState): ActionNotice {
  if (!state.notionMcpConfigured) {
    return { tone: "success", message: "Notion MCP가 해제되었습니다.", detail: state.notionMcpMessage };
  }
  return { tone: "error", message: "Notion MCP 해제를 확인하지 못했습니다.", detail: state.notionMcpMessage };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeRunnerBootstrapError(runnerBaseUrl: string, error: unknown): string {
  const message = getErrorMessage(error);
  if (message.includes("approved local 자소전 UI")) {
    return `선택한 러너 주소 ${runnerBaseUrl} 은(는) 현재 UI origin ${window.location.origin} 에서 허용되지 않았습니다. 공식 dev web origin 또는 runner 자체 origin에서 다시 시도해 주세요.`;
  }

  if (isCrossOriginRunnerBaseUrl(runnerBaseUrl) && error instanceof TypeError) {
    return `선택한 러너 주소 ${runnerBaseUrl} 이(가) runner trusted-origin allowlist에 없거나 브라우저에서 차단되었습니다. 현재 UI origin ${window.location.origin} 과 공식 로컬 포트를 확인해 주세요.`;
  }

  return message;
}

function isCrossOriginRunnerBaseUrl(runnerBaseUrl: string): boolean {
  try {
    return new URL(runnerBaseUrl).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function AuthCodeModal({
  providerId,
  authUrl,
  onSubmit,
  onCancel
}: {
  providerId: string;
  authUrl: string;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="auth-modal-overlay" onClick={onCancel}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <h3>인증 코드 입력</h3>
        <p>브라우저에서 {providerId} 인증을 완료한 뒤, 표시된 코드를 아래에 붙여넣으세요.</p>
        <input
          type="text"
          className="auth-modal-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="인증 코드를 입력하세요"
          autoFocus
          disabled={submitting}
        />
        <div className="auth-modal-actions">
          <button
            className="auth-modal-submit"
            onClick={async () => {
              if (!code.trim()) return;
              setSubmitting(true);
              await onSubmit(code.trim());
            }}
            disabled={!code.trim() || submitting}
          >
            {submitting ? "확인 중..." : "확인"}
          </button>
          <button
            className="auth-modal-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
