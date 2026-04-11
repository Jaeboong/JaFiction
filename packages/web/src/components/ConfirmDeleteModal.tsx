import { useEffect, useState } from "react";
import "../styles/confirm-delete.css";

/**
 * ConfirmDeleteModal — gated confirmation for irreversible destructive
 * actions (e.g. deleteProject). Requires the user to type the exact
 * confirmation phrase before the primary action becomes clickable. Closing
 * via the cancel button or Escape key aborts without firing onConfirm.
 *
 * Use only when the action truly destroys data. Normal destructive actions
 * (delete document, delete run) use an inline confirm flow, not this modal.
 */

export interface ConfirmDeleteModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmPhrase: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}

export function ConfirmDeleteModal({
  isOpen,
  title,
  message,
  confirmPhrase,
  confirmLabel = "영구 삭제",
  cancelLabel = "취소",
  onCancel,
  onConfirm
}: ConfirmDeleteModalProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setTyped("");
      setBusy(false);
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

  const canConfirm = typed.trim() === confirmPhrase && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      className="confirm-delete-backdrop"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div className="confirm-delete-modal">
        <h2 id="confirm-delete-title" className="confirm-delete-title">{title}</h2>
        <p className="confirm-delete-message">{message}</p>
        <p className="confirm-delete-warning">
          이 작업은 되돌릴 수 없습니다. 계속하려면 아래에{" "}
          <strong>{confirmPhrase}</strong> 를 정확히 입력하세요.
        </p>
        <input
          type="text"
          className="confirm-delete-input"
          value={typed}
          placeholder={confirmPhrase}
          disabled={busy}
          autoFocus
          onChange={(ev) => setTyped(ev.target.value)}
        />
        <div className="confirm-delete-actions">
          <button
            type="button"
            className="confirm-delete-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-delete-confirm"
            disabled={!canConfirm}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
