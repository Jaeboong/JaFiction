import type { ProjectViewModel } from "@jasojeon/shared";

interface Props {
  readonly projects: readonly ProjectViewModel[];
  readonly onNavigateToProject: (slug: string) => void;
  readonly onClose: () => void;
}

function calcDDay(deadline?: string): { label: string; danger: boolean } | null {
  if (!deadline) return null;
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return { label: "완료", danger: false };
  if (daysLeft <= 3) return { label: `D-${daysLeft}`, danger: true };
  return { label: `D-${daysLeft}`, danger: false };
}

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function MyProjectsTab({ projects, onNavigateToProject, onClose }: Props) {
  if (projects.length === 0) {
    return (
      <p className="profile-modal-empty">
        아직 작성한 자소서가 없어요. 새 지원서를 만들어보세요.
      </p>
    );
  }

  return (
    <div className="profile-modal-section">
      <h3 className="profile-modal-section-title">내 자소서</h3>
      {projects.map((project) => {
        const { record } = project;
        const dday = calcDDay(record.deadline);
        return (
          <div key={record.slug} className="profile-modal-project-row">
            <div className="profile-modal-project-info">
              <div className="profile-modal-project-company">{record.companyName}</div>
              <div className="profile-modal-project-role">
                {record.roleName ?? "—"} · {formatCreatedAt(record.createdAt)}
              </div>
            </div>
            <div className="profile-modal-project-actions">
              {dday ? (
                <span
                  className="profile-modal-badge"
                  data-danger={String(dday.danger)}
                >
                  {dday.label}
                </span>
              ) : null}
              <button
                type="button"
                className="profile-modal-open-btn"
                onClick={() => {
                  onNavigateToProject(record.slug);
                  onClose();
                }}
              >
                열기
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
