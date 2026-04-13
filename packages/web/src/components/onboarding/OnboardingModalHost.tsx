import type { SidebarState } from "@jasojeon/shared";
import { SlideModal } from "./SlideModal";
import {
  buildInsightsReadySlides,
  buildOverviewDeckSlides,
  PROJECTS_INTRO_SLIDES,
  PROVIDERS_INTRO_SLIDES,
  RUNS_INTRO_SLIDES
} from "./OnboardingSlides";
import type { OnboardingModalId } from "../../hooks/useOnboardingFlow";

export interface OnboardingModalHostProps {
  readonly activeModalId: OnboardingModalId | null;
  readonly state: SidebarState;
  readonly selectedTab: string;
  readonly isForcedShow: boolean;
  readonly onDismiss: (id: OnboardingModalId, persist: boolean) => void;
  readonly onNavigate: (tab: string) => void;
}

export function OnboardingModalHost({
  activeModalId,
  state,
  isForcedShow,
  onDismiss,
  onNavigate
}: OnboardingModalHostProps) {
  if (!activeModalId) return null;

  const hasHealthyProvider = state.providers.some((p) => p.authStatus === "healthy");

  switch (activeModalId) {
    case "overview_deck": {
      const slides = buildOverviewDeckSlides({
        hasHealthyProvider,
        onGoToProviders: () => onNavigate("providers"),
        onGoToProjects: () => onNavigate("projects")
      });
      return (
        <SlideModal
          slides={slides}
          rememberKey={activeModalId}
          forceShow={isForcedShow}
          onComplete={() => onDismiss(activeModalId, false)}
          onDismiss={(persist) => onDismiss(activeModalId, persist)}
        />
      );
    }

    case "providers_intro":
      return (
        <SlideModal
          slides={PROVIDERS_INTRO_SLIDES}
          rememberKey={activeModalId}
          forceShow={isForcedShow}
          onDismiss={(persist) => onDismiss(activeModalId, persist)}
        />
      );

    case "projects_intro":
      return (
        <SlideModal
          slides={PROJECTS_INTRO_SLIDES}
          rememberKey={activeModalId}
          forceShow={isForcedShow}
          onDismiss={(persist) => onDismiss(activeModalId, persist)}
        />
      );

    case "runs_intro":
      return (
        <SlideModal
          slides={RUNS_INTRO_SLIDES}
          rememberKey={activeModalId}
          forceShow={isForcedShow}
          onDismiss={(persist) => onDismiss(activeModalId, persist)}
        />
      );

    case "insights_ready_nudge": {
      const slides = buildInsightsReadySlides({
        onGoToRuns: () => {
          onNavigate("runs");
          onDismiss(activeModalId, false);
        }
      });
      return (
        <SlideModal
          slides={slides}
          rememberKey={activeModalId}
          forceShow={isForcedShow}
          onComplete={() => onDismiss(activeModalId, false)}
          onDismiss={(persist) => onDismiss(activeModalId, persist)}
        />
      );
    }

    default:
      return null;
  }
}
