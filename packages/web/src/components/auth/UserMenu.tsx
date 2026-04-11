import { useEffect, useRef, useState } from "react";
import type { BackendClient } from "../../api/client";

export interface UserMenuProps {
  readonly backendClient: BackendClient;
}

interface UserProfile {
  readonly id: string;
  readonly email: string;
}

export function UserMenu({ backendClient }: UserMenuProps) {
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    void backendClient
      .fetchCurrentUser()
      .then((user) => {
        if (!disposed) setProfile(user);
      })
      .catch(() => {
        // unauthenticated or network error — leave the avatar as "U"
      });
    return () => {
      disposed = true;
    };
  }, [backendClient]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const initial = profile?.email ? profile.email.charAt(0).toUpperCase() : "U";

  async function handleLogout() {
    try {
      await backendClient.logout();
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="app-avatar user-menu-trigger"
        aria-label="사용자 메뉴"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
      >
        {initial}
      </button>

      {isOpen && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-avatar" aria-hidden="true">{initial}</div>
            <div className="user-menu-identity">
              <div className="user-menu-name">{profile?.email ?? "사용자"}</div>
              <div className="user-menu-sub">Google 계정 연결됨</div>
            </div>
          </div>
          <div className="user-menu-divider" />
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              // Profile page is not yet routed — placeholder hook
              window.alert("회원정보 페이지는 준비 중입니다.");
            }}
          >
            <span className="user-menu-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
              </svg>
            </span>
            회원정보
          </button>
          <button
            type="button"
            className="user-menu-item user-menu-item-danger"
            role="menuitem"
            onClick={() => void handleLogout()}
          >
            <span className="user-menu-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 12H4m0 0 4-4m-4 4 4 4" />
                <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
              </svg>
            </span>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
