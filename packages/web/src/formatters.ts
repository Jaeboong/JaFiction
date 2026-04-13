import type {
  InsightStatus,
  ProviderAuthStatus,
  ProviderId,
  ReviewMode,
  RunStatus,
  SourceType
} from "@jasojeon/shared";

export type StatusTone = "positive" | "warning" | "negative" | "neutral" | "info";

const providerNames: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini"
};

const authStatusLabels: Record<ProviderAuthStatus, string> = {
  healthy: "정상 연결",
  missing: "미설치",
  unhealthy: "오류 감지",
  untested: "대기 중"
};

const insightStatusLabels: Record<NonNullable<InsightStatus>, string> = {
  error: "오류",
  generating: "생성 중",
  idle: "대기 중",
  ready: "분석 완료",
  reviewNeeded: "검토 필요"
};

const runStatusLabels: Record<RunStatus, string> = {
  aborted: "중단됨",
  "awaiting-user-input": "입력 대기 중",
  completed: "완료",
  failed: "실패",
  running: "분석 진행 중"
};

const sessionStatusLabels: Record<"idle" | "running" | "paused", string> = {
  idle: "대기 중",
  paused: "일시 중지",
  running: "분석 진행 중"
};

const sourceTypeLabels: Record<SourceType, string> = {
  image: "이미지",
  md: "Markdown",
  other: "기타",
  pdf: "PDF",
  pptx: "PPTX",
  text: "텍스트",
  txt: "TXT"
};

const reviewModeLabels: Record<ReviewMode, string> = {
  deepFeedback: "심층 피드백",
  realtime: "실시간"
};

export function providerName(providerId: ProviderId): string {
  return providerNames[providerId];
}

export function authStatusLabel(status: ProviderAuthStatus): string {
  return authStatusLabels[status];
}

export function insightStatusLabel(status?: InsightStatus): string {
  if (!status) {
    return insightStatusLabels.idle;
  }
  return insightStatusLabels[status];
}

export function runStatusLabel(status?: RunStatus): string {
  if (!status) {
    return runStatusLabels.completed;
  }
  return runStatusLabels[status];
}

export function sessionStatusLabel(status?: "idle" | "running" | "paused"): string {
  if (!status) {
    return sessionStatusLabels.idle;
  }
  return sessionStatusLabels[status];
}

export function sourceTypeLabel(sourceType: SourceType): string {
  return sourceTypeLabels[sourceType];
}

export function reviewModeLabel(mode: ReviewMode): string {
  return reviewModeLabels[mode];
}

export function statusToneForAuthStatus(status: ProviderAuthStatus): StatusTone {
  if (status === "healthy") {
    return "positive";
  }
  if (status === "untested") {
    return "warning";
  }
  return "negative";
}

export function statusToneForInsightStatus(status?: InsightStatus): StatusTone {
  if (status === "ready") {
    return "positive";
  }
  if (status === "generating" || status === "reviewNeeded") {
    return "warning";
  }
  if (status === "error") {
    return "negative";
  }
  return "neutral";
}

export function statusToneForRunStatus(status?: RunStatus): StatusTone {
  if (status === "running") {
    return "positive";
  }
  if (status === "awaiting-user-input") {
    return "info";
  }
  if (status === "failed") {
    return "negative";
  }
  return "neutral";
}

export function statusToneForSessionStatus(status?: "idle" | "running" | "paused" | "aborting"): StatusTone {
  if (status === "running") {
    return "positive";
  }
  if (status === "aborting") {
    return "warning";
  }
  if (status === "paused") {
    return "warning";
  }
  return "neutral";
}

export function formatRelative(value?: string | number): string {
  const date = toDate(value);
  if (!date) {
    return "기록 없음";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) {
    return "방금 전";
  }
  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes > 0 ? `${diffMinutes}분 전` : `${Math.abs(diffMinutes)}분 후`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return diffHours > 0 ? `${diffHours}시간 전` : `${Math.abs(diffHours)}시간 후`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return diffDays > 0 ? `${diffDays}일 전` : `${Math.abs(diffDays)}일 후`;
  }

  return formatDateTime(date);
}

export function formatDateTime(value?: string | number | Date): string {
  const date = toDate(value);
  if (!date) {
    return "기록 없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatDate(value?: string | number | Date): string {
  const date = toDate(value);
  if (!date) {
    return "기록 없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium"
  }).format(date);
}

export function formatClock(value?: string | number | Date): string {
  const date = toDate(value);
  if (!date) {
    return "--:--:--";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function toDate(value?: string | number | Date): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}
