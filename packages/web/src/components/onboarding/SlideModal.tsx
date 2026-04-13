import { useState } from "react";
import type { ReactNode } from "react";
import "../../styles/onboarding.css";

export interface OnboardingSlide {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly image?: string;
  readonly primaryAction?: { readonly label: string; readonly onClick: () => void };
}

export interface SlideModalProps {
  readonly slides: readonly OnboardingSlide[];
  readonly rememberKey: string;
  readonly initialIndex?: number;
  readonly onComplete?: () => void;
  readonly onDismiss: (persist: boolean) => void;
  readonly forceShow?: boolean;
}

function StepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <div className="slide-step-indicator" aria-label={`${current + 1} / ${total} 슬라이드`}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`slide-step-dot${i === current ? " is-active" : i < current ? " is-done" : ""}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function SlideModal({
  slides,
  initialIndex = 0,
  onComplete,
  onDismiss,
  forceShow = false
}: SlideModalProps) {
  const [index, setIndex] = useState(initialIndex);
  const [remember, setRemember] = useState(false);

  const slide = slides[index];
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;

  if (!slide) return null;

  const handlePrev = () => {
    if (!isFirst) setIndex((i) => i - 1);
  };

  const handleNext = () => {
    if (isLast) {
      if (slide.primaryAction) {
        slide.primaryAction.onClick();
      }
      onComplete?.();
      onDismiss(remember);
    } else {
      setIndex((i) => i + 1);
    }
  };

  const handleClose = () => {
    onDismiss(false);
  };

  return (
    <div className="slide-modal-overlay" role="dialog" aria-modal="true" aria-label="온보딩 가이드">
      <div className="slide-modal">
        <button
          type="button"
          className="slide-modal-close"
          aria-label="닫기"
          onClick={handleClose}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="slide-modal-body">
          {slide.image && (
            <img
              src={slide.image}
              alt=""
              className="slide-modal-image"
              aria-hidden="true"
            />
          )}
          <h2 className="slide-modal-title">{slide.title}</h2>
          <div className="slide-modal-content">{slide.body}</div>
        </div>

        <StepIndicator total={slides.length} current={index} />

        <div className="slide-modal-footer">
          <div className="slide-modal-footer-left">
            {!forceShow && (
              <label className="slide-modal-remember-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                다시 보지 않기
              </label>
            )}
          </div>

          <div className="slide-modal-nav">
            <button
              type="button"
              className="slide-modal-nav-btn"
              onClick={handlePrev}
              disabled={isFirst}
            >
              이전
            </button>
            <button
              type="button"
              className={`slide-modal-nav-btn${isLast && slide.primaryAction ? " is-primary" : isLast ? " is-primary" : ""}`}
              onClick={handleNext}
            >
              {isLast
                ? (slide.primaryAction?.label ?? "완료")
                : "다음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
