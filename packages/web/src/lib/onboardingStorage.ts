const DISMISSED_KEY = "jasojeon.onboarding.dismissed";

export function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveDismissed(set: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

export function clearAll(): void {
  try {
    localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // ignore
  }
}
