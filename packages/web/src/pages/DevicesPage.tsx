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
      setLoadError(err instanceof Error ? err.message : "디바이스 목록을 불러오지 못했습니다.");
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
      setRevokeError(err instanceof Error ? err.message : "디바이스 연결 해제에 실패했습니다.");
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <div className="devices-page">
      <div className="devices-header">
        <h2>연결된 디바이스</h2>
      </div>

      {loadError ? (
        <p className="error-message">{loadError}</p>
      ) : isLoading ? (
        <p className="loading-message">디바이스 목록을 불러오는 중…</p>
      ) : devices.length === 0 ? (
        <div className="devices-empty">
          <h3>연결된 디바이스가 없습니다</h3>
          <p>
            로컬 컴퓨터에서 자소전 러너를 실행한 뒤 이 브라우저에서
            로그인하면 자동으로 연결됩니다.
          </p>
        </div>
      ) : (
        <table className="devices-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>OS</th>
              <th>연결 시각</th>
              <th>최근 접속</th>
              <th>상태</th>
              <th>작업</th>
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
                    <span className="badge badge--revoked">해제됨</span>
                  ) : (
                    <span className="badge badge--active">활성</span>
                  )}
                </td>
                <td>
                  {!device.revokedAt && (
                    <button
                      className="btn-danger-sm"
                      disabled={revokingId === device.id}
                      onClick={() => void handleRevoke(device.id)}
                    >
                      {revokingId === device.id ? "해제 중…" : "연결 해제"}
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
