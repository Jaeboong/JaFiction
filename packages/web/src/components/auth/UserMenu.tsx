import { useEffect, useRef, useState } from "react";
import type { BackendClient } from "../../api/client";

export interface UserMenuProps {
  readonly backendClient: BackendClient;
}

interface UserProfile {
  readonly id: string;
  readonly email: string;
}

type AuthState =
  | { readonly kind: "loading" }
  | { readonly kind: "authenticated"; readonly profile: UserProfile }
  | { readonly kind: "unauthenticated" };

export function UserMenu({ backendClient }: UserMenuProps) {
  const [authState, setAuthState] = useState<AuthState>({ kind: "loading" });
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    void backendClient
      .fetchCurrentUser()
      .then((user) => {
        if (!disposed) setAuthState({ kind: "authenticated", profile: user });
      })
      .catch(() => {
        if (!disposed) setAuthState({ kind: "unauthenticated" });
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

  const isAuthenticated = authState.kind === "authenticated";
  const initial = isAuthenticated ? authState.profile.email.charAt(0).toUpperCase() : "?";

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
        className={`app-avatar user-menu-trigger${authState.kind === "unauthenticated" ? " user-menu-trigger--guest" : ""}`}
        aria-label="사용자 메뉴"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((o) => !o)}
      >
        {initial}
      </button>

      {isOpen && (
        <div className="user-menu-dropdown" role="menu">
          {isAuthenticated ? (
            <>
              <div className="user-menu-header">
                <div className="user-menu-avatar" aria-hidden="true">{initial}</div>
                <div className="user-menu-identity">
                  <div className="user-menu-name">{authState.profile.email}</div>
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
            </>
          ) : (
            <>
              <div className="user-menu-header">
                <div className="user-menu-identity">
                  <div className="user-menu-name">로그인이 필요합니다</div>
                  <div className="user-menu-sub">자소전 서비스를 이용하려면 로그인해 주세요.</div>
                </div>
              </div>
              <div className="user-menu-divider" />
              <a
                href="/auth/google"
                className="user-menu-item"
                role="menuitem"
              >
                <span className="user-menu-item-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <path d="M10 17l5-5-5-5" />
                    <path d="M15 12H3" />
                  </svg>
                </span>
                로그인
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
