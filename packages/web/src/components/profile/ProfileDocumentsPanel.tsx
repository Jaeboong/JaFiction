import { useState, useRef } from "react";
import type { ContextDocument, ProfileGetDocumentPreviewResult } from "@jasojeon/shared";
import type { RunnerClient } from "../../api/client";
import "../../styles/projects.css";

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
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    <section
      className={`projects-panel projects-document-panel ${isDragOver ? "is-drag-over" : ""}`}
      aria-label="프로필 문서"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files.length) {
          void handleUploadFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="projects-panel-header projects-panel-header-column">
        <div>
          <h2>프로필 문서</h2>
          <p>이력서, 경력기술서 등 프로필 문서를 등록하면 모든 프로젝트의 기본 컨텍스트로 사용됩니다.</p>
        </div>
        <button
          className="projects-secondary-button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingCount > 0}
        >
          {uploadingCount > 0 ? `업로드중... (${uploadingCount}개)` : "+ 파일 업로드"}
        </button>
      </div>

      <input
        ref={fileInputRef}
        className="projects-hidden-input"
        type="file"
        multiple
        onChange={(event) => {
          void handleUploadFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {errorMessage ? (
        <div className="app-error-banner">{errorMessage}</div>
      ) : null}

      {/* Text document form */}
      <div className="projects-text-form">
        <label className="projects-field">
          <span className="projects-info-field-label">제목</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 이력서"
            spellCheck={false}
            disabled={savingText}
          />
        </label>
        <label className="projects-field">
          <span className="projects-info-field-label">내용</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="문서 본문을 입력하세요"
            rows={6}
            disabled={savingText}
          />
        </label>
        <label className="projects-field">
          <span className="projects-info-field-label">메모 (선택)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="버전 번호 등 참고용 메모"
            spellCheck={false}
            disabled={savingText}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151" }}>
          <input
            type="checkbox"
            checked={pinnedByDefault}
            onChange={(e) => setPinnedByDefault(e.target.checked)}
            disabled={savingText}
            style={{ width: 16, height: 16, accentColor: "#4f46e5", flexShrink: 0 }}
          />
          새 프로젝트에서 기본으로 포함
        </label>
        <button
          className="projects-primary-button"
          type="button"
          disabled={!title.trim() || savingText}
          onClick={() => { void handleSaveText(); }}
        >
          {savingText ? "저장중..." : "텍스트로 추가"}
        </button>
      </div>

      {/* Document list / empty dropzone */}
      {documents.length === 0 && uploadingCount === 0 ? (
        <button
          className={`projects-dropzone ${isDragOver ? "is-drag-over" : ""}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="projects-dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </span>
          <strong>파일을 여기로 드래그하거나 클릭해서 업로드하세요</strong>
          <span>PDF, PPTX, MD, TXT, 이미지 · 최대 100MB</span>
        </button>
      ) : (
        <ul style={{ listStyle: "none", padding: "0 20px", margin: 0 }}>
          {documents.map((doc) => (
            <li
              key={doc.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 0",
                borderBottom: "1px solid #e5e7eb"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <strong>{doc.title}</strong>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    {doc.sourceType}
                    {doc.note ? ` · ${doc.note}` : ""}
                  </span>
                </div>
                <button
                  className={`projects-pin-button${doc.pinnedByDefault ? " is-pinned" : ""}`}
                  type="button"
                  disabled={pendingPinId === doc.id}
                  aria-pressed={doc.pinnedByDefault}
                  aria-label={doc.pinnedByDefault ? "기본 컨텍스트에서 제외" : "기본 컨텍스트에 포함"}
                  title={doc.pinnedByDefault ? "기본 컨텍스트에 포함됨 (클릭하면 제외)" : "기본 컨텍스트에 포함하려면 클릭"}
                  onClick={() => { void handleTogglePinned(doc.id, !doc.pinnedByDefault); }}
                >
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="projects-secondary-button"
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

      {/* Preview modal (inline) */}
      {preview ? (
        <div
          role="dialog"
          aria-label="프로필 문서 미리보기"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
          onClick={() => setPreview(undefined)}
        >
          <div
            style={{
              background: "#ffffff",
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
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#111827" }}>{preview.title}</h3>
              <button
                type="button"
                className="projects-secondary-button"
                onClick={() => setPreview(undefined)}
              >
                닫기
              </button>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>
              {preview.sourceType} · {preview.extractionStatus} · {preview.previewSource}
              {preview.note ? ` · ${preview.note}` : ""}
            </p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                padding: 12,
                borderRadius: 6,
                maxHeight: "60vh",
                overflow: "auto",
                margin: 0
              }}
            >
              {preview.content || "(내용 없음)"}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
