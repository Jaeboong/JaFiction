import { useState } from "react";
import type { BackendClient } from "../../api/client";
import "../../styles/confirm-delete.css";

interface Props {
  readonly isOpen: boolean;
  readonly email: string;
  readonly backendClient: BackendClient;
  readonly onClose: () => void;
}

export function ConfirmDeleteAccountModal({ isOpen, email, backendClient, onClose }: Props) {
  const [inputValue, setInputValue] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!isOpen) return null;

  const canConfirm = inputValue === email && !isDeleting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setIsDeleting(true);
    setError(undefined);
    try {
      await backendClient.deleteAccount();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "계정 삭제에 실패했습니다.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="confirm-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-account-title">
      <div className="confirm-delete-modal">
        <h2 className="confirm-delete-title" id="confirm-delete-account-title">계정 삭제</h2>
        <p className="confirm-delete-message">
          계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다. 이 작업은 되돌릴 수 없습니다.
        </p>
        <p className="confirm-delete-warning">
          계속하려면 아래에 이메일 주소 <strong>{email}</strong>를 입력하세요.
        </p>
        <input
          type="email"
          className="confirm-delete-input"
          placeholder={email}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); }}
          disabled={isDeleting}
          autoComplete="off"
          aria-label="이메일 주소 확인"
        />
        {error ? <p className="confirm-delete-warning" style={{ color: "#b91c1c" }}>{error}</p> : null}
        <div className="confirm-delete-actions">
          <button
            type="button"
            className="confirm-delete-cancel"
            onClick={onClose}
            disabled={isDeleting}
          >
            취소
          </button>
          <button
            type="button"
            className="confirm-delete-confirm"
            onClick={() => { void handleConfirm(); }}
            disabled={!canConfirm}
          >
            {isDeleting ? "삭제 중…" : "계정 삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
