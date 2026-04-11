/**
 * DevicesPage — Stage 11.9
 *
 * Lists connected devices. Pairing is now fully automatic (see ConnectConsentModal).
 * This page only shows connected devices and allows disconnecting them.
 */
import { useEffect, useState } from "react";
import type { BackendClient, DeviceInfo } from "../api/client";

export interface DevicesPageProps {
  readonly client: BackendClient;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function DevicesPage({ client }: DevicesPageProps) {
  const [devices, setDevices] = useState<readonly DeviceInfo[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | undefined>();
  const [revokeError, setRevokeError] = useState<string | undefined>();

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

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setRevokeError(undefined);
    try {
      await client.revokeDevice(id);
      await loadDevices();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Failed to disconnect device");
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <div className="devices-page">
      <div className="devices-header">
        <h2>Connected Devices</h2>
      </div>

      {loadError ? (
        <p className="error-message">{loadError}</p>
      ) : isLoading ? (
        <p className="loading-message">Loading devices...</p>
      ) : devices.length === 0 ? (
        <div className="devices-empty">
          <h3>No device connected</h3>
          <p>
            Start the Jasojeon runner on your machine to begin. Once running,
            log in on this browser and we'll connect automatically.
          </p>
        </div>
      ) : (
        <table className="devices-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>OS</th>
              <th>Connected</th>
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
                <td>{device.os ?? "—"}</td>
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
                      {revokingId === device.id ? "Disconnecting..." : "Disconnect"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revokeError ? <p className="error-message">{revokeError}</p> : null}
    </div>
  );
}
