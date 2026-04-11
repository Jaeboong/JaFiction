/**
 * DeviceOnboarding — Stage 11.9
 *
 * Rendered when bootstrap fails with reason "device_offline". Shows the
 * ConnectConsentModal so the user can auto-pair their already-running runner
 * with a single click.
 */
import type { BackendClient, RunnerClient } from "../../api/client";
import { ConnectConsentModal } from "./ConnectConsentModal";

export interface DeviceOnboardingProps {
  readonly client: BackendClient;
  readonly runnerClient?: RunnerClient;
}

// Minimal stub so ConnectConsentModal gets a RunnerClient even in contexts where
// no live runner exists yet (the post-approval poll will fail gracefully and the
// fallback window.location.reload() handles the transition).
function makeStubRunnerClient(baseUrl: string): RunnerClient {
  return {
    baseUrl,
    fetchState: async () => { throw new Error("no runner client"); },
  } as unknown as RunnerClient;
}

export function DeviceOnboarding({ client, runnerClient }: DeviceOnboardingProps) {
  const rc = runnerClient ?? makeStubRunnerClient(client.baseUrl);
  return <ConnectConsentModal backendClient={client} runnerClient={rc} />;
}
