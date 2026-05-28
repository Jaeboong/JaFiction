import type { SidebarState, SyncNowResult } from "@jasojeon/shared";
import { useEffect, useRef, useState } from "react";
import { AgentEffortSection } from "../components/AgentEffortSection";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { formatDateTime } from "../formatters";
import "../styles/overview.css";

export type SettingsSection = "dashboard" | "server-sync" | "rubric" | "storage" | "agent-effort";

interface SettingsPageProps {
  state: SidebarState;
  selectedSection: SettingsSection;
  storageRoot: string;
  runnerBaseUrlDraft: string;
  lastUpdatedAt?: number;
  onSelectSection(value: SettingsSection): void;
  onRunnerBaseUrlDraftChange(value: string): void;
  onApplyRunnerBaseUrl(): void;
  onSaveAgentDefaults(agentDefaults: SidebarState["agentDefaults"]): Promise<void>;
  onSaveServerSyncEnabled(enabled: boolean): Promise<void>;
  onSyncNow?: () => Promise<SyncNowResult>;
  onSyncDisable?: () => Promise<void>;
}

type ServerSyncModal = "consent" | "disable" | undefined;

const rubricCards = [
  { index: "01", title: "경력 적합성", description: "지원 직무와의 경력 매칭도 및 역량 일치 여부" },
  { index: "02", title: "기술 스택 부합도", description: "요구 기술과 보유 기술의 정확한 매핑 평가" },
  { index: "03", title: "성과 명확성", description: "구체적 수치와 결과로 표현된 업적 기술" },
  { index: "04", title: "문서 구조화", description: "정보 계층과 가독성, 논리적 흐름 평가" },
  { index: "05", title: "문법 및 어조", description: "문법 정확성과 전문적이면서도 친근한 어조" },
  { index: "06", title: "핵심 역량 강조", description: "회사 핵심 가치와 직무 필수 역량의 노출 정도" }
] as const;

const settingsNavItems: ReadonlyArray<{ readonly id: SettingsSection; readonly label: string }> = [
  { id: "dashboard", label: "대시보드" },
  { id: "server-sync", label: "서버 연동" },
  { id: "rubric", label: "평가 기준" },
  { id: "agent-effort", label: "에이전트 배정" }
];

