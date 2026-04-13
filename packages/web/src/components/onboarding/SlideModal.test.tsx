/**
 * SlideModal.test.tsx
 *
 * Basic unit tests for SlideModal using react-dom/server (no effects, no browser).
 */
import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideModal } from "./SlideModal";

const noop = () => undefined;

const singleSlide = [
  { id: "s1", title: "첫 번째 슬라이드", body: <p>본문 내용</p> }
];

const multiSlides = [
  { id: "s1", title: "슬라이드 1", body: <p>첫 번째</p> },
  { id: "s2", title: "슬라이드 2", body: <p>두 번째</p> },
  { id: "s3", title: "슬라이드 3", body: <p>세 번째</p> }
];

describe("SlideModal", () => {
  it("renders the slide title and body", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={singleSlide}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /첫 번째 슬라이드/);
    assert.match(html, /본문 내용/);
  });

  it("renders step indicator dots matching slide count", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={multiSlides}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    const dotMatches = html.match(/slide-step-dot/g) ?? [];
    assert.equal(dotMatches.length, 3);
  });

  it("shows '다시 보지 않기' checkbox by default", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={singleSlide}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /다시 보지 않기/);
  });

  it("hides '다시 보지 않기' checkbox when forceShow is true", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={singleSlide}
        rememberKey="test"
        onDismiss={noop}
        forceShow={true}
      />
    );
    assert.doesNotMatch(html, /다시 보지 않기/);
  });

  it("renders a close button", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={singleSlide}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /닫기/);
  });

  it("renders an image when image prop is provided", () => {
    const slides = [{ id: "s1", title: "제목", body: <p>내용</p>, image: "/jasojeon.png" }];
    const html = renderToStaticMarkup(
      <SlideModal
        slides={slides}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /jasojeon\.png/);
  });

  it("shows '완료' on the last slide when no primaryAction", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={singleSlide}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /완료/);
  });

  it("shows primaryAction label on the last slide when provided", () => {
    const slides = [
      {
        id: "s1",
        title: "마지막",
        body: <p>내용</p>,
        primaryAction: { label: "시작하기", onClick: noop }
      }
    ];
    const html = renderToStaticMarkup(
      <SlideModal
        slides={slides}
        rememberKey="test"
        onDismiss={noop}
      />
    );
    assert.match(html, /시작하기/);
  });

  it("shows '이전' and '다음' on a middle slide", () => {
    const html = renderToStaticMarkup(
      <SlideModal
        slides={multiSlides}
        rememberKey="test"
        initialIndex={1}
        onDismiss={noop}
      />
    );
    assert.match(html, /이전/);
    assert.match(html, /다음/);
  });
});
