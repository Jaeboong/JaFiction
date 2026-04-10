import "../styles/overview.css";

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    title: "이력서 자동 분석",
    description: "경력 적합성, 기술 스택 부합도, 성과 명확성 등 6개 기준으로 이력서를 자동 평가합니다."
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    title: "멀티 AI 프로바이더",
    description: "Claude, GPT 등 다양한 AI 프로바이더를 연결하고 역할별로 에이전트를 배정합니다."
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "프로젝트 기반 관리",
    description: "지원하는 회사마다 프로젝트를 만들어 공고, 이력서, 분석 결과를 한 곳에서 관리합니다."
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: "OpenDart 기업 데이터",
    description: "금융감독원 OpenDART API로 지원 기업의 재무 정보와 공시 데이터를 자동으로 수집합니다."
  }
] as const;

const steps = [
  { num: "01", text: "상단 설정 아이콘에서 러너 연결을 확인합니다." },
  { num: "02", text: "프로바이더 탭에서 사용할 AI 프로바이더를 설정합니다." },
  { num: "03", text: "설정에서 OpenDART API 키를 등록해 기업 데이터를 활성화합니다." },
  { num: "04", text: "프로젝트를 만들고 채용 공고를 붙여넣어 분석을 시작합니다." }
] as const;

export function OverviewPage() {
  return (
    <section className="overview-page">
      <main className="overview-main">
        <div className="overview-main-inner">

          <section className="overview-intro-hero">
            <div className="overview-intro-badge">AI 취업 지원 플랫폼</div>
            <h1 className="overview-intro-title">JaFiction</h1>
            <p className="overview-intro-tagline">
              이력서 분석부터 기업 조사까지 — AI가 취업 준비의 전 과정을 자동화합니다.
            </p>
          </section>

          <section className="overview-intro-features" aria-label="주요 기능">
            <div className="overview-intro-feature-grid">
              {features.map((feature) => (
                <article key={feature.title} className="overview-intro-feature-card">
                  <div className="overview-intro-feature-icon">{feature.icon}</div>
                  <div className="overview-intro-feature-copy">
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="overview-intro-quickstart" aria-label="시작하기">
            <div className="overview-section-header">
              <h2 className="overview-section-title">시작하기</h2>
            </div>
            <ol className="overview-intro-steps">
              {steps.map((step) => (
                <li key={step.num} className="overview-intro-step">
                  <span className="overview-intro-step-num">{step.num}</span>
                  <span className="overview-intro-step-text">{step.text}</span>
                </li>
              ))}
            </ol>
          </section>

        </div>
      </main>
    </section>
  );
}
