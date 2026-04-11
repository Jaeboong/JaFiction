/**
 * DevicesPage — Phase 5
 *
 * Lists paired devices and allows pairing new ones or revoking existing ones.
 */
import { useEffect, useRef, useState } from "react";
import type { BackendClient, DeviceInfo } from "../api/client";

export interface DevicesPageProps {
  readonly client: BackendClient;
}

interface PairingState {
  readonly code: string;
  readonly expiresAt: number; // epoch ms
}

function usePairingCountdown(expiresAt: number | undefined): number {
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (expiresAt === undefined) return;

    const deadline = expiresAt;

    function tick() {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function DevicesPage({ client }: DevicesPageProps) {
  const [devices, setDevices] = useState<readonly DeviceInfo[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Pairing modal state
  const [showModal, setShowModal] = useState(false);
  const [pairingLabel, setPairingLabel] = useState("");
  const [pairingWorkspaceRoot, setPairingWorkspaceRoot] = useState("");
  const [pairingState, setPairingState] = useState<PairingState | undefined>();
  const [pairingError, setPairingError] = useState<string | undefined>();
  const [isPairing, setIsPairing] = useState(false);

  // Revoke state
  const [revokingId, setRevokingId] = useState<string | undefined>();
  const [revokeError, setRevokeError] = useState<string | undefined>();

  const codeRef = useRef<HTMLInputElement>(null);
  const secondsLeft = usePairingCountdown(pairingState?.expiresAt);

  async function loadDevices() {
    setIsLoading(true);
    setLoadError(undefined);
    try {
      const list = await client.listDevices();
      setDevices(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDevices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStartPairing() {
    if (!pairingLabel.trim() || !pairingWorkspaceRoot.trim()) {
      setPairingError("Label and workspace root are required.");
      return;
    }
    setIsPairing(true);
    setPairingError(undefined);
    try {
      const result = await client.startPairing({
        label: pairingLabel.trim(),
        workspaceRoot: pairingWorkspaceRoot.trim(),
      });
      setPairingState({
        code: result.code,
        expiresAt: new Date(result.expiresAt).getTime(),
      });
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : "Failed to start pairing");
    } finally {
      setIsPairing(false);
    }
  }

  function handleCopyCode() {
    if (pairingState?.code) {
      void navigator.clipboard.writeText(pairingState.code);
    }
  }

  function handleCloseModal() {
    setShowModal(false);
    setPairingState(undefined);
    setPairingLabel("");
    setPairingWorkspaceRoot("");
    setPairingError(undefined);
    void loadDevices();
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setRevokeError(undefined);
    try {
      await client.revokeDevice(id);
      await loadDevices();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Failed to revoke device");
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <div className="devices-page">
      <div className="devices-header">
        <h2>Paired Devices</h2>
        <button
          className="btn-primary"
          onClick={() => setShowModal(true)}
        >
          Pair new device
        </button>
      </div>

      {loadError ? (
        <p className="error-message">{loadError}</p>
      ) : isLoading ? (
        <p className="loading-message">Loading devices...</p>
      ) : devices.length === 0 ? (
        <p className="empty-message">No devices paired yet. Click "Pair new device" to get started.</p>
      ) : (
        <table className="devices-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Workspace Root</th>
              <th>Created</th>
              <th>Last Seen</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr
                key={device.id}
                className={device.revokedAt ? "device-row device-row--revoked" : "device-row"}
              >
                <td>{device.label}</td>
                <td>
                  <code className="workspace-root">{device.workspaceRoot}</code>
                </td>
                <td>{formatDate(device.createdAt)}</td>
                <td>{formatDate(device.lastSeenAt)}</td>
                <td>
                  {device.revokedAt ? (
                    <span className="badge badge--revoked">Revoked</span>
                  ) : (
                    <span className="badge badge--active">Active</span>
                  )}
                </td>
                <td>
                  {!device.revokedAt && (
                    <button
                      className="btn-danger-sm"
                      disabled={revokingId === device.id}
                      onClick={() => void handleRevoke(device.id)}
                    >
                      {revokingId === device.id ? "Revoking..." : "Revoke"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revokeError ? <p className="error-message">{revokeError}</p> : null}

      {showModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Pair new device">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Pair New Device</h3>
              <button
                className="modal-close"
                aria-label="Close"
                onClick={handleCloseModal}
              >
                &times;
              </button>
            </div>

            {!pairingState ? (
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="pairing-label">Device label</label>
                  <input
                    id="pairing-label"
                    type="text"
                    value={pairingLabel}
                    placeholder="e.g. My Work Laptop"
                    onChange={(e) => setPairingLabel(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="pairing-workspace">Workspace root path</label>
                  <input
                    id="pairing-workspace"
                    type="text"
                    value={pairingWorkspaceRoot}
                    placeholder="e.g. /home/user/projects"
                    onChange={(e) => setPairingWorkspaceRoot(e.target.value)}
                  />
                  <small>Absolute path on your local machine where projects live.</small>
                </div>
                {pairingError ? <p className="error-message">{pairingError}</p> : null}
                <div className="modal-actions">
                  <button
                    className="btn-secondary"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    disabled={isPairing}
                    onClick={() => void handleStartPairing()}
                  >
                    {isPairing ? "Generating code..." : "Generate pairing code"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-body">
                <p className="pairing-instructions">
                  Run the following command on your local machine:
                </p>
                <pre className="pairing-command">{[
                  `JAFICTION_MODE=pair \\`,
                  `JAFICTION_BACKEND_URL=${window.location.origin} \\`,
                  `JAFICTION_PAIRING_CODE=${pairingState.code} \\`,
                  `./scripts/with-npm.sh run -w packages/runner start`,
                ].join("\n")}</pre>

                <div className="pairing-code-display">
                  <span className="pairing-code-label">Pairing code:</span>
                  <span className="pairing-code-value">{pairingState.code}</span>
                  <input
                    ref={codeRef}
                    type="text"
                    readOnly
                    value={pairingState.code}
                    aria-label="Pairing code"
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                  />
                  <button className="btn-copy" onClick={handleCopyCode}>
                    Copy
                  </button>
                </div>

                <div className={`pairing-countdown ${secondsLeft <= 60 ? "pairing-countdown--urgent" : ""}`}>
                  {secondsLeft > 0 ? (
                    <>Code expires in <strong>{formatCountdown(secondsLeft)}</strong></>
                  ) : (
                    <strong>Code expired. Please generate a new one.</strong>
                  )}
                </div>

                <div className="modal-actions">
                  <button
                    className="btn-secondary"
                    onClick={handleCloseModal}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
