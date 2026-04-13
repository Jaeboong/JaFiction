import { useCallback, useState } from "react";

const HISTORY_KEY = "jasojeon.notifications.history";
const MAX_NOTIFICATIONS = 50;

export type NotificationTone = "pending" | "success" | "warning" | "error";

export interface Notification {
  readonly id: string;
  readonly tone: NotificationTone;
  readonly message: string;
  readonly detail?: string;
  readonly timestamp: number;
  readonly read: boolean;
}

function loadHistory(): Notification[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is Notification =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as Record<string, unknown>)["id"] === "string" &&
        typeof (x as Record<string, unknown>)["message"] === "string" &&
        typeof (x as Record<string, unknown>)["timestamp"] === "number"
    );
  } catch {
    return [];
  }
}

function saveHistory(notifications: readonly Notification[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(notifications));
  } catch {
    // localStorage may be unavailable
  }
}

let nextIdCounter = Date.now();

export interface UseNotificationsResult {
  readonly notifications: readonly Notification[];
  readonly unreadCount: number;
  readonly add: (tone: NotificationTone, message: string, detail?: string) => void;
  readonly clear: () => void;
  readonly markAllRead: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<readonly Notification[]>(() =>
    loadHistory()
  );

  const add = useCallback((tone: NotificationTone, message: string, detail?: string) => {
    setNotifications((current) => {
      const entry: Notification = {
        id: String(++nextIdCounter),
        tone,
        message,
        detail,
        timestamp: Date.now(),
        read: false
      };
      const next = [entry, ...current].slice(0, MAX_NOTIFICATIONS);
      saveHistory(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
    saveHistory([]);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((current) => {
      if (current.every((n) => n.read)) return current;
      const next = current.map((n) => (n.read ? n : { ...n, read: true }));
      saveHistory(next);
      return next;
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, add, clear, markAllRead };
}
