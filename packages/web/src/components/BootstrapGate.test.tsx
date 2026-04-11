/**
 * BootstrapGate.test.tsx — Stage 11.5
 *
 * Verifies that the bootstrap shell surfaces a distinct inner CTA for each
 * RunnerBootstrapError reason. Rendered with react-dom/server to keep the
 * tests hermetic (no effects, no sockets, no new devDependency).
 *
 * The shell chrome (header + tabs) is rendered in App.tsx; this test asserts
 * the gate body picker, which is the actual branching logic. The App-level
 * invariant (Header always rendered) is reviewed separately in the plan.
 */
import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { BootstrapGate } from "./BootstrapGate";
import { BackendClient } from "../api/client";

const backendStub = new BackendClient("http://hosted.test");
const noop = () => undefined;

describe("BootstrapGate", () => {
  it("renders a LoginGate for reason 'auth_required'", () => {
    const html = renderToStaticMarkup(
      <BootstrapGate
        reason="auth_required"
        errorMessage={undefined}
        runnerBaseUrl="http://hosted.test"
        backendClient={backendStub}
        onRetry={noop}
      />
    );
    assert.match(html, /data-testid="login-gate-cta"/);
    assert.match(html, /href="\/auth\/google"/);
  });

  it("renders the DeviceOnboarding body for reason 'device_offline'", () => {
    const html = renderToStaticMarkup(
      <BootstrapGate
        reason="device_offline"
        errorMessage={undefined}
        runnerBaseUrl="http://hosted.test"
        backendClient={backendStub}
        onRetry={noop}
      />
    );
    assert.match(html, /data-testid="device-onboarding-body"/);
    assert.match(html, /연결된 러너가 없습니다/);
  });

  it("renders the network retry card for reason 'network_error'", () => {
    const html = renderToStaticMarkup(
      <BootstrapGate
        reason="network_error"
        errorMessage="fetch failed"
        runnerBaseUrl="http://hosted.test"
        backendClient={backendStub}
        onRetry={noop}
      />
    );
    assert.match(html, /data-testid="network-gate-retry"/);
    assert.match(html, /fetch failed/);
  });

  it("renders the unknown retry card for reason 'unknown'", () => {
    const html = renderToStaticMarkup(
      <BootstrapGate
        reason="unknown"
        errorMessage="boom"
        runnerBaseUrl="http://hosted.test"
        backendClient={backendStub}
        onRetry={noop}
      />
    );
    assert.match(html, /data-testid="unknown-gate-retry"/);
    assert.match(html, /boom/);
  });

  it("renders the legacy pending card when no reason is known yet", () => {
    const html = renderToStaticMarkup(
      <BootstrapGate
        reason={undefined}
        errorMessage={undefined}
        runnerBaseUrl="http://hosted.test"
        backendClient={backendStub}
        onRetry={noop}
      />
    );
    assert.match(html, /data-testid="bootstrap-gate-pending"/);
    assert.match(html, /시도 중/);
  });
});
