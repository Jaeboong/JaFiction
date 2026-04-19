import * as assert from "node:assert/strict";
import test from "node:test";
import {
  crossValidateCandidates,
  DEFAULT_STOP_TOKENS,
  tokenOverlapAtLeast
} from "../core/jobPosting/crossValidate";

test("tokenOverlapAtLeast matches meaningful role tokens by default", () => {
  assert.equal(
    tokenOverlapAtLeast(
      "백엔드 개발자(Python, Java)",
      "[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용",
      2
    ),
    true
  );
});

test("tokenOverlapAtLeast ignores default stop tokens", () => {
  assert.equal(
    tokenOverlapAtLeast("채용 공개", "백엔드 공개 채용", 1, { stopTokens: DEFAULT_STOP_TOKENS }),
    false
  );
});

test("tokenOverlapAtLeast trims trailing Korean particles", () => {
  assert.equal(
    tokenOverlapAtLeast("아이디스는", "(주)아이디스홀딩스", 1),
    true
  );
});

test("tokenOverlapAtLeast respects minTokenLen", () => {
  assert.equal(
    tokenOverlapAtLeast("AI", "AI Platform Engineer", 1, { minTokenLen: 3, stopTokens: [] }),
    false
  );
});

test("tokenOverlapAtLeast lowercases tokens before matching", () => {
  assert.equal(
    tokenOverlapAtLeast("Python Backend", "python backend engineer", 2, { stopTokens: [] }),
    true
  );
});

test("crossValidateCandidates promotes when two sources agree", () => {
  const result = crossValidateCandidates([
    { value: "아이디스", source: "hostname" },
    { value: "아이디스 채용", source: "titleStrip" },
    { value: "(주)아이디스홀딩스", source: "footer" }
  ]);

  assert.equal(result.tier, "factual");
  assert.equal(result.value, "아이디스");
  assert.deepEqual(result.matchedSources, ["hostname", "titleStrip", "footer"]);
});

test("crossValidateCandidates respects minAgreeCount", () => {
  const result = crossValidateCandidates(
    [
      { value: "아이디스", source: "hostname" },
      { value: "아이디스 채용", source: "titleStrip" }
    ],
    { minAgreeCount: 3 }
  );

  assert.deepEqual(result, { matchedSources: [] });
});

test("crossValidateCandidates does not count duplicate values from the same source twice", () => {
  const result = crossValidateCandidates([
    { value: "아이디스", source: "titleStrip" },
    { value: "아이디스 채용", source: "titleStrip" }
  ]);

  assert.deepEqual(result, { matchedSources: [] });
});

test("crossValidateCandidates picks the representative with the most tokens", () => {
  const result = crossValidateCandidates([
    { value: "백엔드", source: "hostname" },
    { value: "플랫폼 백엔드 엔지니어", source: "ogTitle" },
    { value: "백엔드 엔지니어", source: "h1" }
  ]);

  assert.equal(result.tier, "factual");
  assert.equal(result.value, "플랫폼 백엔드 엔지니어");
});
