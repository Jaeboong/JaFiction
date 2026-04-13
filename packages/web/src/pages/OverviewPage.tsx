import { useState } from "react";
import { buildOverviewDeckSlides } from "../components/onboarding/OnboardingSlides";
import { SlideModal } from "../components/onboarding/SlideModal";
import "../styles/overview.css";

export interface OverviewPageProps {
  readonly hasHealthyProvider: boolean;
  readonly hasProject: boolean;
  readonly onFinish: (target: "providers" | "projects") => void;
}

export function OverviewPage({ hasHealthyProvider, hasProject: _hasProject, onFinish }: OverviewPageProps) {
  const [dismissed, setDismissed] = useState(false);

  const slides = buildOverviewDeckSlides({
    hasHealthyProvider,
    onGoToProviders: () => onFinish("providers"),
    onGoToProjects: () => onFinish("projects")
  });

  const handleDismiss = (_persist: boolean) => {
    setDismissed(true);
  };

  const handleComplete = () => {
    setDismissed(true);
  };

  return (
    <section className="overview-page">
      <main className="overview-main">
        <div className="overview-main-inner">
          <section className="overview-intro-hero">
            <div className="overview-intro-badge">AI 취업 지원 플랫폼</div>
            <h1 className="overview-intro-title">자소전</h1>
            <p className="overview-intro-tagline">
              이력서 분석부터 기업 조사까지 — AI가 취업 준비의 전 과정을 자동화합니다.
            </p>
            {dismissed && (
              <button
                type="button"
                className="overview-reopen-btn"
                onClick={() => setDismissed(false)}
              >
                가이드 다시 보기
              </button>
            )}
          </section>
        </div>
      </main>

      {!dismissed && (
        <SlideModal
          slides={slides}
          rememberKey="overview_deck"
          onComplete={handleComplete}
          onDismiss={handleDismiss}
        />
      )}
    </section>
  );
}
