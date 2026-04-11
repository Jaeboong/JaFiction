/**
 * ConnectConsentModal.test.tsx — Stage 11.9
 *
 * Tests the consent modal's initial render state.
 * Uses renderToStaticMarkup (no extra devDependency) — hooks return their
 * initial values in SSR, so we can pin the visible copy and test IDs.
 *
 * Interaction tests (click → approved → poll) require a browser environment;
 * those are covered by manual acceptance testing per the plan.
 */
import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectConsentModal } from "./ConnectConsentModal";
import type { BackendClient, RunnerClient } from "../../api/client";

const backendStub = {
  baseUrl: "http://backend.test",
  approveDeviceClaim: async () => ({ status: "no_claim" as const }),
} as unknown as BackendClient;

const runnerStub = {
  baseUrl: "http://backend.test",
  fetchState: async () => { throw new Error("no runner"); },
} as unknown as RunnerClient;

describe("ConnectConsentModal", () => {
  it("renders with consent checkbox and disabled Connect button in initial state", () => {
    const html = renderToStaticMarkup(
      <ConnectConsentModal backendClient={backendStub} runnerClient={runnerStub} onConnected={() => undefined} />
    );
    assert.match(html, /data-testid="device-onboarding-body"/);
    assert.match(html, /data-testid="consent-checkbox"/);
    assert.match(html, /data-testid="connect-button"/);
    // Connect button should be disabled (checked=false → consented=false initially)
    assert.match(html, /disabled/);
  });

  it("renders the consent copy explaining what the runner does", () => {
    const html = renderToStaticMarkup(
      <ConnectConsentModal backendClient={backendStub} runnerClient={runnerStub} onConnected={() => undefined} />
    );
    assert.match(html, /로컬 환경에 연결/);
    assert.match(html, /로컬 CLI 러너/);
    assert.match(html, /연결에 동의합니다/);
  });

  it("renders the Connect button", () => {
    const html = renderToStaticMarkup(
      <ConnectConsentModal backendClient={backendStub} runnerClient={runnerStub} onConnected={() => undefined} />
    );
    assert.match(html, /data-testid="connect-button"/);
  });
});
