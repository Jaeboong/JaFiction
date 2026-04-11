import { useEffect, useState } from "react";
import "../../styles/confirm-delete.css";

/**
 * NotionConnectModal — hosted-mode token + (optional) database id entry.
 *
 * Local mode drives Notion connection through inline provider UI that writes
 * the token to the runner filesystem before calling `connect`. In hosted
 * mode the runner never sees the raw REST body, so the token must ride the
 * `notion_connect` RPC directly. This modal collects the secret (and an
 * optional database id) and hands it back to the caller as a single submit.
 *
 * The modal never logs, copies, or echoes the token — it stays in component
 * state and is forgotten on close.
 */

export interface NotionConnectModalProps {
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (opts: { token: string; dbId?: string }) => void | Promise<void>;
}

export function NotionConnectModal({ isOpen, onCancel, onSubmit }: NotionConnectModalProps) {
  const [token, setToken] = useState("");
  const [dbId, setDbId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setToken("");
      setDbId("");
      setBusy(false);
      setError(null);
      return undefined;
    }
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) {
    return null;
  }

  const trimmedToken = token.trim();
  const trimmedDbId = dbId.trim();
  const tokenLooksValid = /^(secret_|ntn_)\S{10,}/.test(trimmedToken);
  const canSubmit = tokenLooksValid && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        token: trimmedToken,
        dbId: trimmedDbId.length > 0 ? trimmedDbId : undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="confirm-delete-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="notion-connect-title">
      <div className="confirm-delete-modal">
        <h2 id="notion-connect-title" className="confirm-delete-modal-title">Notion 연결</h2>
        <p className="confirm-delete-modal-message">
          Notion Integration Token을 입력하세요. 선택적으로 특정 데이터베이스 ID를 지정할 수 있습니다.
          토큰은 서버에 안전하게 전송되며 브라우저 로그에는 남지 않습니다.
        </p>
        <label className="confirm-delete-modal-label" htmlFor="notion-token-input">
          Integration Token
        </label>
        <input
          id="notion-token-input"
          type="password"
          className="confirm-delete-modal-input"
          placeholder="secret_..."
          value={token}
          onChange={(ev) => setToken(ev.target.value)}
          disabled={busy}
          autoFocus
        />
        <label className="confirm-delete-modal-label" htmlFor="notion-dbid-input">
          Database ID (선택)
        </label>
        <input
          id="notion-dbid-input"
          type="text"
          className="confirm-delete-modal-input"
          placeholder="비워두면 기본 설정 사용"
          value={dbId}
          onChange={(ev) => setDbId(ev.target.value)}
          disabled={busy}
        />
        {error ? <p className="confirm-delete-modal-error">{error}</p> : null}
        <div className="confirm-delete-modal-actions">
          <button
            type="button"
            className="confirm-delete-modal-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="confirm-delete-modal-confirm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? "연결 중..." : "연결"}
          </button>
        </div>
      </div>
    </div>
  );
}
