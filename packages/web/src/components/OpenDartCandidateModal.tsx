import type { OpenDartCandidate } from "@jasojeon/shared";
import { useEffect, useState } from "react";
import "../styles/open-dart-candidate.css";

export interface OpenDartCandidateModalProps {
  readonly isOpen: boolean;
  readonly companyName: string;
  readonly candidates: readonly OpenDartCandidate[];
  readonly onCancel: () => void;
  readonly onConfirm: (corpCode: string) => void | Promise<void>;
}

export function OpenDartCandidateModal({
  isOpen,
  companyName,
  candidates,
  onCancel,
  onConfirm
}: OpenDartCandidateModalProps) {
  const [selected, setSelected] = useState<string | undefined>(candidates[0]?.corpCode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelected(candidates[0]?.corpCode);
      setBusy(false);
    }
  }, [isOpen, candidates]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, busy, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dart-modal-title"
      className="dart-candidate-backdrop"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !busy) onCancel();
      }}
    >
      <div className="dart-candidate-modal">
        <h2 id="dart-modal-title" className="dart-candidate-title">OpenDART 회사 선택</h2>
        <p className="dart-candidate-desc">
          <strong>{companyName}</strong>와 일치하는 회사가 여러 개 있습니다.{" "}
          인사이트 생성에 사용할 회사를 선택해 주세요.
        </p>

        <ul className="dart-candidate-list" role="listbox" aria-label="회사 후보 목록">
          {candidates.map((c) => (
            <li
              key={c.corpCode}
              role="option"
              aria-selected={selected === c.corpCode}
              className={`dart-candidate-item${selected === c.corpCode ? " is-selected" : ""}`}
              onClick={() => setSelected(c.corpCode)}
            >
              <span className="dart-candidate-name">{c.corpName}</span>
              {c.stockCode
                ? <span className="dart-candidate-code">상장 {c.stockCode}</span>
                : <span className="dart-candidate-code dart-candidate-code--unlisted">비상장</span>}
            </li>
          ))}
        </ul>

        <div className="dart-candidate-actions">
          <button
            type="button"
            className="dart-candidate-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            취소
          </button>
          <button
            type="button"
            className="dart-candidate-confirm"
            disabled={!selected || busy}
            onClick={async () => {
              if (!selected) return;
              setBusy(true);
              try {
                await onConfirm(selected);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "생성 시작 중..." : "선택 후 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
