import { useState } from "react";
import type { BackendClient, ApproveDeviceClaimResult } from "../../api/client";
import { RunnerClient } from "../../api/client";

export interface ConnectConsentModalProps {
  readonly backendClient: BackendClient;
  readonly runnerClient: RunnerClient;
}

type ModalState =
  | { readonly phase: "consent" }
  | { readonly phase: "connecting" }
  | { readonly phase: "no_runner" }
  | {
      readonly phase: "multiple_claims";
      readonly claims: ReadonlyArray<{
        readonly claimId: string;
        readonly hostname: string;
        readonly os: string;
      }>;
      readonly selectedClaimId: string;
    }
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
        message: err instanceof Error ? err.message : "연결에 실패했습니다.",
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

    const deadline = Date.now() + POLL_STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_STATE_INTERVAL_MS));
      try {
        await RunnerClient.bootstrap(runnerClient.baseUrl);
        window.location.reload();
        return;
      } catch {
        // device still not attached — keep polling
      }
    }

    setModalState({
      phase: "error",
      message: "러너 연결을 대기 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }

  if (modalState.phase === "multiple_claims") {
    return (
      <section className="app-gate app-gate-device" aria-labelledby="consent-heading">
        <p className="app-gate-kicker">Jasojeon</p>
        <h1 id="consent-heading">연결할 러너를 선택하세요</h1>
        <div className="app-gate-body">
          <p className="app-gate-description">
            여러 러너가 감지되었습니다. 연결할 러너를 선택해 주세요.
          </p>
          <ul className="app-gate-claims">
            {modalState.claims.map((c) => (
              <li key={c.claimId}>
                <label>
                  <input
                    type="radio"
                    name="claim"
                    value={c.claimId}
                    checked={modalState.selectedClaimId === c.claimId}
                    onChange={() =>
                      setModalState({ ...modalState, selectedClaimId: c.claimId })
                    }
                  />
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
            연결
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="app-gate app-gate-device" aria-labelledby="consent-heading">
      <p className="app-gate-kicker">Jasojeon</p>
      <h1 id="consent-heading">로컬 환경에 연결</h1>

      {modalState.phase === "consent" && (
        <div className="app-gate-body" data-testid="device-onboarding-body">
          <p className="app-gate-description">
            Jasojeon은 로컬 CLI 러너를 통해 이 컴퓨터의 프로젝트 파일을 읽고
            씁니다. 러너는 사용자가 승인한 암호화 연결로만 이 웹사이트와
            통신합니다.
          </p>
          <label className="app-gate-consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              data-testid="consent-checkbox"
            />
            <span>이해했으며 연결에 동의합니다.</span>
          </label>
          <button
            type="button"
            className="app-gate-cta"
            disabled={!consented}
            onClick={() => void handleConnect()}
            data-testid="connect-button"
          >
            연결
          </button>
        </div>
      )}

      {modalState.phase === "connecting" && (
        <div className="app-gate-body" data-testid="connecting-body">
          <p className="app-gate-description">연결 중…</p>
        </div>
      )}

      {modalState.phase === "no_runner" && (
        <div className="app-gate-body" data-testid="no-runner-body">
          <p className="app-gate-description">
            러너를 감지하지 못했습니다. 로컬에서 러너를 실행한 뒤 다시 시도해
            주세요.
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
            다시 시도
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
            다시 시도
          </button>
        </div>
      )}
    </section>
  );
}
