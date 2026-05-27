import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

const noop = () => undefined;

describe("ConfirmDeleteModal", () => {
  it("supports a simple confirmation without requiring typed text", () => {
    const html = renderToStaticMarkup(
      <ConfirmDeleteModal
        isOpen={true}
        title="서버 연동"
        message="확인 문구"
        confirmLabel="동의하고 켜기"
        cancelLabel="취소"
        onCancel={noop}
        onConfirm={noop}
      />
    );

    assert.match(html, /서버 연동/);
    assert.match(html, /확인 문구/);
    assert.match(html, /동의하고 켜기/);
    assert.doesNotMatch(html, /confirm-delete-input/);
    assert.doesNotMatch(html, /disabled=""/);
  });
});
