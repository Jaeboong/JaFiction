/**
 * DeviceOnboarding — Stage 11.5
 *
 * Rendered when bootstrap fails with reason "device_offline". The user is
 * authenticated but has no active runner connected to their account, so we
 * invite them to pair one. Internally reuses the existing DevicesPage
 * (pairing modal + device list) — it only needs a BackendClient, never a
 * RunnerClient, so it is safe in the offline gate.
 */
import type { BackendClient } from "../../api/client";
import { DevicesPage } from "../../pages/DevicesPage";

export interface DeviceOnboardingProps {
  readonly client: BackendClient;
}

export function DeviceOnboarding({ client }: DeviceOnboardingProps) {
  return (
    <section className="app-gate app-gate-device" aria-labelledby="device-onboarding-heading">
      <p className="app-gate-kicker">Jasojeon</p>
      <h1 id="device-onboarding-heading">연결된 러너가 없습니다.</h1>
      <p className="app-gate-description">
        계정에 연결된 활성 러너를 찾지 못했습니다. 아래에서 새 디바이스를 페어링하거나
        이미 페어링된 러너를 다시 실행해 주세요.
      </p>
      <div className="app-gate-body" data-testid="device-onboarding-body">
        <DevicesPage client={client} />
      </div>
    </section>
  );
}
