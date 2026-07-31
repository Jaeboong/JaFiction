import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasEvidenceFromElements,
  JudgeResultSchema,
  parseEssayMarkdown,
  recalculateJudgeResult,
  type JudgeResult,
} from "./eval-rubric";

function makeResult(totalClaims: number, evidenceClaims: number, judgeScore = 1): JudgeResult {
  return {
    dimension: "specificity/evidence",
    claims: Array.from({ length: totalClaims }, (_, index) => ({
      text: `가상 주장 ${index + 1}`,
      kind: "self" as const,
      elements: {
        context: index < evidenceClaims,
        role: index < evidenceClaims,
        result: false,
      },
      hasEvidence: index < evidenceClaims,
      note: "테스트용 판정",
    })),
    excluded: [],
    score: judgeScore,
    scoreRationale: "테스트용 근거",
  };
}

test("parseEssayMarkdown supports bracketed and dotted headings and excludes fact-check sections", () => {
  const markdown = [
    "# 가상 기업 자소서",
    "",
    "## [1] 지원 동기 및 입사 후 계획",
    "가상의 문제를 해결하고 싶습니다.",
    "두 번째 문장입니다.",
    "",
    "## 2. 가장 자신 있는 기술",
    "졸업 프로젝트에서 검색 기능을 구현했습니다.",
    "",
    "## 사실성 점검 메모",
    "이 문장은 답안에 포함되면 안 됩니다.",
    "",
    "## 3. 점검 이후 문항",
    "이 문항도 제외되어야 합니다.",
  ].join("\n");

  assert.deepEqual(parseEssayMarkdown(markdown), [
    {
      index: 1,
      title: "지원 동기 및 입사 후 계획",
      body: "가상의 문제를 해결하고 싶습니다.\n두 번째 문장입니다.",
      charCount: 30,
    },
    {
      index: 2,
      title: "가장 자신 있는 기술",
      body: "졸업 프로젝트에서 검색 기능을 구현했습니다.",
      charCount: 24,
    },
  ]);
});

test("score recalculation applies the 0.8 boundary", () => {
  assert.equal(recalculateJudgeResult(makeResult(100, 80)).recalculatedScore, 5);
  assert.equal(recalculateJudgeResult(makeResult(100, 79)).recalculatedScore, 4);
});

test("score recalculation applies the 0.6 boundary", () => {
  assert.equal(recalculateJudgeResult(makeResult(100, 60)).recalculatedScore, 4);
  assert.equal(recalculateJudgeResult(makeResult(100, 59)).recalculatedScore, 3);
});

test("score recalculation applies the 0.4 boundary", () => {
  assert.equal(recalculateJudgeResult(makeResult(100, 40)).recalculatedScore, 3);
  assert.equal(recalculateJudgeResult(makeResult(100, 39)).recalculatedScore, 2);
});

test("fewer than three claims use absolute evidence counts", () => {
  assert.equal(recalculateJudgeResult(makeResult(0, 0)).recalculatedScore, 1);
  assert.equal(recalculateJudgeResult(makeResult(1, 1)).recalculatedScore, 2);
  assert.equal(recalculateJudgeResult(makeResult(2, 2)).recalculatedScore, 3);
});

test("two true evidence elements pass and one does not", () => {
  assert.equal(hasEvidenceFromElements({ context: true, role: true, result: false }), true);
  assert.equal(hasEvidenceFromElements({ context: false, role: true, result: false }), false);
});

test("judge score and claim evidence mismatches are detected", () => {
  const result = makeResult(5, 4, 4);
  result.claims[0].hasEvidence = false;

  const recalculated = recalculateJudgeResult(result);

  assert.equal(recalculated.recalculatedScore, 5);
  assert.equal(recalculated.scoreMismatch, true);
  assert.equal(recalculated.hasEvidenceMismatchCount, 1);
});

test("judge responses are rejected when they do not match the zod schema", () => {
  const result = makeResult(1, 1);
  const invalid = {
    ...result,
    claims: [{ ...result.claims[0], kind: "opinion" }],
  };

  assert.equal(JudgeResultSchema.safeParse(invalid).success, false);
});
