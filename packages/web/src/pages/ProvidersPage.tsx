import type { AgentDefaults, ProviderId, ProviderRuntimeState } from "@jasojeon/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CustomSelect } from "../components/CustomSelect";
import { AgentDefaultsSummary } from "../components/AgentDefaultsSummary";
import { providerName, statusToneForAuthStatus } from "../formatters";
import "../styles/providers.css";

type ProviderActionKind = "test" | "notion-check" | "notion-connect" | "notion-disconnect";

interface ProvidersPageProps {
  providers: ProviderRuntimeState[];
  agentDefaults: AgentDefaults;
  pendingProviderAction?: { providerId: ProviderId; kind: ProviderActionKind };
  onEditAgentDefaults(): void;
  onSaveConfig(providerId: ProviderId, payload: Record<string, unknown>): Promise<void>;
  onSaveApiKey(providerId: ProviderId, apiKey: string): Promise<void>;
  onClearApiKey(providerId: ProviderId): Promise<void>;
  onSaveNotionToken(providerId: ProviderId, token: string): Promise<void>;
  onDeleteNotionToken(providerId: ProviderId): Promise<void>;
  onTest(providerId: ProviderId): Promise<void>;
  onCheckNotion(providerId: ProviderId): Promise<void>;
  onConnectNotion(providerId: ProviderId): Promise<void>;
  onDisconnectNotion(providerId: ProviderId): Promise<void>;
}

interface SidebarIndicatorStyle {
  top: number;
  height: number;
}

