import { useEffect, useState } from "react";
import type { BackendClient, DeviceInfo } from "../../api/client";
import { ConfirmDeleteAccountModal } from "./ConfirmDeleteAccountModal";

interface Props {
  readonly email: string;
  readonly backendClient: BackendClient;
  readonly onClose: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function detectOS(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "windows";
  if (ua.includes("Mac")) return "mac";
  if (ua.includes("Linux")) return "linux";
  return "linux";
}

export function MyInfoTab({ email, backendClient, onClose }: Props) {
  const [devices, setDevices] = useState<readonly DeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [revokingId, setRevokingId] = useState<string | undefined>();
  const [revokeError, setRevokeError] = useState<string | undefined>();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const initial = email.charAt(0).toUpperCase();

  async function loadDevices() {
    setIsLoading(true);
    setLoadError(undefined);
    try {
      const list = await backendClient.listDevices();
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
      await backendClient.revokeDevice(id);
      await loadDevices();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "디바이스 연결 해제에 실패했습니다.");
    } finally {
      setRevokingId(undefined);
    }
  }

  function handleDownloadRunner() {
    const os = detectOS();
    window.open(`${backendClient.baseUrl}/api/runner/download?os=${os}`);
  }

  return (
    <>
      <div className="profile-modal-header">
        <div className="profile-modal-avatar" aria-hidden="true">{initial}</div>
        <div className="profile-modal-header-info">
          <div className="profile-modal-header-email">{email}</div>
          <div className="profile-modal-header-sub">Google 계정으로 연결됨</div>
        </div>
      </div>

      <div className="profile-modal-section">
        <h3 className="profile-modal-section-title">연결된 디바이스</h3>
        {loadError ? (
          <p className="profile-modal-error">{loadError}</p>
        ) : isLoading ? (
          <p className="profile-modal-empty">디바이스 목록을 불러오는 중…</p>
        ) : devices.length === 0 ? (
          <p className="profile-modal-empty">연결된 디바이스가 없습니다.</p>
        ) : (
          devices.map((device) => (
            <div key={device.id} className="profile-modal-device-row">
              <div className="profile-modal-device-info">
                <div className="profile-modal-device-name">{device.label}</div>
                <div className="profile-modal-device-meta">
                  {device.os ?? "—"} · 마지막 접속: {formatDate(device.lastSeenAt)}
                </div>
              </div>
              {!device.revokedAt && (
                <button
                  type="button"
                  className="profile-modal-device-revoke"
                  disabled={revokingId === device.id}
                  onClick={() => { void handleRevoke(device.id); }}
                >
                  {revokingId === device.id ? "해제 중…" : "해제"}
                </button>
              )}
            </div>
          ))
        )}
        {revokeError ? <p className="profile-modal-error">{revokeError}</p> : null}
      </div>

      <div className="profile-modal-section">
        <h3 className="profile-modal-section-title">러너 설치</h3>
        <button
          type="button"
          className="profile-modal-download-btn"
          onClick={handleDownloadRunner}
        >
          러너 다운로드
        </button>
      </div>

      <div className="profile-modal-danger-zone">
        <p className="profile-modal-danger-title">위험 구역</p>
        <p className="profile-modal-danger-desc">
          계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.
        </p>
        <button
          type="button"
          className="profile-modal-danger-btn"
          onClick={() => { setIsDeleteModalOpen(true); }}
        >
          계정 삭제
        </button>
      </div>

      <ConfirmDeleteAccountModal
        isOpen={isDeleteModalOpen}
        email={email}
        backendClient={backendClient}
        onClose={() => { setIsDeleteModalOpen(false); }}
      />
    </>
  );
}
