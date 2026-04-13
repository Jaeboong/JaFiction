import { useEffect, useRef, useState } from "react";
import type { Notification, NotificationTone } from "../../hooks/useNotifications";
import "../../styles/notifications.css";

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}일 전`;
}

function toneBadgeClass(tone: NotificationTone): string {
  return `notification-badge notification-badge-${tone}`;
}

function toneLabel(tone: NotificationTone): string {
  switch (tone) {
    case "success": return "성공";
    case "error": return "오류";
    case "warning": return "경고";
    case "pending": return "진행중";
  }
}

interface NotificationsBellProps {
  readonly notifications: readonly Notification[];
  readonly unreadCount: number;
  readonly onOpen: () => void;
  readonly onClear: () => void;
}

export function NotificationsBell({
  notifications,
  unreadCount,
  onOpen,
  onClear
}: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) onOpen();
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="notifications-dropdown-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`notifications-bell-btn${open ? " is-active" : ""}`}
        aria-label={`알림${unreadCount > 0 ? ` (읽지 않은 알림 ${unreadCount}개)` : ""}`}
        aria-expanded={open}
        onClick={handleToggle}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="notifications-badge" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notifications-dropdown" role="dialog" aria-label="알림 히스토리">
          <div className="notifications-dropdown-header">
            <span className="notifications-dropdown-title">알림 히스토리</span>
          </div>

          {notifications.length === 0 ? (
            <div className="notifications-empty">알림이 없습니다</div>
          ) : (
            <ul className="notifications-list" role="list">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`notification-item${!n.read ? " is-unread" : ""}`}
                >
                  <div className="notification-item-row">
                    <span className={toneBadgeClass(n.tone)}>{toneLabel(n.tone)}</span>
                    <span className="notification-message">{n.message}</span>
                    <span className="notification-time">{formatTime(n.timestamp)}</span>
                  </div>
                  {n.detail && (
                    <div className="notification-detail" title={n.detail}>{n.detail}</div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="notifications-dropdown-footer">
            <button
              type="button"
              className="notifications-clear-btn"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              모두 지우기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
