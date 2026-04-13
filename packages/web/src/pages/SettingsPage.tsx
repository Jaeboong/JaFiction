import type { SidebarState } from "@jasojeon/shared";
import { useEffect, useRef } from "react";
import { AgentEffortSection } from "../components/AgentEffortSection";
import { ProfileDocumentsPanel } from "../components/profile/ProfileDocumentsPanel";
import type { RunnerClient } from "../api/client";
import { authStatusLabel, statusToneForAuthStatus } from "../formatters";
import "../styles/overview.css";

export type SettingsSection = "dashboard" | "rubric" | "storage" | "agent-effort" | "opendart";

interface SettingsPageProps {
  state: SidebarState;
  selectedSection: SettingsSection;
  storageRoot: string;
  runnerBaseUrlDraft: string;
  lastUpdatedAt?: number;
  client: RunnerClient;
  onSelectSection(value: SettingsSection): void;
  onRunnerBaseUrlDraftChange(value: string): void;
  onApplyRunnerBaseUrl(): void;
  onSaveAgentDefaults(agentDefaults: SidebarState["agentDefaults"]): Promise<void>;
  onProfileDocumentsChanged(): void;
}

const rubricCards = [
  { index: "01", title: "경력 적합성", description: "지원 직무와의 경력 매칭도 및 역량 일치 여부" },
  { index: "02", title: "기술 스택 부합도", description: "요구 기술과 보유 기술의 정확한 매핑 평가" },
  { index: "03", title: "성과 명확성", description: "구체적 수치와 결과로 표현된 업적 기술" },
  { index: "04", title: "문서 구조화", description: "정보 계층과 가독성, 논리적 흐름 평가" },
  { index: "05", title: "문법 및 어조", description: "문법 정확성과 전문적이면서도 친근한 어조" },
  { index: "06", title: "핵심 역량 강조", description: "회사 핵심 가치와 직무 필수 역량의 노출 정도" }
] as const;

export function SettingsPage({
  state,
  selectedSection,
  storageRoot,
  runnerBaseUrlDraft,
  lastUpdatedAt,
  client,
  onRunnerBaseUrlDraftChange,
  onApplyRunnerBaseUrl,
  onSaveAgentDefaults,
  onProfileDocumentsChanged
}: SettingsPageProps) {
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
  const openDartLabel = state.openDartConfigured ? authStatusLabel(state.openDartConnectionStatus) : "미연결";
  const openDartTone = state.openDartConfigured ? statusToneForAuthStatus(state.openDartConnectionStatus) : "neutral";

  const mainRef = useRef<HTMLElement | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const rubricRef = useRef<HTMLElement | null>(null);
  const rolesRef = useRef<HTMLElement | null>(null);
  const opendartRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!mainRef.current) return;

    const sectionMap: Record<SettingsSection, HTMLElement | null> = {
      dashboard: topRef.current,
      storage: topRef.current,
      rubric: rubricRef.current,
      "agent-effort": rolesRef.current,
      opendart: opendartRef.current
    };

    if (selectedSection === "dashboard" || selectedSection === "storage") {
      mainRef.current.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const target = sectionMap[selectedSection];
    if (!target) return;

    mainRef.current.scrollTo({ top: target.offsetTop - 24, behavior: "auto" });
  }, [selectedSection]);

  return (
    <section
      className="overview-page"
      data-last-updated-at={lastUpdatedAt ?? ""}
      data-storage-root={storageRoot}
    >
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
              <article className="overview-stat-card">
                <div className="overview-stat-label">OpenDart</div>
                <div className="overview-stat-status">
                  <span className={`overview-stat-status-dot tone-${openDartTone}`} aria-hidden="true" />
                  <span className="overview-stat-status-value overview-stat-status-value--muted">{openDartLabel}</span>
                </div>
              </article>
            </div>
          </section>

          {/* 프로필 문서 */}
          <ProfileDocumentsPanel
            client={client}
            documents={state.profileDocuments}
            onDocumentsChanged={onProfileDocumentsChanged}
          />

          {/* OpenDart 연동 */}
          <section ref={opendartRef} className="settings-opendart-panel" aria-label="OpenDart 연동">
            <div className="overview-section-header overview-section-header--with-action">
              <h2 className="overview-section-title">OpenDart 연동</h2>
              <span className={`settings-status-chip tone-${openDartTone}`}>{openDartLabel}</span>
            </div>
            <div className="settings-opendart-body">
              <p className="settings-opendart-desc">
                금융감독원 전자공시시스템(OpenDART) API 키는 서버에서 관리됩니다. 별도 설정이 필요하지 않습니다.
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
    </section>
  );
}

