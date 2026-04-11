import { useState } from "react";
import type { ContextDocument, ProfileGetDocumentPreviewResult } from "@jasojeon/shared";
import type { RunnerClient } from "../../api/client";

// Kept inline — shared constant not re-exported across vite bundle boundary.
const UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

interface ProfileDocumentsPanelProps {
  readonly client: RunnerClient;
  readonly documents: readonly ContextDocument[];
  readonly onDocumentsChanged: () => void;
}

export function ProfileDocumentsPanel({
  client,
  documents,
  onDocumentsChanged
}: ProfileDocumentsPanelProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [pinnedByDefault, setPinnedByDefault] = useState(false);
  const [savingText, setSavingText] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [pendingPinId, setPendingPinId] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ProfileGetDocumentPreviewResult | undefined>(undefined);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const handleSaveText = async () => {
    if (!title.trim()) {
      setErrorMessage("문서 제목을 입력해주세요.");
      return;
    }
    setErrorMessage(undefined);
    setSavingText(true);
    try {
      await client.saveProfileTextDocument({
        title: title.trim(),
        content,
        note: note.trim() || undefined,
        pinnedByDefault
      });
      setTitle("");
      setContent("");
      setNote("");
      setPinnedByDefault(false);
      onDocumentsChanged();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSavingText(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setErrorMessage(undefined);
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (file.size > UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES) {
        setErrorMessage(`"${file.name}"이(가) 최대 업로드 한도(100MB)를 초과했습니다.`);
        return;
      }
    }
    setUploadingCount(fileArray.length);
    try {
      for (const file of fileArray) {
        await client.uploadProfileDocument(file, { pinnedByDefault });
      }
      onDocumentsChanged();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setUploadingCount(0);
    }
  };

  const handleTogglePinned = async (documentId: string, nextPinned: boolean) => {
    setErrorMessage(undefined);
    setPendingPinId(documentId);
    try {
      await client.setProfileDocumentPinned(documentId, nextPinned);
      onDocumentsChanged();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingPinId(undefined);
    }
  };

  const handleShowPreview = async (documentId: string) => {
    setErrorMessage(undefined);
    setPreviewLoadingId(documentId);
    try {
      const result = await client.getProfileDocumentPreview(documentId);
      setPreview(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPreviewLoadingId(undefined);
    }
  };

  return (
    <section className="settings-opendart-panel" aria-label="프로필 문서">
      <div className="overview-section-header">
        <h2 className="overview-section-title">프로필 문서</h2>
      </div>
      <div className="settings-opendart-body">
        <p className="settings-opendart-desc">
          이력서, 경력기술서 등 프로필 문서를 등록하면 모든 프로젝트의 기본 컨텍스트로 사용됩니다.
        </p>

        {errorMessage ? (
          <div className="app-error-banner">{errorMessage}</div>
        ) : null}

        {/* Text document form */}
        <div className="settings-opendart-form">
          <div className="settings-opendart-field">
            <label className="settings-field-label" htmlFor="profile-doc-title">제목</label>
            <input
              id="profile-doc-title"
              type="text"
              className="settings-api-key-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 이력서"
              spellCheck={false}
              disabled={savingText}
            />
          </div>
          <div className="settings-opendart-field">
            <label className="settings-field-label" htmlFor="profile-doc-content">내용</label>
            <textarea
              id="profile-doc-content"
              className="settings-api-key-input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="문서 본문을 입력하세요"
              rows={6}
              disabled={savingText}
            />
          </div>
          <div className="settings-opendart-field">
            <label className="settings-field-label" htmlFor="profile-doc-note">메모 (선택)</label>
            <input
              id="profile-doc-note"
              type="text"
              className="settings-api-key-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="버전 번호 등 참고용 메모"
              spellCheck={false}
              disabled={savingText}
            />
          </div>
          <div className="settings-opendart-field">
            <label className="settings-field-label">
              <input
                type="checkbox"
                checked={pinnedByDefault}
                onChange={(e) => setPinnedByDefault(e.target.checked)}
                disabled={savingText}
              />
              {" "}새 프로젝트에서 기본으로 포함
            </label>
          </div>
          <div className="settings-opendart-actions">
            <button
              className="settings-primary-button"
              type="button"
              disabled={!title.trim() || savingText}
              onClick={handleSaveText}
            >
              {savingText ? "저장중..." : "텍스트로 추가"}
            </button>
            <label className="settings-secondary-button" style={{ cursor: uploadingCount > 0 ? "wait" : "pointer" }}>
              {uploadingCount > 0 ? `업로드중... (${uploadingCount}개)` : "파일 업로드"}
              <input
                type="file"
                multiple
                style={{ display: "none" }}
                disabled={uploadingCount > 0}
                onChange={(e) => {
                  void handleUploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        {/* Document list */}
        <div className="settings-opendart-form" style={{ marginTop: 24 }}>
          <h3 className="overview-section-title" style={{ fontSize: 16 }}>
            등록된 문서 ({documents.length})
          </h3>
          {documents.length === 0 ? (
            <p className="settings-opendart-desc">등록된 프로필 문서가 없습니다.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "12px 0",
                    borderBottom: "1px solid var(--color-border, #e5e5e5)"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <strong>{doc.title}</strong>
                      <span className="settings-opendart-desc" style={{ fontSize: 12 }}>
                        {doc.sourceType}
                        {doc.note ? ` · ${doc.note}` : ""}
                      </span>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={doc.pinnedByDefault}
                        disabled={pendingPinId === doc.id}
                        onChange={(e) => {
                          void handleTogglePinned(doc.id, e.target.checked);
                        }}
                      />
                      기본 포함
                    </label>
                    <button
                      type="button"
                      className="settings-secondary-button"
                      disabled={previewLoadingId === doc.id}
                      onClick={() => {
                        void handleShowPreview(doc.id);
                      }}
                    >
                      {previewLoadingId === doc.id ? "불러오는 중..." : "미리보기"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Preview modal (inline) */}
        {preview ? (
          <div
            role="dialog"
            aria-label="프로필 문서 미리보기"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000
            }}
            onClick={() => setPreview(undefined)}
          >
            <div
              style={{
                background: "var(--color-bg, #fff)",
                padding: 24,
                borderRadius: 8,
                maxWidth: "80vw",
                maxHeight: "80vh",
                overflow: "auto",
                minWidth: 480
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <h3 className="overview-section-title">{preview.title}</h3>
                <button
                  type="button"
                  className="settings-secondary-button"
                  onClick={() => setPreview(undefined)}
                >
                  닫기
                </button>
              </div>
              <p className="settings-opendart-desc" style={{ fontSize: 12 }}>
                {preview.sourceType} · {preview.extractionStatus} · {preview.previewSource}
                {preview.note ? ` · ${preview.note}` : ""}
              </p>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "var(--color-bg-subtle, #f5f5f5)",
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: "60vh",
                  overflow: "auto"
                }}
              >
                {preview.content || "(내용 없음)"}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
