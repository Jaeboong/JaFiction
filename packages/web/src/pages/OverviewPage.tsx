import type { ContextDocument } from "@jasojeon/shared";
import { ProfileDocumentsPanel } from "../components/profile/ProfileDocumentsPanel";
import type { RunnerClient } from "../api/client";
import "../styles/overview.css";

export interface OverviewPageProps {
  readonly client: RunnerClient;
  readonly profileDocuments: readonly ContextDocument[];
  readonly onProfileDocumentsChanged: () => void;
}

export function OverviewPage({
  client,
  profileDocuments,
  onProfileDocumentsChanged
}: OverviewPageProps) {
  return (
    <section className="overview-page">
      <main className="overview-main">
        <div className="overview-main-inner">
          <section className="overview-experience-header">
            <h1 className="overview-experience-title">내 경험</h1>
            <p className="overview-experience-copy">
              지원서마다 다시 올리지 않아도 되는 이력서, 경력기술서, 경험 정리 문서를 관리합니다.
            </p>
          </section>
          <ProfileDocumentsPanel
            client={client}
            documents={profileDocuments}
            onDocumentsChanged={onProfileDocumentsChanged}
          />
        </div>
      </main>
    </section>
  );
}
