import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown — sanitization", () => {
  it("renders bold markdown normally", () => {
    const html = renderMarkdown("Hello **world**");
    assert.match(html, /<strong>world<\/strong>/);
  });

  it("renders links with allowed protocol", () => {
    const html = renderMarkdown("[example](https://example.com)");
    assert.match(html, /<a href="https:\/\/example\.com"/);
    assert.match(html, /rel="noreferrer noopener"/);
  });

  it("renders inline code", () => {
    const html = renderMarkdown("use `const x = 1`");
    assert.match(html, /<code>const x = 1<\/code>/);
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconsole.log(1)\n```");
    assert.match(html, /<pre>/);
    assert.match(html, /<code/);
  });

  it("strips <script> tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    assert.ok(!html.includes("<script"), `Expected no <script> in: ${html}`);
    assert.ok(!html.includes("alert(1)") || html.includes("&lt;"), `Script content should be escaped: ${html}`);
  });

  it("neutralizes javascript: href", () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    // DOMPurify should remove the href or strip the anchor entirely
    assert.ok(
      !html.includes("javascript:"),
      `Expected no javascript: in: ${html}`
    );
  });

  it("strips onerror from img tags", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    // Safe outcome: either no <img> element at all, or the onerror attribute is stripped.
    // The renderer HTML-escapes raw HTML blocks so the tag renders as text — no live attribute.
    // We check that there is no unescaped <img ... onerror> element.
    const hasLiveOnerror = html.includes("<img") && html.includes("onerror=") && !html.includes("&lt;img");
    assert.ok(
      !hasLiveOnerror,
      `Expected no live onerror attribute, got: ${html}`
    );
  });

  it("strips <iframe> tags entirely", () => {
    const html = renderMarkdown("<iframe src='https://evil.com'></iframe>");
    assert.ok(!html.includes("<iframe"), `Expected no <iframe> in: ${html}`);
  });
});
