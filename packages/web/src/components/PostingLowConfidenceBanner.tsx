import type { ReviewNeededReason } from "@jasojeon/shared";

interface PostingLowConfidenceBannerProps {
  readonly reasons: readonly ReviewNeededReason[];
}

export function PostingLowConfidenceBanner({ reasons }: PostingLowConfidenceBannerProps) {
  if (!reasons.includes("lowConfidenceExtraction")) {
    return null;
  }

  return (
    <div className="projects-low-confidence-banner" role="alert">
      ⚠️ 자동 감지 결과 신뢰도가 낮습니다. 아래 회사명·직무를 확인하고 직접 수정해주세요.
    </div>
  );
}
