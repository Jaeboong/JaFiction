import { useEffect, useState } from "react";
import type { ProjectViewModel } from "@jasojeon/shared";
import type { BackendClient } from "../../api/client";
import { MyInfoTab } from "./MyInfoTab";
import { MyProjectsTab } from "./MyProjectsTab";
import "../../styles/user-profile-modal.css";

interface Props {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly email: string;
  readonly backendClient: BackendClient;
  readonly projects: readonly ProjectViewModel[];
  readonly onNavigateToProject: (slug: string) => void;
}

type ActiveTab = "info" | "projects";

export function UserProfileModal({ isOpen, onClose, email, backendClient, projects, onNavigateToProject }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("info");

  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("keydown", handleEscape); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="profile-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="회원정보"
      onClick={handleBackdropClick}
    >
      <div className="profile-modal">
        <button
          type="button"
          className="profile-modal-close"
          aria-label="닫기"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <nav className="profile-modal-sidebar" aria-label="회원정보 탭">
          <p className="profile-modal-sidebar-title">내 계정</p>
          <button
            type="button"
            className={`profile-modal-tab${activeTab === "info" ? " is-active" : ""}`}
            onClick={() => { setActiveTab("info"); }}
          >
            내 정보
          </button>
          <button
            type="button"
            className={`profile-modal-tab${activeTab === "projects" ? " is-active" : ""}`}
            onClick={() => { setActiveTab("projects"); }}
          >
            자소서
          </button>
        </nav>

        <div className="profile-modal-content">
          {activeTab === "info" ? (
            <MyInfoTab
              email={email}
              backendClient={backendClient}
              onClose={onClose}
            />
          ) : (
            <MyProjectsTab
              projects={projects}
              onNavigateToProject={onNavigateToProject}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