export function ProvidersPage(props: ProvidersPageProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | undefined>(props.providers[0]?.providerId);
  const sidebarListRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<SidebarIndicatorStyle>({ top: 0, height: 0 });

  useEffect(() => {
    if (!props.providers.length) {
      setSelectedProviderId(undefined);
      return;
    }

    setSelectedProviderId((current) => (
      current && props.providers.some((provider) => provider.providerId === current)
        ? current
        : props.providers[0]?.providerId
    ));
  }, [props.providers]);

  useLayoutEffect(() => {
    const listEl = sidebarListRef.current;
    const activeEl = activeItemRef.current;

    if (!listEl || !activeEl) {
      setIndicatorStyle((current) => current.height === 0 && current.top === 0 ? current : { top: 0, height: 0 });
      return;
    }

    const listRect = listEl.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const next = {
      top: activeRect.top - listRect.top + listEl.scrollTop,
      height: activeRect.height
    };

    setIndicatorStyle((current) => (
      current.top === next.top && current.height === next.height ? current : next
    ));
  }, [selectedProviderId, props.providers]);

  const selectedProvider = props.providers.find((provider) => provider.providerId === selectedProviderId) ?? props.providers[0];

  if (!selectedProvider) {
    return (
      <section className="providers-page">
        <div className="providers-empty-state">
          <h2>프로바이더가 없습니다.</h2>
          <p>러너에서 프로바이더 구성을 먼저 확인해 주세요.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="providers-page">
      <aside className="providers-sidebar">
        <div className="providers-sidebar-header">
          <span className="providers-sidebar-title">Providers</span>
          <button
            className="providers-sidebar-add-button"
            onClick={props.onEditAgentDefaults}
            aria-label="에이전트 에포트 편집"
            title="에이전트 에포트 편집"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <div className="providers-sidebar-list" ref={sidebarListRef}>
          <div
            className="providers-sidebar-indicator"
            aria-hidden="true"
            style={{
              height: `${indicatorStyle.height}px`,
              transform: `translateY(${indicatorStyle.top}px)`
            }}
          />
          {props.providers.map((provider) => (
            <button
              key={provider.providerId}
              ref={provider.providerId === selectedProvider.providerId ? activeItemRef : undefined}
              className={`providers-sidebar-item ${provider.providerId === selectedProvider.providerId ? "is-active" : ""}`}
              onClick={() => setSelectedProviderId(provider.providerId)}
            >
              <span
                className={`providers-sidebar-dot tone-${statusToneForAuthStatus(provider.authStatus)}`}
                aria-hidden="true"
              />
              <span className="providers-sidebar-name">{providerName(provider.providerId)}</span>
            </button>
          ))}
        </div>
      </aside>

      <ProviderDetail provider={selectedProvider} {...props} />
    </section>
  );
}

function ProviderDetail(props: ProvidersPageProps & { provider: ProviderRuntimeState }) {
  const {
    provider,
    providers,
    agentDefaults,
    pendingProviderAction,
    onSaveConfig,
    onSaveApiKey,
    onClearApiKey,
    onSaveNotionToken,
    onDeleteNotionToken,
    onTest,
    onCheckNotion,
    onConnectNotion,
    onDisconnectNotion
  } = props;
  const [command, setCommand] = useState(provider.command);
  const [authMode, setAuthMode] = useState(provider.authMode);
  const [model, setModel] = useState(provider.configuredModel ?? "");
  const [effort, setEffort] = useState(provider.configuredEffort ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [notionToken, setNotionToken] = useState("");
  const [notionTokenStatus, setNotionTokenStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");

  useEffect(() => {
    setCommand(provider.command);
    setAuthMode(provider.authMode);
    setModel(provider.configuredModel ?? "");
    setEffort(provider.configuredEffort ?? "");
    setApiKey("");
    setApiKeyVisible(false);
    setNotionToken("");
    setNotionTokenStatus("idle");
  }, [provider]);

  const notionStateLabel = provider.notionMcpConnected
    ? "연결됨"
    : provider.notionMcpConfigured
      ? "설정됨"
      : "미연결";
  const notionTone = provider.notionMcpConnected
    ? "positive"
    : provider.notionMcpConfigured
      ? "warning"
      : "neutral";
  const isTesting = pendingProviderAction?.providerId === provider.providerId && pendingProviderAction.kind === "test";
  const isCheckingNotion = pendingProviderAction?.providerId === provider.providerId && pendingProviderAction.kind === "notion-check";
  const isConnectingNotion = pendingProviderAction?.providerId === provider.providerId && pendingProviderAction.kind === "notion-connect";
  const isDisconnectingNotion = pendingProviderAction?.providerId === provider.providerId && pendingProviderAction.kind === "notion-disconnect";
  const hasPendingProviderAction = pendingProviderAction?.providerId === provider.providerId;
  const cliNotConnected = provider.authMode === "cli" && provider.authStatus !== "healthy";
  const providerLabel = providerName(provider.providerId);
  const providerAvatar = providerLabel.charAt(0).toUpperCase();
  const installationLabel = provider.installed ? provider.version ?? "Installed" : "Missing";
  const installationTone = provider.installed ? "positive" : "negative";
  const authenticationLabel = provider.authMode === "apiKey" ? "API Key" : "CLI";
  const authenticationTone = provider.authStatus === "healthy" ? "positive" : "warning";

  return (
    <main className="providers-main">
      <div className="providers-main-inner">
        <header className="providers-page-header">
          <div className="providers-page-heading">
            <div className="providers-title-row">
              <div className="providers-provider-avatar" aria-hidden="true">
                {providerAvatar}
              </div>
              <div className="providers-title-copy">
                <h1>{providerLabel} Configuration</h1>
              </div>
            </div>
          </div>

          <div className="providers-header-actions">
            <button
              className={cliNotConnected ? "providers-primary-button" : "providers-secondary-button"}
              onClick={() => onTest(provider.providerId)}
              disabled={hasPendingProviderAction}
            >
              {isTesting
                ? <ButtonBusyLabel label={cliNotConnected ? "연결 중..." : "테스트중..."} />
                : cliNotConnected ? "연결" : "테스트"}
            </button>
            <button
              className="providers-primary-button"
              onClick={async () => {
                await onSaveConfig(provider.providerId, { command, authMode, model, effort });
                if (apiKey.trim()) {
                  await onSaveApiKey(provider.providerId, apiKey);
                }
              }}
            >
              저장
            </button>
          </div>
        </header>

        <section className="providers-snapshot-panel">
          <div className="providers-snapshot-grid">
            <article className="providers-snapshot-card">
              <span className="providers-snapshot-label">Installation</span>
              <div className="providers-snapshot-value-row">
                <strong>{installationLabel}</strong>
                <span className={`providers-status-chip tone-${installationTone}`}>{provider.installed ? "Installed" : "Missing"}</span>
              </div>
              {!provider.installed && provider.lastError && (
                <div className="providers-install-guide">
                  <span className="providers-install-error">{provider.lastError}</span>
                </div>
              )}
            </article>

            <article className="providers-snapshot-card">
              <span className="providers-snapshot-label">Authentication</span>
              <div className="providers-snapshot-value-row">
                <strong>{authenticationLabel}</strong>
                <span className={`providers-status-chip tone-${authenticationTone}`}>{provider.authStatus === "healthy" ? "Valid" : "Needs attention"}</span>
              </div>
            </article>

            <article className="providers-snapshot-card">
              <span className="providers-snapshot-label">Notion MCP</span>
              <div className="providers-snapshot-value-row">
                <strong>{notionStateLabel}</strong>
                <span className={`providers-status-chip tone-${notionTone}`}>{provider.notionMcpConnected ? "연결됨" : "미연결"}</span>
              </div>
            </article>
          </div>
        </section>

        <section className="providers-config-section">
          <div className="providers-section-header">
            <h2>실행 설정</h2>
          </div>
          <div className="providers-config-surface">
            <label className="providers-field">
              <span className="providers-field-label">실행 명령어</span>
              <input value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} />
            </label>

            <div className="providers-form-grid">
              <div className="providers-field">
                <span className="providers-field-label">인증 방식</span>
                <CustomSelect<"cli" | "apiKey">
                  value={authMode}
                  options={[
                    { value: "cli", label: "CLI" },
                    { value: "apiKey", label: "API Key" },
                  ]}
                  onChange={setAuthMode}
                  ariaLabel="인증 방식"
                />
              </div>

              {provider.capabilities.modelOptions.length > 0 ? (
                <div className="providers-field">
                  <span className="providers-field-label">기본 모델</span>
                  <CustomSelect
                    value={model}
                    options={[
                      { value: "", label: "기본값 사용" },
                      ...provider.capabilities.modelOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      })),
                    ]}
                    onChange={setModel}
                    ariaLabel="기본 모델"
                  />
                </div>
              ) : (
                <label className="providers-field">
                  <span className="providers-field-label">기본 모델</span>
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="기본값 사용" />
                </label>
              )}
            </div>

            {provider.capabilities.supportsEffort ? (
              <div className="providers-field providers-field--half">
                <span className="providers-field-label">기본 Effort 수준</span>
                <CustomSelect
                  value={effort}
                  options={[
                    { value: "", label: "기본값 사용" },
                    ...provider.capabilities.effortOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    })),
                  ]}
                  onChange={setEffort}
                  ariaLabel="기본 Effort 수준"
                />
              </div>
            ) : null}

            <div className="providers-api-key-row">
              <label className="providers-field providers-api-key-field">
                <span className="providers-field-label">API Key (오버라이드)</span>
                <input
                  type={apiKeyVisible ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder=""
                />
                <span className="providers-api-key-hint">기본 환경변수 대신 사용할 특정 키가 있다면 입력하세요.</span>
              </label>
              <div className="providers-api-key-actions">
                <button
                  className="providers-secondary-button providers-icon-button"
                  type="button"
                  onClick={() => setApiKeyVisible((current) => !current)}
                  aria-label={apiKeyVisible ? "API 키 숨기기" : "API 키 표시"}
                  title={apiKeyVisible ? "API 키 숨기기" : "API 키 표시"}
                >
                  {apiKeyVisible ? <ApiKeyHideIcon /> : <ApiKeyShowIcon />}
                </button>
                <button
                  className="providers-danger-button providers-icon-button"
                  type="button"
                  onClick={() => onClearApiKey(provider.providerId)}
                  aria-label="API 키 삭제"
                  title="API 키 삭제"
                >
                  <ApiKeyClearIcon />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="providers-notion-section">
          <div className="providers-section-header providers-section-header--split">
            <h2>Notion MCP 통합</h2>
            <span className={`providers-status-chip providers-status-chip--pill tone-${notionTone}`}>
              {notionStateLabel}
            </span>
          </div>
          <div className="providers-notion-surface">
            <p className="providers-notion-copy">
              {providerDisplayName(provider.providerId)}가 Notion 데이터베이스에 접근하여 문서를 읽고 쓸 수 있도록 허용합니다.
            </p>
            <div className="providers-notion-actions">
              {provider.providerId === "claude" ? (() => {
                const displayStatus: "idle" | "saving" | "ok" | "error" =
                  notionTokenStatus !== "idle"
                    ? notionTokenStatus
                    : provider.hasNotionToken && !notionToken
                      ? "ok"
                      : "idle";
                const tokenSaved = displayStatus === "ok" && !notionToken;
                return (
                  <div className="providers-notion-token-row">
                    <div className={`providers-notion-token-field status-${displayStatus}`}>
                      <input
                        className="providers-notion-token-input"
                        type="password"
                        placeholder={tokenSaved ? "저장된 토큰 사용 중" : "secret_..."}
                        aria-label="Notion 인증 토큰"
                        value={notionToken}
                        onChange={(event) => {
                          setNotionToken(event.target.value);
                          if (notionTokenStatus !== "saving") setNotionTokenStatus("idle");
                        }}
                        onBlur={async () => {
                          if (notionTokenStatus === "saving") return;
                          const val = notionToken.trim();
                          if (!val) return;
                          if (!/^(secret_|ntn_)\S{10,}/.test(val)) {
                            setNotionTokenStatus("error");
                            return;
                          }
                          setNotionTokenStatus("saving");
                          try {
                            await onSaveNotionToken("claude", val);
                            await onCheckNotion("claude");
                            setNotionTokenStatus("ok");
                            setTimeout(() => {
                              setNotionToken("");
                              setNotionTokenStatus("idle");
                            }, 900);
                          } catch {
                            setNotionTokenStatus("error");
                          }
                        }}
                        disabled={hasPendingProviderAction || notionTokenStatus === "saving"}
                      />
                      <span className="providers-notion-token-indicator" aria-hidden="true">
                        {displayStatus === "saving" && <span className="providers-notion-token-spinner" />}
                        {displayStatus === "ok" && (
                          <svg className="providers-notion-token-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="5 12 10 17 19 7" />
                          </svg>
                        )}
                        {displayStatus === "error" && <span className="providers-notion-token-bang">!</span>}
                      </span>
                    </div>
                    {tokenSaved ? (
                      <button
                        className="providers-notion-token-clear"
                        type="button"
                        title="저장된 토큰 삭제"
                        aria-label="저장된 토큰 삭제"
                        onClick={async () => {
                          await onDeleteNotionToken("claude");
                          await onCheckNotion("claude");
                        }}
                        disabled={hasPendingProviderAction}
                      >
                        ×
                      </button>
                    ) : null}
                    <NotionTokenInfoTooltip />
                  </div>
                );
              })() : null}
              <button
                className={`providers-secondary-button providers-icon-button${isCheckingNotion ? " is-busy" : ""}`}
                type="button"
                onClick={() => onCheckNotion(provider.providerId)}
                disabled={hasPendingProviderAction}
                aria-label="연결 상태 확인"
                title="연결 상태 확인"
                aria-busy={isCheckingNotion}
              >
                <NotionRefreshIcon />
              </button>
              <button
                className={`providers-secondary-button providers-icon-button${isConnectingNotion ? " is-busy" : ""}`}
                type="button"
                onClick={() => onConnectNotion(provider.providerId)}
                disabled={hasPendingProviderAction}
                aria-label="Notion 연결하기"
                title="Notion 연결하기"
                aria-busy={isConnectingNotion}
              >
                <NotionLinkIcon />
              </button>
              <button
                className={`providers-danger-button providers-icon-button${isDisconnectingNotion ? " is-busy" : ""}`}
                type="button"
                onClick={() => onDisconnectNotion(provider.providerId)}
                disabled={hasPendingProviderAction}
                aria-label="연결 해제"
                title="연결 해제"
                aria-busy={isDisconnectingNotion}
              >
                <NotionDisconnectIcon />
              </button>
            </div>
          </div>
        </section>

        <AgentDefaultsSummary
          providers={providers}
          agentDefaults={agentDefaults}
          selectedProviderId={provider.providerId}
        />
      </div>
    </main>
  );
}

function NotionRefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.3-6.36" />
      <path d="M21 12a9 9 0 0 1-15.3 6.36" />
      <polyline points="18 2 18 6 14 6" />
      <polyline points="6 22 6 18 10 18" />
    </svg>
  );
}

function ApiKeyShowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ApiKeyHideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
      <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a20.79 20.79 0 0 1-3.03 3.8" />
      <path d="M6.61 6.61C4.62 8.12 3.34 10 2 12c0 0 3.5 7 10 7 1.77 0 3.31-.52 4.62-1.3" />
    </svg>
  );
}

function ApiKeyClearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function NotionLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.172 13.828a4 4 0 0 0 5.656 0l3-3a4 4 0 0 0-5.656-5.656l-1.5 1.5" />
      <path d="M13.828 10.172a4 4 0 0 0-5.656 0l-3 3a4 4 0 1 0 5.656 5.656l1.5-1.5" />
    </svg>
  );
}

function NotionDisconnectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function NotionTokenInfoTooltip() {
  const iconRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left });
  }

  function scheduleHide() {
    hideTimer.current = setTimeout(() => setPos(null), 100);
  }

  return (
    <span className="providers-field-info" onMouseEnter={show} onMouseLeave={scheduleHide}>
      <span ref={iconRef} className="providers-field-info-icon" aria-hidden="true">ⓘ</span>
      {pos !== null && (
        <span
          className="providers-field-info-card"
          role="tooltip"
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <strong>Notion Integration Token 발급</strong>
          <span>notion.so → 설정 → 연결 → 통합 관리 → 새 통합 만들기</span>
          <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener noreferrer">
            통합 관리 페이지 열기 →
          </a>
        </span>
      )}
    </span>
  );
}

function providerDisplayName(providerId: string): string {
  if (providerId === "claude") return "Claude Code";
  if (providerId === "gemini") return "Gemini";
  if (providerId === "codex") return "Codex";
  return providerId;
}


function ButtonBusyLabel({ label }: { label: string }) {
  return (
    <span className="button-busy-label">
      <span className="activity-indicator" aria-hidden="true" />
      {label}
    </span>
  );
}
