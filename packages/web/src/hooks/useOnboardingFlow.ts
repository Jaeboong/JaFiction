import { useCallback, useEffect, useRef, useState } from "react";
import type { SidebarState } from "@jasojeon/shared";
import { loadDismissed, saveDismissed } from "../lib/onboardingStorage";

export type OnboardingModalId =
  | "overview_deck"
  | "providers_intro"
  | "projects_intro"
  | "runs_intro"
  | "insights_ready_nudge";

type AppTab = "overview" | "providers" | "projects" | "runs" | "settings";

const TAB_MODAL_MAP: Partial<Record<AppTab, OnboardingModalId>> = {
  overview: "overview_deck",
  providers: "providers_intro",
  projects: "projects_intro",
  runs: "runs_intro"
};

export interface OnboardingFlowResult {
  readonly activeModalId: OnboardingModalId | null;
  readonly dismiss: (key: OnboardingModalId, persist: boolean) => void;
  readonly forceShowForTab: (tab: string) => void;
  readonly isHelpAvailable: boolean;
}

export function useOnboardingFlow(
  state: SidebarState | undefined,
  selectedTab: string,
  setSelectedTab: (t: string) => void
): OnboardingFlowResult {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => loadDismissed());
  const [activeModalId, setActiveModalId] = useState<OnboardingModalId | null>(null);
  const [forcedModalId, setForcedModalId] = useState<OnboardingModalId | null>(null);

  // Track previous insight status for transition detection
  const prevInsightStatusRef = useRef<string | undefined>(undefined);

  // Reference to setSelectedTab to avoid stale closure
  const setSelectedTabRef = useRef(setSelectedTab);
  setSelectedTabRef.current = setSelectedTab;

  // Effect: tab-entry modal activation
  useEffect(() => {
    if (forcedModalId) return;

    const tabId = selectedTab as AppTab;
    const modalId = TAB_MODAL_MAP[tabId];

    if (modalId && !dismissedKeys.has(modalId)) {
      setActiveModalId(modalId);
    } else {
      // Close any tab-intro modal if we navigate away
      setActiveModalId((current) => {
        if (current === null) return null;
        const currentTabModal = TAB_MODAL_MAP[tabId as AppTab];
        if (current !== currentTabModal && current !== "insights_ready_nudge") {
          return null;
        }
        return current;
      });
    }
  }, [selectedTab, dismissedKeys, forcedModalId]);

  // Effect: insightStatus transition detection
  useEffect(() => {
    if (!state) return;

    const selectedProject = state.projects[0];
    const currentStatus = selectedProject?.record?.insightStatus;

    const prev = prevInsightStatusRef.current;
    prevInsightStatusRef.current = currentStatus;

    if (prev !== undefined && prev !== "ready" && currentStatus === "ready") {
      if (!dismissedKeys.has("insights_ready_nudge")) {
        setActiveModalId("insights_ready_nudge");
      }
    }
  }, [state, dismissedKeys]);

  const dismiss = useCallback((key: OnboardingModalId, persist: boolean) => {
    setActiveModalId(null);
    setForcedModalId(null);

    setDismissedKeys((current) => {
      const next = new Set(current);
      next.add(key);
      if (persist) saveDismissed(next);
      return next;
    });
  }, []);

  const forceShowForTab = useCallback((tab: string) => {
    const modalId = TAB_MODAL_MAP[tab as AppTab];
    if (!modalId) return;
    setForcedModalId(modalId);
    setActiveModalId(modalId);
  }, []);

  const effectiveModalId = forcedModalId ?? activeModalId;

  const currentTab = selectedTab as AppTab;
  const isHelpAvailable = Boolean(TAB_MODAL_MAP[currentTab]);

  return {
    activeModalId: effectiveModalId,
    dismiss,
    forceShowForTab,
    isHelpAvailable
  };
}
