import React, { useEffect, useRef, useState } from "react";
import type { BackendClient, ApproveDeviceClaimResult } from "../../api/client";
import { RunnerClient } from "../../api/client";

export interface ConnectConsentModalProps {
  readonly backendClient: BackendClient;
  readonly runnerClient: RunnerClient;
  readonly onConnected: () => void;
}

type ModalState =
  | { readonly phase: "consent" }
  | { readonly phase: "connecting" }
  | { readonly phase: "no_runner"; readonly step: 1 | 2 | 3 }
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
const POLL_CLAIM_INTERVAL_MS = 3_000;

type DetectedOS = "windows" | "mac" | "linux";

function detectOS(): DetectedOS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
  return "linux";
}

function getDownloadUrl(backendBaseUrl: string, os: DetectedOS): string {
  return `${backendBaseUrl}/api/runner/download?os=${os}`;
}

function triggerDownload(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const OS_LABEL: Record<DetectedOS, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
};

const STEP_LABELS = ["소개", "설치", "연결"];

interface StepIndicatorProps {
  readonly current: 1 | 2 | 3;
}

function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <div className="runner-install-steps">
      {STEP_LABELS.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3;
        const isDone = num < current;
        const isActive = num === current;
        return (
          <React.Fragment key={num}>
            <div
              className={`runner-install-step-dot${isActive ? " active" : isDone ? " done" : ""}`}
            >
              <span>{isDone ? "✓" : num}</span>
              <span>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`runner-install-step-line${isDone ? " done" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

interface RunnerInstallGuideProps {
  readonly step: 1 | 2 | 3;
  readonly os: DetectedOS;
  readonly downloadUrl: string;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onConnected: () => void;
  readonly backendClient: BackendClient;
  readonly runnerClient: RunnerClient;
}

function RunnerInstallGuide({
  step,
  os,
  downloadUrl,
  onNext,
  onBack,
  onConnected,
  backendClient,
  runnerClient,
}: RunnerInstallGuideProps) {
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasDownloadedRef = useRef(false);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (step !== 3) return;

    if (!hasDownloadedRef.current) {
      hasDownloadedRef.current = true;
      triggerDownload(downloadUrl);
    }

    pollingRef.current = setInterval(() => {
      void (async () => {
        let result: ApproveDeviceClaimResult;
        try {
          result = await backendClient.approveDeviceClaim();
        } catch {
          return;
        }

        if (result.status !== "approved" && result.status !== "authorized") return;

        const deadline = Date.now() + POLL_STATE_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await new Promise<void>((resolve) => setTimeout(resolve, POLL_STATE_INTERVAL_MS));
          try {
            await RunnerClient.bootstrap(runnerClient.baseUrl);
            if (pollingRef.current) clearInterval(pollingRef.current);
            onConnectedRef.current();
            return;
          } catch {
            // still waiting
          }
        }
      })();
    }, POLL_CLAIM_INTERVAL_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [step, downloadUrl, backendClient, runnerClient]);

  if (step === 1) {
    return (
      <>
        <StepIndicator current={1} />
        <img
          src="/download.webp"
          alt="러너 소개"
          className="runner-install-img"
        />
        <p className="app-gate-description">
          자소전 러너는 이 컴퓨터의 파일을 읽고 쓸 수 있도록 백그라운드에서
          실행되는 작은 프로그램입니다. 한 번 설치하면 PC를 켤 때마다 자동으로
          실행됩니다.
        </p>
        <div className="runner-install-actions">
          <button type="button" className="runner-install-btn runner-install-btn-prev" onClick={onBack}>
            ← 이전
          </button>
          <button type="button" className="runner-install-btn runner-install-btn-next" onClick={onNext}>
            다음 →
          </button>
        </div>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <StepIndicator current={2} />
        <img
          src="/click.webp"
          alt="설치 방법"
          className="runner-install-img"
        />
        <p className="app-gate-description">
          다운로드된 파일을 실행하세요.
          {os === "windows" && (
            <> 파란 보안 경고창이 뜨면 <strong>추가 정보</strong>를 클릭한 뒤 <strong>실행</strong>을 선택하세요.</>
          )}
          {os === "mac" && (
            <> 처음 실행 시 <strong>시스템 설정 → 개인정보 보호 및 보안</strong>에서 허용해 주세요.</>
          )}
        </p>
        <div className="runner-install-actions">
          <button type="button" className="runner-install-btn runner-install-btn-prev" onClick={onBack}>
            ← 이전
          </button>
          <button type="button" className="runner-install-btn runner-install-btn-next" onClick={onNext}>
            다음 →
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <StepIndicator current={3} />
      <img
        src="/installing.webp"
        alt="다운로드 및 연결"
        className="runner-install-img"
      />
      <div className="runner-install-waiting">
        <div className="runner-install-spinner" />
        <span>러너를 실행하면 자동으로 연결됩니다…</span>
      </div>
      <p className="runner-install-fallback">
        다운로드가 자동으로 시작되지 않으면{" "}
        <a href={downloadUrl} onClick={(e) => { e.preventDefault(); triggerDownload(downloadUrl); }}>
          여기를 클릭하세요
        </a>
      </p>
      <div className="runner-install-actions">
        <button type="button" className="runner-install-btn runner-install-btn-prev" onClick={onBack}>
          ← 이전
        </button>
      </div>
    </>
  );
}

export function ConnectConsentModal({ backendClient, runnerClient, onConnected }: ConnectConsentModalProps) {
  const [consented, setConsented] = useState(false);
  const [modalState, setModalState] = useState<ModalState>({ phase: "consent" });
  const os = detectOS();
  const downloadUrl = getDownloadUrl(backendClient.baseUrl, os);

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
      setModalState({ phase: "no_runner", step: 1 });
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

    if (result.status !== "approved" && result.status !== "authorized") {
      setModalState({
        phase: "error",
        message: "연결 승인 응답을 처리하지 못했습니다.",
      });
      return;
    }

    const deadline = Date.now() + POLL_STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_STATE_INTERVAL_MS));
      try {
        await RunnerClient.bootstrap(runnerClient.baseUrl);
        onConnected();
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
        <p className="app-gate-kicker">자소전</p>
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
      <p className="app-gate-kicker">자소전</p>
      <h1 id="consent-heading">
        {modalState.phase === "no_runner"
          ? `로컬 러너 설치 (${OS_LABEL[os]})`
          : "로컬 환경에 연결"}
      </h1>

      {modalState.phase === "consent" && (
        <div className="app-gate-body" data-testid="device-onboarding-body">
          <p className="app-gate-description">
            자소전은 로컬 CLI 러너를 통해 이 컴퓨터의 프로젝트 파일을 읽고
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
          <RunnerInstallGuide
            step={modalState.step}
            os={os}
            downloadUrl={downloadUrl}
            onNext={() => setModalState({ phase: "no_runner", step: (modalState.step + 1) as 2 | 3 })}
            onBack={() => {
              if (modalState.step === 1) {
                setConsented(false);
                setModalState({ phase: "consent" });
              } else {
                setModalState({ phase: "no_runner", step: (modalState.step - 1) as 1 | 2 });
              }
            }}
            onConnected={onConnected}
            backendClient={backendClient}
            runnerClient={runnerClient}
          />
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
