import { parseReviewerCardContent, type ReviewerCardContent } from "@jafiction/shared/reviewerCard";

interface ReviewerCardProps {
  color: string;
  review: ReviewerCardContent;
}

type ReviewerStatusTone = "revise" | "approve" | "block" | "neutral";

export type { ReviewerCardContent } from "@jafiction/shared/reviewerCard";
export { parseReviewerCardContent } from "@jafiction/shared/reviewerCard";

function reviewerStatusTone(status?: string): ReviewerStatusTone {
  switch (status) {
    case "REVISE":
      return "revise";
    case "PASS":
      return "approve";
    case "BLOCK":
      return "block";
    default:
      return "neutral";
  }
}

export function ReviewerCard({ color, review }: ReviewerCardProps) {
  const statusTone = reviewerStatusTone(review.status);

  return (
    <div className="runs-reviewer-card" style={{ borderLeftColor: color }}>
      {review.status ? (
        <div className="runs-reviewer-status-row">
          <span className="runs-reviewer-status-label">Status</span>
          <span className={`runs-reviewer-status-badge is-${statusTone}`}>
            {review.status}
          </span>
        </div>
      ) : null}

      {review.miniDraft ? (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">Mini Draft</span>
          <p className="runs-coordinator-text runs-coordinator-draft">{review.miniDraft}</p>
        </div>
      ) : null}

      {review.challenges.length > 0 ? (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label runs-coordinator-label-warn">Challenge</span>
          <ul className="runs-coordinator-list runs-reviewer-list">
            {review.challenges.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.crossFeedback.length > 0 ? (
        <div className="runs-coordinator-row">
          <span className="runs-coordinator-label">Cross-feedback</span>
          <ul className="runs-coordinator-list runs-reviewer-list">
            {review.crossFeedback.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
