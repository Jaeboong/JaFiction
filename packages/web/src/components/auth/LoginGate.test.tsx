/**
 * LoginGate.test.tsx — Stage 11.5
 *
 * Uses react-dom/server#renderToStaticMarkup (no new devDependency) to pin
 * that the LoginGate surfaces a real anchor pointing at /auth/google. If
 * this test regresses, the OAuth CTA is broken and hosted users are locked
 * out.
 */
import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginGate } from "./LoginGate";

describe("LoginGate", () => {
  it("renders an anchor to /auth/google by default", () => {
    const html = renderToStaticMarkup(<LoginGate />);
    assert.match(html, /href="\/auth\/google"/);
    assert.match(html, /data-testid="login-gate-cta"/);
  });

  it("respects a custom loginHref", () => {
    const html = renderToStaticMarkup(<LoginGate loginHref="/auth/github" />);
    assert.match(html, /href="\/auth\/github"/);
  });

  it("renders the Korean heading and description", () => {
    const html = renderToStaticMarkup(<LoginGate />);
    assert.match(html, /로그인/);
    assert.match(html, /Jasojeon/);
  });
});
