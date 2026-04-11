import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { Renderer, marked, type Tokens } from "marked";

// ---------------------------------------------------------------------------
// DOMPurify config — lock down once at module scope, never rebuild per call.
// Use DOMPurify's safe defaults (which already strip <script>, event handlers,
// and javascript: URLs), then explicitly forbid the few tags we never want.
// ---------------------------------------------------------------------------
const PURIFY_CONFIG: DOMPurifyConfig = {
  // Explicit deny-list on top of DOMPurify safe defaults
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea"],
  FORBID_ATTR: ["style", "ping"],
  // Allow rel explicitly (DOMPurify may not include it in its default safe list)
  ADD_ATTR: ["rel"],
  // Forbid data: URIs
  ALLOW_DATA_ATTR: false,
  FORCE_BODY: false
};

// ---------------------------------------------------------------------------
// Marked renderer — manual first-pass URL sanitization (belt) before
// DOMPurify runs as the second pass (suspenders).
// ---------------------------------------------------------------------------
const allowedLinkProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(raw: string, kind: "link" | "image"): string | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("?") ||
    value.startsWith("//")
  ) {
    return escapeHtml(value);
  }

  try {
    const parsed = new URL(value);
    const isAllowed = kind === "image"
      ? parsed.protocol === "http:" || parsed.protocol === "https:"
      : allowedLinkProtocols.has(parsed.protocol);
    return isAllowed ? escapeHtml(value) : undefined;
  } catch {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) ? undefined : escapeHtml(value);
  }
}

// Use property assignment (not class methods) so marked.use() can enumerate them.
// marked.use({ renderer }) only picks up own enumerable properties — prototype
// methods from class `extends` are NOT enumerable and will be silently ignored.
const markdownRenderer = new Renderer();

markdownRenderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escapeHtml(text);

markdownRenderer.link = function (this: Renderer, { href, title, tokens }: Tokens.Link): string {
  const safeHref = sanitizeUrl(href, "link");
  const label = this.parser.parseInline(tokens);
  if (!safeHref) {
    return label;
  }
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${safeHref}"${titleAttribute} rel="noreferrer noopener">${label}</a>`;
};

markdownRenderer.image = ({ href, title, text }: Tokens.Image): string => {
  const safeHref = sanitizeUrl(href, "image");
  if (!safeHref) {
    return escapeHtml(text);
  }
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<img src="${safeHref}" alt="${escapeHtml(text)}"${titleAttribute}>`;
};

marked.use({ async: false, breaks: true, gfm: true, renderer: markdownRenderer });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render markdown to sanitized HTML.
 *
 * Two-pass safety:
 *   1. marked renderer rewrites link/image hrefs with an allow-list.
 *   2. DOMPurify strips any remaining dangerous tags/attributes.
 */
export function renderMarkdown(raw: string): string {
  const parsed = marked.parse(raw);
  const html = typeof parsed === "string" ? parsed.trim() : "";
  const sanitized = DOMPurify.sanitize(html, PURIFY_CONFIG);
  return typeof sanitized === "string" ? sanitized : String(sanitized);
}
