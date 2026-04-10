import type { AgentDefaults, ProviderId, ProviderRuntimeState } from "@jafiction/shared";
import { useEffect, useState } from "react";
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
  onTest(providerId: ProviderId): Promise<void>;
  onCheckNotion(providerId: ProviderId): Promise<void>;
  onConnectNotion(providerId: ProviderId): Promise<void>;
  onDisconnectNotion(providerId: ProviderId): Promise<void>;
}

export function ProvidersPage(props: ProvidersPageProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | undefined>(props.providers[0]?.providerId);

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

        <div className="providers-sidebar-list">
          {props.providers.map((provider) => (
            <button
              key={provider.providerId}
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

  useEffect(() => {
    setCommand(provider.command);
    setAuthMode(provider.authMode);
    setModel(provider.configuredModel ?? "");
    setEffort(provider.configuredEffort ?? "");
    setApiKey("");
    setApiKeyVisible(false);
  }, [provider]);

  const notionStateLabel = provider.notionMcpConnected
    ? "Connected"
    : provider.notionMcpConfigured
      ? "Configured"
      : "Idle";
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
            <button className="providers-secondary-button" onClick={() => onTest(provider.providerId)} disabled={hasPendingProviderAction}>
              {isTesting ? <ButtonBusyLabel label="테스트중..." /> : "테스트"}
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
                <span className={`providers-status-chip tone-${notionTone}`}>{provider.notionMcpConnected ? "Active" : "Idle"}</span>
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
              <label className="providers-field">
                <span className="providers-field-label">인증 방식</span>
                <select value={authMode} onChange={(event) => setAuthMode(event.target.value as "cli" | "apiKey")}>
                  <option value="cli">CLI</option>
                  <option value="apiKey">API Key</option>
                </select>
              </label>

              {provider.capabilities.modelOptions.length > 0 ? (
                <label className="providers-field">
                  <span className="providers-field-label">기본 모델</span>
                  <select value={model} onChange={(event) => setModel(event.target.value)}>
                    <option value="">기본값 사용</option>
                    {provider.capabilities.modelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="providers-field">
                  <span className="providers-field-label">기본 모델</span>
                  <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="기본값 사용" />
                </label>
              )}
            </div>

            {provider.capabilities.supportsEffort ? (
              <label className="providers-field providers-field--half">
                <span className="providers-field-label">기본 Effort 수준</span>
                <select value={effort} onChange={(event) => setEffort(event.target.value)}>
                  <option value="">기본값 사용</option>
                  {provider.capabilities.effortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
                <button className="providers-secondary-button" onClick={() => setApiKeyVisible((current) => !current)}>
                  {apiKeyVisible ? "Hide" : "Show"}
                </button>
                <button className="providers-secondary-button" onClick={() => onClearApiKey(provider.providerId)}>
                  Clear
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
              Codex가 Notion 데이터베이스에 접근하여 문서를 읽고 쓸 수 있도록 허용합니다.
            </p>
            <div className="providers-notion-actions">
              <button className="providers-secondary-button" onClick={() => onCheckNotion(provider.providerId)} disabled={hasPendingProviderAction}>
                {isCheckingNotion ? <ButtonBusyLabel label="권한 갱신중..." /> : "권한 갱신"}
              </button>
              <button className="providers-secondary-button" onClick={() => onConnectNotion(provider.providerId)} disabled={hasPendingProviderAction}>
                {isConnectingNotion ? <ButtonBusyLabel label="설정중..." /> : "설정 열기"}
              </button>
              <button className="providers-danger-button" onClick={() => onDisconnectNotion(provider.providerId)} disabled={hasPendingProviderAction}>
                {isDisconnectingNotion ? <ButtonBusyLabel label="해제중..." /> : "연결 해제"}
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

function ButtonBusyLabel({ label }: { label: string }) {
  return (
    <span className="button-busy-label">
      <span className="activity-indicator" aria-hidden="true" />
      {label}
    </span>
  );
}
