/**
 * BootstrapGate — Stage 11.5
 *
 * Pure presentational switch that picks the correct gated body for the
 * bootstrap shell. Kept as its own module so it can be unit-tested with
 * react-dom/server without pulling in the full App tree (effects, sockets,
 * routers).
 */
import type { ReactNode } from "react";
import type { BackendClient, RunnerBootstrapErrorReason } from "../api/client";
import { LoginGate } from "./auth/LoginGate";
import { DeviceOnboarding } from "./devices/DeviceOnboarding";

export interface BootstrapGateProps {
  readonly reason: RunnerBootstrapErrorReason | undefined;
  readonly errorMessage: string | undefined;
  readonly runnerBaseUrl: string;
  readonly backendClient: BackendClient;
  readonly onRetry: () => void;
  readonly sessionExpired?: boolean;
}

export function BootstrapGate({
  reason,
  errorMessage,
  runnerBaseUrl,
  backendClient,
  onRetry,
  sessionExpired = false
}: BootstrapGateProps): ReactNode {
  if (reason === "auth_required") {
    return <LoginGate sessionExpired={sessionExpired} />;
  }
  if (reason === "device_offline") {
    return <DeviceOnboarding client={backendClient} onConnected={onRetry} />;
  }
  if (reason === "network_error") {
    return (
      <section className="app-gate app-gate-network" aria-labelledby="network-gate-heading">
        <p className="app-gate-kicker">자소전</p>
        <h1 id="network-gate-heading">네트워크에 연결할 수 없습니다.</h1>
        <p className="app-gate-description">
          {errorMessage ?? `백엔드 ${runnerBaseUrl} 에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.`}
        </p>
        <button type="button" className="app-gate-cta" onClick={onRetry} data-testid="network-gate-retry">
          다시 시도
        </button>
      </section>
    );
  }
  if (reason === "unknown") {
    return (
      <section className="app-gate app-gate-unknown" aria-labelledby="unknown-gate-heading">
        <p className="app-gate-kicker">자소전</p>
        <h1 id="unknown-gate-heading">연결에 실패했습니다.</h1>
        <p className="app-gate-description">{errorMessage ?? "알 수 없는 오류가 발생했습니다."}</p>
        <button type="button" className="app-gate-cta" onClick={onRetry} data-testid="unknown-gate-retry">
          다시 시도
        </button>
      </section>
    );
  }
  return (
    <section className="app-loading-card" data-testid="bootstrap-gate-pending">
      <p className="app-loading-kicker">자소전</p>
      <h1>러너와 연결 중입니다.</h1>
      <p>{errorMessage ?? `시도 중: ${runnerBaseUrl}`}</p>
    </section>
  );
}
