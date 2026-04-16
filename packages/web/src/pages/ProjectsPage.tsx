import type {
  JobPostingExtractionResult,
  ProjectInsightDocumentKey,
  ProjectInsightWorkspaceState,
  ProjectRecord,
  ProjectViewModel
} from "@jasojeon/shared";
import { useEffect, useRef, useState } from "react";
import { ConfirmDeleteModal } from "../components/ConfirmDeleteModal";
import { OpenDartCandidateModal } from "../components/OpenDartCandidateModal";
import { ProjectInsightModal } from "../components/ProjectInsightModal";
import { hasInsightDocuments, isInsightDocumentTitle } from "../insightDocuments";
import {
  formatDate,
  formatRelative,
  insightStatusLabel,
  sourceTypeLabel
} from "../formatters";
import "../styles/projects.css";

interface ProjectsPageProps {
  projects: ProjectViewModel[];
  selectedProjectSlug?: string;
  onSelectProject(projectSlug: string): void;
  onAnalyzePosting(payload: Record<string, unknown>): Promise<JobPostingExtractionResult>;
  onFetchProjectInsights(projectSlug: string): Promise<ProjectInsightWorkspaceState>;
  onCreateProject(payload: Record<string, unknown>): Promise<ProjectRecord | undefined>;
  onSaveProjectDocument(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onUploadProjectDocuments(projectSlug: string, files: File[]): Promise<void>;
  onUploadProjectFile(projectSlug: string, file: File, opts?: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal }): Promise<void>;
  onDeleteProjectDocument(projectSlug: string, documentId: string): Promise<void>;
  onUpdateProject(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onAnalyzeInsights(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onGenerateInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectInsightWorkspaceState | undefined>;
  onDeleteProject(projectSlug: string): Promise<void>;
}

export function ProjectsPage({
  projects,
  selectedProjectSlug,
  onSelectProject,
  onAnalyzePosting,
  onFetchProjectInsights,
  onCreateProject,
  onSaveProjectDocument,
  onUploadProjectDocuments,
  onUploadProjectFile,
  onDeleteProjectDocument,
  onUpdateProject,
  onAnalyzeInsights,
  onGenerateInsights,
  onDeleteProject
}: ProjectsPageProps) {
  const [workspaceMode, setWorkspaceMode] = useState<"project" | "create">(projects.length ? "project" : "create");
  const selectedProject = projects.find((project) => project.record.slug === selectedProjectSlug) ?? projects[0];

  useEffect(() => {
    if (!projects.length) {
      setWorkspaceMode("create");
      return;
    }

    if (!selectedProjectSlug || !projects.some((project) => project.record.slug === selectedProjectSlug)) {
      onSelectProject(projects[0].record.slug);
    }
  }, [onSelectProject, projects, selectedProjectSlug]);

  return (
    <section className="projects-page-shell">
      <aside className="projects-sidebar">
        <div className="projects-sidebar-top">
          <button className="projects-primary-button projects-primary-button-wide" onClick={() => setWorkspaceMode("create")}>
            <span className="projects-button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </span>
            새 지원서
          </button>
        </div>

        <div className="projects-sidebar-section">
          <div className="projects-sidebar-caption">최근 지원서</div>
          <div className="projects-sidebar-list">
            {projects.length ? projects.map((project) => {
              const effectiveInsightReady = hasInsightDocuments(project.documents) || project.record.insightStatus === "ready";
              const isActive = workspaceMode === "project" && project.record.slug === selectedProject?.record.slug;

              return (
                <button
                  key={project.record.slug}
                  className={`projects-project-card ${isActive ? "is-active" : ""}`}
                  onClick={() => {
                    setWorkspaceMode("project");
                    onSelectProject(project.record.slug);
                  }}
                >
                  <div className="projects-project-card-row">
                    <div className="projects-project-card-copy">
                      <strong>{project.record.companyName}</strong>
                      <span>{project.record.roleName ?? "직무 미정"}</span>
                      <small>{insightStatusLabel(effectiveInsightReady ? "ready" : project.record.insightStatus)}</small>
                    </div>
                    <span className={`projects-status-dot tone-${effectiveInsightReady ? "positive" : project.record.insightStatus === "error" ? "negative" : project.record.insightStatus === "generating" ? "warning" : "neutral"}`} />
                  </div>
                </button>
              );
            }) : (
              <div className="projects-sidebar-empty">
                아직 최근 지원서가 없습니다.
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="projects-main">
        {workspaceMode === "create" || !selectedProject ? (
          <CreateProjectWorkspace
            onAnalyzePosting={onAnalyzePosting}
            onCreateProject={onCreateProject}
            onProjectCreated={(projectSlug) => {
              setWorkspaceMode("project");
              onSelectProject(projectSlug);
            }}
            onCancel={() => {
              setWorkspaceMode("project");
              if (selectedProject?.record.slug) {
                onSelectProject(selectedProject.record.slug);
              }
            }}
          />
        ) : (
          <ProjectWorkspace
            key={selectedProject.record.slug}
            project={selectedProject}
            onFetchProjectInsights={onFetchProjectInsights}
            onSaveProjectDocument={onSaveProjectDocument}
            onUploadProjectDocuments={onUploadProjectDocuments}
            onUploadProjectFile={onUploadProjectFile}
            onDeleteProjectDocument={onDeleteProjectDocument}
            onUpdateProject={onUpdateProject}
            onAnalyzeInsights={onAnalyzeInsights}
            onGenerateInsights={onGenerateInsights}
            onDeleteProject={onDeleteProject}
          />
        )}
      </div>
    </section>
  );
}

function CreateProjectWorkspace({
  onAnalyzePosting,
  onCreateProject,
  onProjectCreated,
  onCancel
}: Pick<ProjectsPageProps, "onAnalyzePosting" | "onCreateProject"> & {
  onProjectCreated(projectSlug: string): void;
  onCancel(): void;
}) {
  const [jobPostingUrl, setJobPostingUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [essayQuestions, setEssayQuestions] = useState([""]);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "pending" | "ready" | "failed">("idle");
  const [analysisError, setAnalysisError] = useState<string | undefined>();
  const [analysisResult, setAnalysisResult] = useState<JobPostingExtractionResult | undefined>();

  const detailsUnlocked = analysisStatus === "ready" || analysisStatus === "failed";
  const questionCount = essayQuestions.filter((question) => question.trim().length > 0).length || essayQuestions.length;

  const handleAnalyzePosting = async () => {
    if (!jobPostingUrl.trim()) {
      setAnalysisStatus("failed");
      setAnalysisError("채용 공고 URL을 입력하세요.");
      setAnalysisResult(undefined);
      return;
    }

    setAnalysisStatus("pending");
    setAnalysisError(undefined);

    try {
      const result = await onAnalyzePosting({ jobPostingUrl });
      setAnalysisResult(result);
      setCompanyName(result.companyName ?? "");
      setRoleName(result.roleName ?? "");
      setDeadline(result.deadline ?? "");
      setAnalysisStatus("ready");
    } catch (error) {
      setAnalysisResult(undefined);
      setAnalysisStatus("failed");
      setAnalysisError(error instanceof Error ? error.message : String(error));
    }
  };

  const updateQuestion = (index: number, value: string) => {
    setEssayQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? value : question));
  };

  const addQuestion = () => {
    setEssayQuestions((current) => [...current, ""]);
  };

  const removeQuestion = (index: number) => {
    setEssayQuestions((current) => (current.length === 1 ? [""] : current.filter((_, questionIndex) => questionIndex !== index)));
  };

  const resetCreateForm = () => {
    setJobPostingUrl("");
    setCompanyName("");
    setRoleName("");
    setDeadline("");
    setEssayQuestions([""]);
    setAnalysisStatus("idle");
    setAnalysisError(undefined);
    setAnalysisResult(undefined);
  };

  return (
    <div className="projects-workspace projects-create-mode">
      <div className="projects-content-shell projects-create-shell">
        <header className="projects-page-header projects-create-header">
          <div>
            <h1>새 지원서 생성</h1>
            <p>채용 공고를 분석하여 평가를 위한 지원서를 설정합니다.</p>
          </div>
        </header>

        <div className="projects-step-stack">
          <section className="projects-step-section">
            <div className="projects-step-heading">
              <span className="projects-step-badge">1</span>
              <h2>공고 분석</h2>
            </div>

            <div className="projects-analyze-row">
              <div className="projects-url-field">
                <span className="projects-url-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </span>
                <input
                  type="url"
                  value={jobPostingUrl}
                  onChange={(event) => {
                    setJobPostingUrl(event.target.value);
                    if (analysisStatus !== "idle") {
                      setAnalysisStatus("idle");
                      setAnalysisError(undefined);
                      setAnalysisResult(undefined);
                    }
                  }}
                  placeholder="채용 공고 URL을 입력하세요"
                  spellCheck={false}
                />
              </div>

              <button
                className="projects-secondary-button"
                disabled={analysisStatus === "pending" || !jobPostingUrl.trim()}
                onClick={() => {
                  void handleAnalyzePosting();
                }}
              >
                {analysisStatus === "pending" ? "분석중..." : analysisStatus === "ready" ? "분석 완료" : "공고 분석"}
              </button>
            </div>
          </section>

          <div className="projects-divider" />

          <section className="projects-step-section">
            <div className="projects-step-heading">
              <span className="projects-step-badge projects-step-badge-active">2</span>
              <h2>지원서 정보</h2>
            </div>

            {detailsUnlocked ? (
              <div className={`projects-analysis-banner ${analysisStatus === "failed" ? "is-error" : ""}`}>
                <div className="projects-analysis-banner-icon" aria-hidden="true">
                  {analysisStatus === "failed" ? (
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" focusable="false">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  )}
                </div>
                <div>
                  <h4>{analysisStatus === "failed" ? "분석이 완료되지 않았습니다." : "AI 분석이 완료되었습니다."}</h4>
                  <p>
                    {analysisStatus === "failed"
                      ? "공고 페이지 분석에 실패했습니다. 회사명과 직무명을 직접 수정한 뒤 진행하세요."
                      : "공고 페이지에서 회사명과 직무명을 추출했습니다. 내용이 정확한지 확인하고 필요한 경우 수정해주세요."}
                  </p>
                </div>
              </div>
            ) : null}

            {analysisError ? <p className="projects-analysis-error">{analysisError}</p> : null}

            {analysisResult?.warnings.length ? (
              <ul className="projects-analysis-warnings">
                {analysisResult.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className="projects-form-grid">
              <label className="projects-field">
                <span>회사명</span>
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
              </label>
              <label className="projects-field">
                <span>직무명</span>
                <input value={roleName} onChange={(event) => setRoleName(event.target.value)} />
              </label>
              <label className="projects-field">
                <span>마감기한</span>
                <input
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  placeholder="2026년 04월 19일, 23:59"
                />
              </label>
            </div>
          </section>

          <section className="projects-step-section projects-question-section">
            <div className="projects-step-heading projects-step-heading-spaced">
              <div className="projects-step-heading-row">
                <span className="projects-step-badge projects-step-badge-active">3</span>
                <h2>자기소개서 문항 설정</h2>
              </div>
              <span className="projects-step-count">총 {questionCount}개 문항</span>
            </div>

            <div className="projects-question-card">
              <div className="projects-question-list">
                {essayQuestions.map((question, index) => (
                  <div key={`question-${index}`} className="projects-question-row">
                    <div className="projects-question-index">{String(index + 1).padStart(2, "0")}</div>
                    <textarea
                      rows={index === essayQuestions.length - 1 ? 1 : 2}
                      value={question}
                      onChange={(event) => updateQuestion(index, event.target.value)}
                      placeholder="문항 내용을 입력하세요"
                    />
                    <button
                      className="projects-question-delete"
                      disabled={essayQuestions.length === 1}
                      onClick={() => removeQuestion(index)}
                      title="문항 삭제"
                      type="button"
                    >
                      <svg viewBox="0 0 24 24" focusable="false">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button className="projects-add-question" onClick={addQuestion} type="button">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                새 문항 추가
              </button>
            </div>
          </section>
        </div>

        <div className="projects-create-actions">
          <button className="projects-text-button" onClick={() => {
            resetCreateForm();
            onCancel();
          }}>
            취소
          </button>
          <button
            className="projects-primary-button projects-primary-button-lg"
            disabled={!detailsUnlocked}
            onClick={() => {
              void onCreateProject({
                companyName,
                roleName,
                deadline: deadline || undefined,
                jobPostingUrl,
                overview: analysisResult?.overview,
                mainResponsibilities: analysisResult?.mainResponsibilities,
                qualifications: analysisResult?.qualifications,
                preferredQualifications: analysisResult?.preferredQualifications,
                benefits: analysisResult?.benefits,
                hiringProcess: analysisResult?.hiringProcess,
                insiderView: analysisResult?.insiderView,
                otherInfo: analysisResult?.otherInfo,
                keywords: analysisResult?.keywords,
                jobPostingText: analysisResult?.normalizedText,
                essayQuestions
              }).then((project) => {
                if (!project) {
                  return;
                }
                resetCreateForm();
                onProjectCreated(project.slug);
              });
            }}
          >
            지원서 생성
          </button>
        </div>
      </div>
    </div>
  );
}

interface UploadingItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  progress: number;
  readonly abortController: AbortController;
}

function ProjectWorkspace({
  project,
  onFetchProjectInsights,
  onSaveProjectDocument,
  onUploadProjectDocuments,
  onUploadProjectFile,
  onDeleteProjectDocument,
  onUpdateProject,
  onAnalyzeInsights,
  onGenerateInsights,
  onDeleteProject
}: {
  project: ProjectViewModel;
  onFetchProjectInsights(projectSlug: string): Promise<ProjectInsightWorkspaceState>;
  onSaveProjectDocument(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onUploadProjectDocuments(projectSlug: string, files: File[]): Promise<void>;
  onUploadProjectFile(projectSlug: string, file: File, opts?: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal }): Promise<void>;
  onDeleteProjectDocument(projectSlug: string, documentId: string): Promise<void>;
  onUpdateProject(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onAnalyzeInsights(projectSlug: string, payload: Record<string, unknown>): Promise<void>;
  onGenerateInsights(projectSlug: string, payload: Record<string, unknown>): Promise<ProjectInsightWorkspaceState | undefined>;
  onDeleteProject(projectSlug: string): Promise<void>;
}) {
  const [title, setTitle] = useState("notes.md");
  const [content, setContent] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [uploadError, setUploadError] = useState<string | undefined>();
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [isInsightModalOpen, setIsInsightModalOpen] = useState(false);
  const [insightModalStatus, setInsightModalStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [insightModalError, setInsightModalError] = useState<string | undefined>();
  const [insightWorkspace, setInsightWorkspace] = useState<ProjectInsightWorkspaceState | undefined>();
  const [selectedInsightTab, setSelectedInsightTab] = useState<ProjectInsightDocumentKey | undefined>();
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  const sawGeneratingStatusRef = useRef(false);
  const [isDartModalOpen, setIsDartModalOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editRoleName, setEditRoleName] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editJobPostingUrl, setEditJobPostingUrl] = useState("");
  const [editEssayQuestions, setEditEssayQuestions] = useState<string[]>([""]);
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // state_snapshot 으로 insightStatus 가 generating 을 거친 뒤 벗어나면 낙관적 잠금 해제
  // pending → generating → ready/error 순서를 기다리므로, generating 을 보기 전에는 해제하지 않음
  useEffect(() => {
    if (!isGeneratingInsights) {
      sawGeneratingStatusRef.current = false;
      return;
    }
    const status = project.record.insightStatus;
    if (status === "generating") {
      sawGeneratingStatusRef.current = true;
    } else if (sawGeneratingStatusRef.current) {
      setIsGeneratingInsights(false);
    }
  }, [isGeneratingInsights, project.record.insightStatus]);

  const projectHasInsightDocuments = hasInsightDocuments(project.documents);
  const contextDocuments = project.documents.filter((document) => !isInsightDocumentTitle(document.title));
  const isInsightReady = project.record.insightStatus === "ready" || projectHasInsightDocuments;
  const isInsightGenerationPending = isGeneratingInsights || project.record.insightStatus === "generating";
  const insightStatusNote = buildInsightStatusNote(project.record);

  const handleFileSelection = (incoming: FileList | File[]) => {
    const { acceptedFiles, rejectedNames } = partitionContextUploadFiles(Array.from(incoming));

    if (acceptedFiles.length > 0) {
      setSelectedFiles((current) => mergeSelectedFiles(current, acceptedFiles));
      setUploadStatus("idle");
      setUploadError(undefined);
    }

    if (rejectedNames.length > 0) {
      setUploadStatus("failed");
      setUploadError(`지원하지 않는 형식은 제외했습니다: ${rejectedNames.join(", ")}`);
      return;
    }

    if (!acceptedFiles.length) {
      setUploadStatus("failed");
      setUploadError("업로드 가능한 파일을 선택하세요.");
    }
  };

  const handleUpload = async () => {
    if (!selectedFiles.length) {
      setUploadStatus("failed");
      setUploadError("업로드할 파일을 먼저 선택하세요.");
      return;
    }

    setUploadStatus("pending");
    setUploadError(undefined);

    try {
      await onUploadProjectDocuments(project.record.slug, selectedFiles);
      setSelectedFiles([]);
      setUploadStatus("idle");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setUploadStatus("failed");
      setUploadError(error instanceof Error ? error.message : String(error));
    }
  };

  const startSingleUpload = (file: File) => {
    const ctrl = new AbortController();
    const id = `upl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setUploadingItems((prev) => [...prev, { id, name: file.name, size: file.size, progress: 0, abortController: ctrl }]);

    void onUploadProjectFile(project.record.slug, file, {
      onProgress: (sent, total) => {
        const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
        setUploadingItems((prev) => prev.map((item) => item.id === id ? { ...item, progress: pct } : item));
      },
      signal: ctrl.signal
    }).finally(() => {
      setUploadingItems((prev) => prev.filter((item) => item.id !== id));
    });
  };

  const handleFilesDropped = (files: File[]) => {
    const { acceptedFiles, rejectedNames } = partitionContextUploadFiles(files);

    if (rejectedNames.length > 0) {
      setUploadError(`지원하지 않는 형식은 제외했습니다: ${rejectedNames.join(", ")}`);
    } else {
      setUploadError(undefined);
    }

    for (const file of acceptedFiles) {
      startSingleUpload(file);
    }
  };

  const handleSaveTextDocument = async () => {
    if (!title.trim()) {
      return;
    }

    try {
      await onSaveProjectDocument(project.record.slug, {
        title,
        content,
        pinnedByDefault: true
      });
      setTitle("notes.md");
      setContent("");
    } catch {
      // Global action notice already reports the failure.
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!window.confirm("이 문서를 삭제하시겠습니까? 되돌릴 수 없습니다.")) {
      return;
    }
    await onDeleteProjectDocument(project.record.slug, documentId);
  };

  const handleStartEditInfo = () => {
    setEditCompanyName(project.record.companyName);
    setEditRoleName(project.record.roleName ?? "");
    setEditDeadline(project.record.deadline ?? "");
    setEditJobPostingUrl(project.record.jobPostingUrl ?? "");
    setEditEssayQuestions(project.record.essayQuestions?.length ? [...project.record.essayQuestions] : [""]);
    setIsEditingInfo(true);
  };

  const handleSaveInfo = async () => {
    setIsSavingInfo(true);
    try {
      await onUpdateProject(project.record.slug, {
        ...project.record,
        companyName: editCompanyName,
        roleName: editRoleName || undefined,
        deadline: editDeadline || undefined,
        jobPostingUrl: editJobPostingUrl || undefined,
        essayQuestions: editEssayQuestions.filter((q) => q.trim())
      });
      setIsEditingInfo(false);
    } catch {
      // Global action notice already reports the failure.
    } finally {
      setIsSavingInfo(false);
    }
  };

  const applyInsightWorkspace = (
    workspace: ProjectInsightWorkspaceState,
    preferredKey?: ProjectInsightDocumentKey
  ) => {
    setInsightWorkspace(workspace);
    setSelectedInsightTab(selectInsightTab(workspace, preferredKey));
    setInsightModalStatus("ready");
    setInsightModalError(undefined);
  };

  const loadInsightWorkspace = async () => {
    setInsightModalStatus("loading");
    setInsightModalError(undefined);

    try {
      const workspace = await onFetchProjectInsights(project.record.slug);
      applyInsightWorkspace(workspace, selectedInsightTab);
    } catch (error) {
      setInsightModalStatus("error");
      setInsightModalError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenInsightModal = () => {
    setIsInsightModalOpen(true);
    void loadInsightWorkspace();
  };

  const startInsightGeneration = async () => {
    setIsGeneratingInsights(true);

    try {
      const workspace = await onGenerateInsights(project.record.slug, {});
      if (workspace) {
        applyInsightWorkspace(workspace, selectedInsightTab);
      } else {
        setIsGeneratingInsights(false);
      }
    } catch (error) {
      setIsGeneratingInsights(false);
      throw error;
    }
  };

  const handleGenerateInsights = async () => {
    if (isInsightGenerationPending) {
      return;
    }
    if (project.record.openDartCandidates?.length) {
      setIsDartModalOpen(true);
      return;
    }
    await startInsightGeneration();
  };

  const handleRegenerateInsights = async () => {
    if (isInsightGenerationPending) {
      return;
    }
    if (project.record.openDartCandidates?.length) {
      setIsDartModalOpen(true);
      return;
    }
    setIsGeneratingInsights(true);
    if (isInsightModalOpen) {
      setInsightModalStatus("loading");
      setInsightModalError(undefined);
    }

    try {
      const workspace = await onGenerateInsights(project.record.slug, {});
      if (workspace) {
        applyInsightWorkspace(workspace, selectedInsightTab);
        setIsInsightModalOpen(true);
        // 버튼은 state_snapshot 으로 insightStatus 가 바뀔 때 useEffect 에서 해제됨.
      } else {
        // runAction 이 오류를 삼킨 뒤 undefined 반환 → 즉시 해제
        setIsGeneratingInsights(false);
        if (!insightWorkspace) {
          setInsightModalStatus("error");
          setInsightModalError("인사이트 재생성 결과를 확인하지 못했습니다.");
        }
      }
    } catch (error) {
      setIsGeneratingInsights(false);
      throw error;
    }
  };

  const handleDartCandidateConfirm = async (corpCode: string) => {
    setIsDartModalOpen(false);
    await onUpdateProject(project.record.slug, { openDartCorpCode: corpCode });
    await startInsightGeneration();
  };

  const handleDartSkip = async () => {
    setIsDartModalOpen(false);
    await onUpdateProject(project.record.slug, {
      openDartCandidates: null,
      openDartSkipRequested: true
    });
    await startInsightGeneration();
  };

  return (
    <>
      <div className="projects-workspace projects-workspace-mode">
        <div className="projects-content-shell projects-workspace-shell">
          <header className="projects-page-header projects-workspace-header">
            <div className="projects-workspace-heading">
              <h1>{project.record.companyName}</h1>
              <p className="projects-page-subtitle">문서 워크스페이스</p>
              {insightStatusNote ? (
                <p className={`projects-page-meta ${project.record.insightStatus === "error" ? "is-error" : ""}`}>
                  {insightStatusNote}
                  {project.record.openDartCandidates?.length ? (
                    <button
                      type="button"
                      className="projects-page-meta-action"
                      onClick={() => setIsDartModalOpen(true)}
                    >
                      회사 선택
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="projects-header-actions">
              <div className="projects-header-action-row">
                <button
                  className="projects-secondary-button"
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  프로젝트 삭제
                </button>
                <button className="projects-secondary-button" onClick={() => void onAnalyzeInsights(project.record.slug, {})}>
                  공고 분석
                </button>
                {isInsightReady ? (
                  <>
                    <button className="projects-secondary-button" disabled={isInsightGenerationPending} onClick={() => {
                      void handleRegenerateInsights();
                    }}>
                      {isInsightGenerationPending ? "다시 생성중..." : "다시 생성"}
                    </button>
                    <button className="projects-primary-button" disabled={insightModalStatus === "loading"} onClick={handleOpenInsightModal}>
                      {insightModalStatus === "loading" && isInsightModalOpen ? "불러오는 중..." : "인사이트 보기"}
                    </button>
                  </>
                ) : (
                  <button
                    className="projects-primary-button"
                    disabled={isInsightGenerationPending}
                    onClick={() => {
                      void handleGenerateInsights();
                    }}
                  >
                    {isInsightGenerationPending ? "인사이트 생성중..." : "인사이트 생성"}
                  </button>
                )}
              </div>
              {isInsightReady ? (
                <span className="projects-header-status">
                  <span className="projects-header-status-dot" />
                  인사이트가 최신 상태입니다.
                </span>
              ) : null}
            </div>
          </header>

          <div className="projects-stat-strip">
            <article className="projects-stat-card">
              <div className="projects-stat-icon tone-indigo" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <span>직무</span>
                <strong>{project.record.roleName ?? "직무 미정"}</strong>
              </div>
            </article>
            <article className="projects-stat-card">
              <div className="projects-stat-icon tone-blue" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div>
                <span>컨텍스트 문서</span>
                <strong>{contextDocuments.length}<span className="projects-stat-unit">개</span></strong>
              </div>
            </article>
            <article className="projects-stat-card">
              <div className="projects-stat-icon tone-amber" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M5 12l5 5l10 -10" />
                </svg>
              </div>
              <div>
                <span>실행 수</span>
                <strong>{project.runs.length}<span className="projects-stat-unit">회</span></strong>
              </div>
            </article>
            <article className="projects-stat-card">
              <div className="projects-stat-icon tone-emerald" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div>
                <span>인사이트 상태</span>
                <strong className="projects-stat-strong-emerald">
                  {isGeneratingInsights && project.record.insightStatus !== "generating"
                    ? "요청 중..."
                    : insightStatusLabel(project.record.insightStatus)}
                </strong>
              </div>
            </article>
          </div>

          <section className="projects-panel projects-info-panel">
            <div className="projects-panel-header">
              <h2>지원서 기본 정보</h2>
              {isEditingInfo ? (
                <div className="projects-info-edit-actions">
                  <button className="projects-panel-link" type="button" disabled={isSavingInfo} onClick={() => setIsEditingInfo(false)}>
                    취소
                  </button>
                  <button className="projects-panel-link projects-panel-link-primary" type="button" disabled={isSavingInfo || !editCompanyName.trim()} onClick={() => { void handleSaveInfo(); }}>
                    {isSavingInfo ? "저장 중..." : "저장"}
                  </button>
                </div>
              ) : (
                <button className="projects-panel-link" type="button" onClick={handleStartEditInfo}>
                  수정
                </button>
              )}
            </div>
            {isEditingInfo ? (
              <div className="projects-info-edit-form">
                <div className="projects-info-grid">
                  <div className="projects-info-field">
                    <span>회사명</span>
                    <input
                      className="projects-info-input"
                      value={editCompanyName}
                      onChange={(e) => setEditCompanyName(e.target.value)}
                      placeholder="회사명을 입력하세요"
                    />
                  </div>
                  <div className="projects-info-field">
                    <span>직무명</span>
                    <input
                      className="projects-info-input"
                      value={editRoleName}
                      onChange={(e) => setEditRoleName(e.target.value)}
                      placeholder="직무명을 입력하세요"
                    />
                  </div>
                  <div className="projects-info-field">
                    <span>마감기한</span>
                    <input
                      className="projects-info-input"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                      placeholder="2026년 04월 19일, 23:59"
                    />
                  </div>
                  <div className="projects-info-field">
                    <span>채용공고 URL</span>
                    <input
                      className="projects-info-input"
                      value={editJobPostingUrl}
                      onChange={(e) => setEditJobPostingUrl(e.target.value)}
                      placeholder="https://..."
                      type="url"
                    />
                  </div>
                  <InfoField label="생성 / 수정일" value={`${formatDate(project.record.createdAt)} | ${formatRelative(project.record.updatedAt)}`} />
                </div>
                <div className="projects-question-preview">
                  <p className="projects-question-preview-title">자기소개서 문항</p>
                  <div className="projects-question-list">
                    {editEssayQuestions.map((question, index) => (
                      <div key={index} className="projects-question-row">
                        <span className="projects-question-index">{String(index + 1).padStart(2, "0")}</span>
                        <textarea
                          value={question}
                          rows={2}
                          onChange={(e) => {
                            const next = [...editEssayQuestions];
                            next[index] = e.target.value;
                            setEditEssayQuestions(next);
                          }}
                          placeholder="문항 내용을 입력하세요"
                        />
                        <button
                          className="projects-question-delete"
                          type="button"
                          onClick={() => setEditEssayQuestions((current) => current.length === 1 ? [""] : current.filter((_, i) => i !== index))}
                          aria-label="문항 삭제"
                        >
                          <svg viewBox="0 0 24 24" focusable="false"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="projects-add-question"
                    type="button"
                    onClick={() => setEditEssayQuestions((current) => [...current, ""])}
                  >
                    <svg viewBox="0 0 24 24" focusable="false"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    문항 추가
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="projects-info-grid">
                  <InfoField label="회사명" value={project.record.companyName} />
                  <InfoField label="직무명" value={project.record.roleName ?? "직무 미정"} />
                  <InfoField label="마감기한" value={project.record.deadline ?? "미정"} />
                  <div className="projects-info-field">
                    <span>채용공고 URL</span>
                    {project.record.jobPostingUrl ? (
                      <a
                        className="projects-info-link"
                        href={project.record.jobPostingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {project.record.jobPostingUrl}
                      </a>
                    ) : (
                      <strong>연결된 공고 없음</strong>
                    )}
                  </div>
                  <InfoField label="생성 / 수정일" value={`${formatDate(project.record.createdAt)} | ${formatRelative(project.record.updatedAt)}`} />
                </div>

                {(project.record.overview || project.record.mainResponsibilities || project.record.qualifications || project.record.preferredQualifications || project.record.benefits || project.record.hiringProcess || project.record.insiderView || project.record.otherInfo) ? (
                  <div className="projects-posting-sections">
                    {project.record.overview && (
                      <PostingSection label="공고 개요" content={project.record.overview} />
                    )}
                    {project.record.mainResponsibilities && (
                      <PostingSection label="담당 업무" content={project.record.mainResponsibilities} />
                    )}
                    {project.record.qualifications && (
                      <PostingSection label="자격 요건" content={project.record.qualifications} />
                    )}
                    {project.record.preferredQualifications && (
                      <PostingSection label="우대 사항" content={project.record.preferredQualifications} />
                    )}
                    {project.record.benefits && (
                      <PostingSection label="복리후생" content={project.record.benefits} />
                    )}
                    {project.record.hiringProcess && (
                      <PostingSection label="채용 절차" content={project.record.hiringProcess} />
                    )}
                    {project.record.insiderView && (
                      <PostingSection label="재직자 시각" content={project.record.insiderView} />
                    )}
                    {project.record.otherInfo && (
                      <PostingSection label="기타 정보" content={project.record.otherInfo} />
                    )}
                  </div>
                ) : null}

                {project.record.essayQuestions?.length ? (
                  <div className="projects-question-preview">
                    <p className="projects-question-preview-title">자기소개서 문항 (총 {project.record.essayQuestions.length}문항)</p>
                    <div className="projects-question-preview-list">
                      {project.record.essayQuestions.map((question, index) => (
                        <div key={`${question}-${index}`} className="projects-question-preview-row">
                          <span className="projects-question-preview-index">{String(index + 1).padStart(2, "0")}</span>
                          <p>{question}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section
            className={`projects-panel projects-document-panel ${isDragOver ? "is-drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (e.dataTransfer.files.length) {
                handleFilesDropped(Array.from(e.dataTransfer.files));
              }
            }}
          >
            <div className="projects-panel-header projects-panel-header-column">
              <div>
                <h2>컨텍스트 문서</h2>
                <p>자소서 작성 및 평가에 활용될 이력서, 포트폴리오, 경험 정리 문서입니다.</p>
              </div>
              <button
                className="projects-secondary-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                + 파일 추가
              </button>
            </div>

            <input
              ref={fileInputRef}
              className="projects-hidden-input"
              type="file"
              accept={projectContextUploadAccept}
              multiple
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  handleFilesDropped(Array.from(event.target.files));
                }
                event.target.value = "";
              }}
            />

            {uploadError ? <p className="projects-error-text">{uploadError}</p> : null}

            {contextDocuments.length === 0 && uploadingItems.length === 0 ? (
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
                <span>PDF, PPTX, MD, TXT, 이미지 · 최대 {UPLOAD_DOCUMENT_MAX_MB}MB</span>
              </button>
            ) : (
              <div className="projects-table-wrap">
                <table className="projects-doc-table">
                  <thead>
                    <tr>
                      <th />
                      <th>문서 제목</th>
                      <th>유형</th>
                      <th>생성일</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {uploadingItems.map((item) => (
                      <tr key={item.id} className="projects-uploading-row">
                        <td>
                          <span className="projects-upload-spinner" aria-hidden="true" />
                        </td>
                        <td>
                          <strong>{item.name}</strong>
                          <span className="projects-upload-progress">{item.progress}%</span>
                        </td>
                        <td>{formatFileSize(item.size)}</td>
                        <td>업로드 중...</td>
                        <td className="projects-doc-actions">
                          <button
                            className="projects-chip-button"
                            type="button"
                            onClick={() => item.abortController.abort()}
                          >
                            중단
                          </button>
                        </td>
                      </tr>
                    ))}
                    {contextDocuments.length ? contextDocuments.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <button className="projects-star-button" type="button" disabled aria-label="즐겨찾기">
                            <svg viewBox="0 0 24 24" focusable="false">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                        </td>
                        <td>
                          <strong>{document.title}</strong>
                        </td>
                        <td>
                          <span className={`projects-doc-type tone-${sourceTypeToTone(document.sourceType)}`}>{sourceTypeLabel(document.sourceType)}</span>
                        </td>
                        <td>{formatDate(document.createdAt)}</td>
                        <td className="projects-doc-actions">
                          <button
                            className="projects-delete-button"
                            type="button"
                            aria-label="삭제"
                            onClick={() => { void handleDeleteDocument(document.id); }}
                          >
                            <svg viewBox="0 0 24 24" focusable="false">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )) : null}
                    {project.documents.length > 0 && contextDocuments.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="projects-empty-inline">
                            일반 컨텍스트 문서가 없습니다. 생성된 인사이트는 &apos;인사이트 보기&apos;에서 확인할 수 있습니다.
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="projects-panel projects-tool-panel">
            <div className="projects-panel-header projects-panel-header-column">
              <div>
                <h2>텍스트 문서 직접 추가</h2>
                <p>간단한 메모나 텍스트를 직접 입력하여 문서로 추가합니다.</p>
              </div>
            </div>

            <div className="projects-text-form">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="문서 제목을 입력하세요" />
              <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="내용을 입력하세요..." rows={10} style={{ minHeight: "12rem", resize: "vertical" }} />
            </div>

            <div className="projects-tool-panel-footer">
              <button
                className="projects-secondary-button projects-secondary-button-wide"
                disabled={!title.trim()}
                onClick={() => {
                  void handleSaveTextDocument();
                }}
                type="button"
              >
                문서 추가
              </button>
            </div>
          </section>
        </div>
      </div>

      <ProjectInsightModal
        isOpen={isInsightModalOpen}
        status={insightModalStatus === "idle" ? "ready" : insightModalStatus}
        workspace={insightWorkspace}
        selectedTab={selectedInsightTab}
        errorMessage={insightModalError}
        regeneratePending={isInsightGenerationPending}
        onClose={() => setIsInsightModalOpen(false)}
        onReload={() => {
          void loadInsightWorkspace();
        }}
        onRegenerate={() => {
          void handleRegenerateInsights();
        }}
        onSelectTab={setSelectedInsightTab}
      />

      <ConfirmDeleteModal
        isOpen={isDeleteModalOpen}
        title="프로젝트 삭제"
        message={`${project.record.companyName} 프로젝트와 관련된 모든 문서·실행 기록이 영구 삭제됩니다.`}
        confirmPhrase={project.record.companyName}
        onCancel={() => setIsDeleteModalOpen(false)}
        onConfirm={async () => {
          await onDeleteProject(project.record.slug);
          setIsDeleteModalOpen(false);
        }}
      />

      {project.record.openDartCandidates?.length ? (
        <OpenDartCandidateModal
          isOpen={isDartModalOpen}
          companyName={project.record.companyName}
          candidates={project.record.openDartCandidates}
          onCancel={() => setIsDartModalOpen(false)}
          onConfirm={handleDartCandidateConfirm}
          onSkipDart={handleDartSkip}
        />
      ) : null}
    </>
  );
}

function InfoField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="projects-info-field">
      <span>{label}</span>
      <strong className={mono ? "is-mono" : undefined}>{value}</strong>
    </div>
  );
}

function PostingSection({ label, content }: { label: string; content: string }) {
  return (
    <div className="projects-posting-section">
      <p className="projects-posting-section-label">{label}</p>
      <div className="projects-posting-section-content">
        {content.split("\n").map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function selectInsightTab(
  workspace: ProjectInsightWorkspaceState,
  preferredKey?: ProjectInsightDocumentKey
): ProjectInsightDocumentKey {
  if (preferredKey && workspace.documents.some((document) => document.key === preferredKey)) {
    return preferredKey;
  }

  return workspace.documents.find((document) => document.available)?.key
    ?? workspace.documents[0]?.key
    ?? "company";
}

function buildInsightStatusNote(project: ProjectViewModel["record"]): string | undefined {
  const messages: string[] = [];

  if (project.insightLastGeneratedAt) {
    messages.push(`최근 생성 ${formatDate(project.insightLastGeneratedAt)}`);
  }

  if (project.insightLastError) {
    messages.push(project.insightLastError);
  }

  return messages.length > 0 ? messages.join(" · ") : undefined;
}

function sourceTypeToTone(sourceType: string): string {
  switch (sourceType) {
    case "pdf":
    case "pptx":
      return "red";
    case "md":
      return "blue";
    case "txt":
    case "text":
    case "image":
    case "other":
      return "slate";
    default:
      return "slate";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

// Kept inline — shared constant not re-exported across vite bundle boundary.
const UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const UPLOAD_DOCUMENT_MAX_MB = Math.floor(UPLOAD_DOCUMENT_CHUNK_MAX_TOTAL_BYTES / (1024 * 1024));

const supportedContextUploadExtensions = new Set([
  ".pdf",
  ".pptx",
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg"
]);

const projectContextUploadAccept = [
  ".pdf",
  ".pptx",
  ".md",
  ".markdown",
  ".txt",
  ".text",
  "image/*"
].join(",");

function partitionContextUploadFiles(files: File[]): { acceptedFiles: File[]; rejectedNames: string[] } {
  const acceptedFiles: File[] = [];
  const rejectedNames: string[] = [];

  for (const file of files) {
    if (supportedContextUploadExtensions.has(getFileExtension(file.name))) {
      acceptedFiles.push(file);
      continue;
    }
    rejectedNames.push(file.name);
  }

  return { acceptedFiles, rejectedNames };
}

function mergeSelectedFiles(current: File[], incoming: File[]): File[] {
  const bucket = new Map<string, File>();
  for (const file of [...current, ...incoming]) {
    bucket.set(buildSelectedFileKey(file), file);
  }
  return Array.from(bucket.values());
}

function buildSelectedFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}
