import type {
  ProjectInsightDocumentKey,
  ProjectInsightWorkspaceState
} from "@jafiction/shared";
import { Fragment, type ReactNode, useEffect } from "react";
import { formatDate, formatRelative } from "../formatters";
import "../styles/insight-modal.css";

type InsightModalStatus = "loading" | "ready" | "error";

interface ProjectInsightModalProps {
  isOpen: boolean;
  status: InsightModalStatus;
  workspace?: ProjectInsightWorkspaceState;
  selectedTab?: ProjectInsightDocumentKey;
  errorMessage?: string;
  regeneratePending?: boolean;
  onClose(): void;
  onReload(): void;
  onRegenerate(): void;
  onSelectTab(key: ProjectInsightDocumentKey): void;
}

export function ProjectInsightModal({
  isOpen,
  status,
  workspace,
  selectedTab,
  errorMessage,
  regeneratePending = false,
  onClose,
  onReload,
  onRegenerate,
  onSelectTab
}: ProjectInsightModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const activeDocument = workspace?.documents.find((document) => document.key === selectedTab)
    ?? workspace?.documents[0];
  const showLoadingBanner = status === "loading" && Boolean(workspace);
  const showErrorBanner = status === "error" && Boolean(workspace) && Boolean(errorMessage);

  const modalTitle = workspace
    ? `${workspace.companyName}${workspace.roleName ? ` ${workspace.roleName}` : ""} - AI 분석 인사이트`
    : "AI 분석 인사이트";

  return (
    <div
      className="insight-modal-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-modal-title"
      onClick={onClose}
    >
      <div className="insight-modal" onClick={(event) => event.stopPropagation()}>

        {/* ── Header ── */}
        <header className="insight-modal-header">
          <div className="insight-modal-header-left">
            <div className="insight-modal-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 2v20" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <h2 id="insight-modal-title">{modalTitle}</h2>
          </div>

          <div className="insight-modal-actions">
            <button
              className="insight-modal-action-button is-secondary"
              disabled={status === "loading"}
              onClick={onReload}
            >
              새로고침
            </button>
            <button
              className="insight-modal-action-button is-primary"
              disabled={regeneratePending}
              onClick={onRegenerate}
            >
              {regeneratePending ? "생성 중..." : "다시 생성"}
            </button>
            <div className="insight-modal-header-divider" aria-hidden="true" />
            <button
              className="insight-modal-close-button"
              onClick={onClose}
              aria-label="닫기"
              title="닫기"
            >
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="insight-modal-body">

          {/* ── Sidebar ── */}
          <aside className="insight-modal-sidebar">
            <div className="insight-modal-sidebar-header">
              <span>인사이트 목록</span>
            </div>

            {workspace ? (
              <div className="insight-tab-list" role="tablist" aria-label="인사이트 문서 목록">
                {workspace.documents.map((document) => (
                  <button
                    key={document.key}
                    className={`insight-tab-button ${document.key === activeDocument?.key ? "is-active" : ""}`}
                    onClick={() => onSelectTab(document.key)}
                    role="tab"
                    aria-selected={document.key === activeDocument?.key}
                  >
                    <div className="insight-tab-icon-row">
                      <InsightTabIcon docKey={document.key} />
                      <strong>{document.tabLabel}</strong>
                    </div>
                    <p>{document.available ? document.fileName : "다음 생성 작업에서 채워집니다."}</p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="insight-sidebar-placeholder">
                {status === "error"
                  ? "문서 목록을 불러오지 못했습니다."
                  : "문서 목록을 불러오는 중입니다."}
              </div>
            )}
          </aside>

          {/* ── Content ── */}
          <section className="insight-modal-content">

            {/* No workspace yet: loading or error placeholder */}
            {!workspace ? (
              <div className="insight-content-placeholder">
                {status === "loading" ? (
                  <div className="insight-empty-state">
                    <h2>인사이트를 불러오는 중입니다.</h2>
                    <p>생성된 문서를 가져오는 동안 잠시만 기다려 주세요.</p>
                  </div>
                ) : null}
                {status === "error" ? (
                  <div className="insight-empty-state">
                    <h2>인사이트를 열지 못했습니다.</h2>
                    <p>{errorMessage ?? "문서를 다시 불러오거나 잠시 후 다시 시도해 주세요."}</p>
                    <div className="insight-empty-actions">
                      <button className="insight-modal-action-button is-secondary" onClick={onReload}>
                        다시 불러오기
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Workspace available: sticky section header + scroll area */}
            {workspace && activeDocument ? (
              <>
                <div className="insight-content-section-header">
                  <h3>{activeDocument.title}</h3>
                  {workspace.insightLastGeneratedAt ? (
                    <div className="insight-content-meta-row">
                      <div className="insight-content-meta-item">
                        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {formatDate(workspace.insightLastGeneratedAt)}
                      </div>
                      <div className="insight-content-meta-dot" aria-hidden="true" />
                      <div className="insight-content-meta-item">
                        {formatRelative(workspace.insightLastGeneratedAt)}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="insight-content-scroll">
                  <div className="insight-content-md-wrapper">
                    {showLoadingBanner ? (
                      <div className="insight-content-banner">
                        최신 인사이트를 다시 불러오는 중입니다.
                      </div>
                    ) : null}
                    {showErrorBanner ? (
                      <div className="insight-content-banner is-error">
                        {errorMessage}
                      </div>
                    ) : null}
                    {activeDocument.available ? (
                      <InsightMarkdown content={activeDocument.content} />
                    ) : (
                      <div className="insight-empty-state">
                        <h2>아직 생성되지 않았습니다.</h2>
                        <p>{activeDocument.tabLabel} 문서는 다음 생성 작업에서 채워집니다.</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}

          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Tab icons ── */

function InsightTabIcon({ docKey }: { docKey: ProjectInsightDocumentKey }) {
  switch (docKey) {
    case "strategy":
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "question":
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "company":
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "job":
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
  }
}

/* ── Markdown renderer ── */

function InsightMarkdown({ content }: { content: string }) {
  const blocks = parseInsightMarkdown(content);

  return (
    <article className="markdown-content insight-markdown">
      {blocks.map((block, index) => renderMarkdownBlock(block, index))}
    </article>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "code"; language?: string; content: string }
  | { type: "hr" };

function parseInsightMarkdown(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  let paragraphLines: string[] = [];
  let listType: "unordered-list" | "ordered-list" | undefined;
  let listItems: string[] = [];
  let quoteLines: string[] = [];
  let codeLanguage = "";
  let codeLines: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = undefined;
      listItems = [];
      return;
    }
    blocks.push({ type: listType, items: [...listItems] });
    listType = undefined;
    listItems = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) {
      return;
    }
    blocks.push({ type: "blockquote", lines: [...quoteLines] });
    quoteLines = [];
  };

  const flushCode = () => {
    blocks.push({
      type: "code",
      language: codeLanguage || undefined,
      content: codeLines.join("\n")
    });
    codeLanguage = "";
    codeLines = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    const unorderedListMatch = /^[-*+]\s+(.*)$/.exec(line);
    const orderedListMatch = /^\d+\.\s+(.*)$/.exec(line);
    const quoteMatch = /^>\s?(.*)$/.exec(line);
    const codeFenceMatch = /^```(.*)$/.exec(line.trim());
    const isHorizontalRule = /^-{3,}$/.test(line.trim());

    if (codeFenceMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      if (inCodeFence) {
        flushCode();
        inCodeFence = false;
      } else {
        codeLanguage = codeFenceMatch[1].trim();
        codeLines = [];
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (isHorizontalRule) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "hr" });
      continue;
    }

    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      continue;
    }

    if (unorderedListMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "unordered-list") {
        flushList();
      }
      listType = "unordered-list";
      listItems.push(unorderedListMatch[1].trim());
      continue;
    }

    if (orderedListMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ordered-list") {
        flushList();
      }
      listType = "ordered-list";
      listItems.push(orderedListMatch[1].trim());
      continue;
    }

    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1].trim());
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushQuote();

  if (inCodeFence) {
    flushCode();
  }

  return blocks;
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      if (block.level === 1) {
        return <h1 key={index}>{renderInlineMarkdown(block.text)}</h1>;
      }
      if (block.level === 2) {
        return <h2 key={index}>{renderInlineMarkdown(block.text)}</h2>;
      }
      return <h3 key={index}>{renderInlineMarkdown(block.text)}</h3>;
    }
    case "paragraph":
      return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
    case "unordered-list":
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    case "ordered-list":
      return (
        <ol key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote key={index}>
          {block.lines.map((line, lineIndex) => (
            <p key={`${index}-${lineIndex}`}>{renderInlineMarkdown(line)}</p>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={index}>
          <code>{block.content}</code>
        </pre>
      );
    case "hr":
      return <hr key={index} />;
    default:
      return null;
  }
}

const inlineMarkdownPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(inlineMarkdownPattern)) {
    if (match.index === undefined) {
      continue;
    }

    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`code-${tokenIndex}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${tokenIndex}`}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = /^\[(.*?)\]\((.*?)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(
          <a key={`link-${tokenIndex}`} href={linkMatch[2]} rel="noreferrer" target="_blank">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(<Fragment key={`text-${tokenIndex}`}>{token}</Fragment>);
      }
    }

    cursor = match.index + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}
