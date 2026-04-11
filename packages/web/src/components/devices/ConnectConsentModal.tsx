/**
 * ConnectConsentModal — Stage 11.9
 *
 * Rendered in the device_offline bootstrap branch. The user clicks Connect,
 * the backend matches a pending runner claim by source IP, approves it, and
 * the runner's polling loop picks up the token. We then poll get_state until
 * deviceAttached === true (or timeout).
 */
import { useState } from "react";
import type { BackendClient, ApproveDeviceClaimResult } from "../../api/client";
import type { RunnerClient } from "../../api/client";

export interface ConnectConsentModalProps {
  readonly backendClient: BackendClient;
  readonly runnerClient: RunnerClient;
}

type ModalState =
  | { readonly phase: "consent" }
  | { readonly phase: "connecting" }
  | { readonly phase: "no_runner" }
  | { readonly phase: "multiple_claims"; readonly claims: ReadonlyArray<{ readonly claimId: string; readonly hostname: string; readonly os: string }>; readonly selectedClaimId: string }
  | { readonly phase: "error"; readonly message: string };

const POLL_STATE_INTERVAL_MS = 500;
const POLL_STATE_TIMEOUT_MS = 10_000;

export function ConnectConsentModal({ backendClient, runnerClient }: ConnectConsentModalProps) {
  const [consented, setConsented] = useState(false);
  const [modalState, setModalState] = useState<ModalState>({ phase: "consent" });

  async function handleConnect(claimId?: string) {
    setModalState({ phase: "connecting" });

    let result: ApproveDeviceClaimResult;
    try {
      result = await backendClient.approveDeviceClaim(claimId);
    } catch (err) {
      setModalState({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to connect",
      });
      return;
    }

    if (result.status === "no_claim") {
      setModalState({ phase: "no_runner" });
      return;
    }

    if (result.status === "multiple_claims") {
      setModalState({
        phase: "multiple_claims",
        claims: result.claims,
        selectedClaimId: result.claims[0]?.claimId ?? "",
      });
      return;
    }

    // approved — poll get_state until deviceAttached
    const deadline = Date.now() + POLL_STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_STATE_INTERVAL_MS));
      try {
        const state = await runnerClient.fetchState();
        // deviceAttached is set by the backend once the runner connects via WS.
        // The SidebarState type may not have deviceAttached; treat its presence as truthy.
        const attached = (state as unknown as { deviceAttached?: boolean }).deviceAttached;
        if (attached) {
          // Modal dismisses itself by virtue of BootstrapGate re-bootstrapping.
          // Reload to re-trigger the bootstrap flow.
          window.location.reload();
          return;
        }
      } catch {
        // ignore transient errors during polling
      }
    }

    // Timed out — device paired but runner hasn't connected yet
    setModalState({
      phase: "error",
      message: "Runner paired but hasn't connected yet. Please wait a moment and reload.",
    });
  }

  if (modalState.phase === "multiple_claims") {
    return (
      <section className="app-gate app-gate-device" aria-labelledby="consent-heading">
        <p className="app-gate-kicker">Jasojeon</p>
        <h1 id="consent-heading">Connect your local environment</h1>
        <div className="app-gate-body">
          <p>Multiple runners were detected. Select one to connect:</p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {modalState.claims.map((c) => (
              <li key={c.claimId} style={{ marginBottom: "0.5rem" }}>
                <label>
                  <input
                    type="radio"
                    name="claim"
                    value={c.claimId}
                    checked={modalState.selectedClaimId === c.claimId}
                    onChange={() =>
                      setModalState({ ...modalState, selectedClaimId: c.claimId })
                    }
                  />{" "}
                  {c.hostname} ({c.os})
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="app-gate-cta"
            onClick={() => void handleConnect(modalState.selectedClaimId)}
          >
            Connect
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="app-gate app-gate-device" aria-labelledby="consent-heading">
      <p className="app-gate-kicker">Jasojeon</p>
      <h1 id="consent-heading">Connect your local environment</h1>

      {modalState.phase === "consent" && (
        <div className="app-gate-body" data-testid="device-onboarding-body">
          <p className="app-gate-description">
            Jasojeon uses a local CLI runner to read and write project files on
            your machine. The runner only talks to this website over an encrypted
            connection you approve.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0" }}>
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              data-testid="consent-checkbox"
            />
            I understand and consent
          </label>
          <button
            type="button"
            className="app-gate-cta"
            disabled={!consented}
            onClick={() => void handleConnect()}
            data-testid="connect-button"
          >
            Connect
          </button>
        </div>
      )}

      {modalState.phase === "connecting" && (
        <div className="app-gate-body" data-testid="connecting-body">
          <p className="app-gate-description">Connecting…</p>
        </div>
      )}

      {modalState.phase === "no_runner" && (
        <div className="app-gate-body" data-testid="no-runner-body">
          <p className="app-gate-description">
            We couldn't detect a runner on your machine. Start the runner and click Retry.
          </p>
          <p className="app-gate-description" style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>
            {/* Installer command will be added in Stage 11.6.B */}
            npx @jasojeon/runner
          </p>
          <button
            type="button"
            className="app-gate-cta"
            onClick={() => {
              setConsented(false);
              setModalState({ phase: "consent" });
            }}
            data-testid="retry-button"
          >
            Retry
          </button>
        </div>
      )}

      {modalState.phase === "error" && (
        <div className="app-gate-body" data-testid="error-body">
          <p className="app-gate-description error-message">{modalState.message}</p>
          <button
            type="button"
            className="app-gate-cta"
            onClick={() => {
              setConsented(false);
              setModalState({ phase: "consent" });
            }}
            data-testid="retry-button"
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