export function SettingsPage({
  state,
  selectedSection,
  storageRoot,
  runnerBaseUrlDraft,
  lastUpdatedAt,
  onSelectSection,
  onRunnerBaseUrlDraftChange,
  onApplyRunnerBaseUrl,
  onSaveAgentDefaults,
  onSaveServerSyncEnabled,
  onSyncNow,
  onSyncDisable
}: SettingsPageProps) {
  const [serverSyncModal, setServerSyncModal] = useState<ServerSyncModal>();
  const [syncPending, setSyncPending] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncNowResult | undefined>();
  const healthyProviders = state.providers.filter((p) => p.authStatus === "healthy").length;
  const executionLabel = state.runState.status === "running"
    ? "분석 진행 중"
    : state.runState.status === "aborting"
      ? "중단 중"
      : "대기 중";
  const executionTone = state.runState.status === "running"
    ? "positive"
    : state.runState.status === "aborting"
      ? "warning"
      : "neutral";
  const serverSyncEnabled = state.preferences.serverSyncEnabled;
  const serverSyncLabel = serverSyncEnabled ? "연동됨" : "미연동";
  const serverSyncTone = serverSyncEnabled ? "positive" : "neutral";
  const lastSyncedAt = syncResult?.lastSyncedAt ?? state.preferences.lastSyncedAt;
  const canSyncNow = serverSyncEnabled && Boolean(onSyncNow) && !syncPending;

  const mainRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const serverSyncRef = useRef<HTMLElement | null>(null);
  const rubricRef = useRef<HTMLElement | null>(null);
  const rolesRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mainRef.current) return;

    const sectionMap: Record<SettingsSection, HTMLElement | null> = {
      dashboard: topRef.current,
      storage: topRef.current,
      "server-sync": serverSyncRef.current,
      rubric: rubricRef.current,
      "agent-effort": rolesRef.current
    };

    if (selectedSection === "dashboard" || selectedSection === "storage") {
      mainRef.current.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const target = sectionMap[selectedSection];
    if (!target) return;

    mainRef.current.scrollTo({ top: target.offsetTop - 24, behavior: "auto" });
  }, [selectedSection]);

  const handleSyncNow = async () => {
    if (!canSyncNow || !onSyncNow) {
      return;
    }

    setSyncPending(true);
    try {
      const result = await onSyncNow();
      setSyncResult(result);
    } catch {
      return;
    } finally {
      setSyncPending(false);
    }
  };

  return (
    <section
      className="overview-page"
      data-last-updated-at={lastUpdatedAt ?? ""}
      data-storage-root={storageRoot}
    >
      <aside className="overview-sidebar" aria-label="설정 섹션">
        <div className="overview-sidebar-header">
          <span className="overview-sidebar-title">Settings</span>
        </div>
        <nav className="overview-sidebar-body">
          {settingsNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`overview-menu-item${selectedSection === item.id ? " is-active" : ""}`}
              onClick={() => onSelectSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main ref={mainRef} className="overview-main">
        <div className="overview-main-inner">

          {/* 러너 연결 */}
          <section ref={topRef} className="overview-runner-panel" aria-label="러너 연결">
            <div className="overview-runner-left">
              <div className="overview-runner-status">
                <span className="overview-runner-status-dot" aria-hidden="true">
                  <span className="overview-runner-status-dot-pulse" />
                  <span className="overview-runner-status-dot-core" />
                </span>
                <span>러너 연결</span>
              </div>
              <div className="overview-runner-form">
                <div className="overview-runner-input-shell">
                  <span className="overview-runner-input-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </span>
                  <input
                    value={runnerBaseUrlDraft}
                    onChange={(e) => onRunnerBaseUrlDraftChange(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <button className="overview-runner-button" onClick={onApplyRunnerBaseUrl}>
                  연결 확인
                </button>
              </div>
            </div>
            <span className="overview-runner-ready">정상 연결됨</span>
          </section>

          {/* 시스템 요약 */}
          <section className="overview-stats-panel" aria-label="시스템 요약">
            <div className="overview-stat-grid">
              <article className="overview-stat-card">
                <div className="overview-stat-label">프로바이더</div>
                <div className="overview-stat-value-row">
                  <strong>{state.providers.length}</strong>
                  <span className="overview-stat-note tone-positive">{healthyProviders}개 정상 연결</span>
                </div>
              </article>
              <article className="overview-stat-card">
                <div className="overview-stat-label">지원서</div>
                <div className="overview-stat-value-row">
                  <strong>{state.projects.length}</strong>
                  <span className="overview-stat-note">활성 워크스페이스</span>
                </div>
              </article>
              <article className="overview-stat-card">
                <div className="overview-stat-label">프로필 문서</div>
                <div className="overview-stat-value-row">
                  <strong>{state.profileDocuments.length}</strong>
                  <span className="overview-stat-note">개 파일</span>
                </div>
              </article>
              <article className="overview-stat-card">
                <div className="overview-stat-label">실행 상태</div>
                <div className="overview-stat-status">
                  <span className={`overview-stat-status-dot tone-${executionTone}`} aria-hidden="true" />
                  <span className="overview-stat-status-value">{executionLabel}</span>
                </div>
                <div className="overview-stat-note">
                  {state.runState.status === "running" || state.runState.status === "aborting"
                    ? "활성 세션 있음"
                    : "활성 세션 없음"}
                </div>
              </article>
            </div>
          </section>

          {/* 서버 연동 */}
          <section ref={serverSyncRef} className="settings-opendart-panel" aria-label="서버 연동">
            <div className="overview-section-header overview-section-header--with-action">
              <h2 className="overview-section-title">서버 연동</h2>
              <span className={`settings-status-chip tone-${serverSyncTone}`}>{serverSyncLabel}</span>
            </div>
            <div className="settings-opendart-body">
              <p className="settings-opendart-desc">
                서버 연동을 켜면 여러 기기에서 프로필 문서와 지원서 프로젝트 정보를 일관되게 유지할 수 있습니다.
              </p>
              <label className="settings-sync-toggle-row">
                <input
                  type="checkbox"
                  checked={serverSyncEnabled}
                  data-testid="server-sync-toggle"
                  onChange={() => setServerSyncModal(serverSyncEnabled ? "disable" : "consent")}
                />
                <span>서버 연동</span>
              </label>
              <div className="settings-opendart-actions">
                <button
                  type="button"
                  className="settings-primary-button"
                  disabled={!canSyncNow}
                  onClick={() => void handleSyncNow()}
                >
                  {syncPending ? "동기화 중..." : "지금 동기화"}
                </button>
                <button
                  type="button"
                  className="settings-secondary-button settings-secondary-button-danger"
                  disabled={!serverSyncEnabled || !onSyncDisable}
                  onClick={() => setServerSyncModal("disable")}
                >
                  연동 해제
                </button>
              </div>
              {syncResult ? (
                <p className="settings-opendart-desc">
                  {syncResult.syncedDocuments}개 문서 · {syncResult.syncedProjects}개 지원서 동기화됨
                </p>
              ) : null}
              <p className="settings-opendart-desc">
                마지막 동기화: {formatDateTime(lastSyncedAt)}
              </p>
            </div>
          </section>

          {/* 기본 평가 기준 */}
          <section ref={rubricRef} className="overview-rubric-panel">
            <div className="overview-section-header">
              <h2 className="overview-section-title">기본 평가 기준</h2>
            </div>
            <div className="overview-rubric-grid">
              {rubricCards.map((card) => (
                <article key={card.index} className="overview-rubric-card">
                  <span className="overview-rubric-index">{card.index}</span>
                  <div className="overview-rubric-copy">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* 에이전트 배정 */}
          <section ref={rolesRef}>
            <AgentEffortSection
              providers={state.providers}
              agentDefaults={state.agentDefaults}
              onSave={onSaveAgentDefaults}
            />
          </section>

        </div>
      </main>
      <ConfirmDeleteModal
        isOpen={serverSyncModal === "consent"}
        title="서버 연동 동의"
        message="프로필 문서·지원서 컨텍스트 문서의 내용과 회사명 등 프로젝트 정보가 서버에 업로드됩니다. 서버는 저장 시 암호화하지만, 병합을 위해 서버가 메모리에서 복호화할 수 있습니다(종단간 암호화 아님). 실행 기록은 업로드되지 않습니다."
        confirmLabel="동의하고 켜기"
        cancelLabel="취소"
        onCancel={() => setServerSyncModal(undefined)}
        onConfirm={async () => {
          try {
            await onSaveServerSyncEnabled(true);
            setServerSyncModal(undefined);
          } catch {
            return;
          }
        }}
      />
      <ConfirmDeleteModal
        isOpen={serverSyncModal === "disable"}
        title="서버 연동 해제"
        message="연동을 해제하면 서버에 저장된 동기화 데이터가 삭제됩니다. 계속할까요?"
        confirmLabel="연동 해제"
        cancelLabel="취소"
        onCancel={() => setServerSyncModal(undefined)}
        onConfirm={async () => {
          try {
            if (onSyncDisable) {
              await onSyncDisable();
            }
            setSyncResult(undefined);
            setServerSyncModal(undefined);
          } catch {
            return;
          }
        }}
      />
    </section>
  );
}
