import type { ProjectRecord } from "@jasojeon/shared";

type PostingFieldTier = NonNullable<ProjectRecord["jobPostingFieldConfidence"][keyof ProjectRecord["jobPostingFieldConfidence"]]>;

interface PostingFieldConfidenceBadgeProps {
  readonly value: string | undefined;
  readonly tier: PostingFieldTier | undefined;
}

export function PostingFieldConfidenceBadge({ value, tier }: PostingFieldConfidenceBadgeProps) {
  const isEmpty = !value?.trim();
  const isWeakTier = tier === "role";

  if (!isEmpty && !isWeakTier) {
    return null;
  }

  return (
    <span
      className="projects-field-confidence-badge"
      title="공고 페이지 구조상 정확 추출이 어려웠습니다. 값을 직접 입력하거나 공고 텍스트를 붙여넣어 주세요."
    >
      ⚠️ 자동 감지 — 확인 필요
    </span>
  );
}
