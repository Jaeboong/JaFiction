import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildJudgePrompt,
  calculateGroundednessScore,
  hasEvidenceFromElements,
  JudgeResultSchema,
  loadAnchorRules,
  loadGroundednessAnchorRules,
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

test("anchor rule slices stay isolated by dimension", () => {
  const specificityRules = loadAnchorRules();
  const groundednessRules = loadGroundednessAnchorRules();

  assert.match(specificityRules, /\| \*\*시기\/맥락\*\* \|/);
  assert.doesNotMatch(specificityRules, /groundedness/);
  assert.match(groundednessRules, /groundedness/);
  assert.match(groundednessRules, /groundable/);
  assert.match(groundednessRules, /G = groundable claim 수/);
  assert.match(groundednessRules, /\| `supported` \|/);
  assert.doesNotMatch(groundednessRules, /\| \*\*본인 역할\*\* \|/);
});

test("judge prompts request groundedness only when context is provided", () => {
  const question = { index: 1, title: "테스트 문항", body: "프로젝트를 수행했습니다.", charCount: 14 };
  const specificityRules = loadAnchorRules();
  const withoutContext = buildJudgePrompt(
    question,
    specificityRules,
    undefined,
    undefined,
    undefined,
  );
  const withContext = buildJudgePrompt(
    question,
    specificityRules,
    undefined,
    loadGroundednessAnchorRules(),
    "프로젝트에서 검색 기능을 구현했습니다.",
  );

  assert.doesNotMatch(withoutContext, /groundedness/);
  assert.doesNotMatch(withoutContext, /groundable/);
  assert.match(withContext, /groundedness/);
  assert.match(withContext, /groundable/);
  assert.match(withContext, /프로젝트에서 검색 기능을 구현했습니다/);
});

test("judge prompts do not request groundedness without groundedness rules", () => {
  const prompt = buildJudgePrompt(
    { index: 1, title: "테스트 문항", body: "프로젝트를 수행했습니다.", charCount: 14 },
    loadAnchorRules(),
    undefined,
    undefined,
    "프로젝트에서 검색 기능을 구현했습니다.",
  );

  assert.doesNotMatch(prompt, /groundedness/);
  assert.doesNotMatch(prompt, /groundable/);
});

test("groundedness score recalculation applies null, contradiction, and ratio boundaries", () => {
  assert.equal(calculateGroundednessScore(0, 0, 0), null);
  assert.equal(calculateGroundednessScore(10, 10, 2), 1);
  assert.equal(calculateGroundednessScore(10, 10, 1), 2);
  assert.equal(calculateGroundednessScore(10, 4, 0), 1);
  assert.equal(calculateGroundednessScore(10, 5, 0), 2);
  assert.equal(calculateGroundednessScore(100, 75, 0), 3);
  assert.equal(calculateGroundednessScore(100, 90, 0), 4);
  assert.equal(calculateGroundednessScore(100, 100, 0), 5);
});

test("supported claims without a quote are demoted to unsupported", () => {
  const result = makeResult(1, 1, 5);
  result.claims[0].groundable = true;
  result.claims[0].grounded = { verdict: "supported", quote: "   " };
  result.groundedness = { score: 5, scoreRationale: "모두 자료에 근거함" };

  const recalculated = recalculateJudgeResult(result);

  assert.equal(recalculated.claims[0].reportedVerdict, "supported");
  assert.equal(recalculated.claims[0].recalculatedVerdict, "unsupported");
  assert.equal(recalculated.claims[0].verdictMismatch, true);
  assert.equal(recalculated.unsupportedCount, 1);
  assert.equal(recalculated.verdictDemotionCount, 1);
  assert.equal(recalculated.groundednessScore, 1);
});

test("non-groundable claims are excluded from the groundedness denominator", () => {
  const result = makeResult(2, 2, 5);
  result.claims[0].groundable = true;
  result.claims[0].grounded = { verdict: "supported", quote: "프로젝트에서 직접 구현했습니다" };
  result.claims[1].groundable = false;
  result.groundedness = { score: 5, scoreRationale: "대조 가능 주장이 모두 근거 있음" };

  const recalculated = recalculateJudgeResult(result);

  assert.equal(recalculated.groundableCount, 1);
  assert.equal(recalculated.supportedCount, 1);
  assert.equal(recalculated.groundedRatio, 1);
  assert.equal(recalculated.groundednessScore, 5);
});

test("legacy judge results without groundedness fields remain valid and unmeasured", () => {
  const legacy = makeResult(1, 1, 2);
  const parsed = JudgeResultSchema.safeParse(legacy);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  const recalculated = recalculateJudgeResult(parsed.data);
  assert.equal(recalculated.groundedRatio, null);
  assert.equal(recalculated.groundednessJudgeScore, null);
  assert.equal(recalculated.groundednessScore, null);
  assert.match(recalculated.groundednessRationale, /측정 불가/);
  assert.match(JSON.stringify(recalculated), /"groundednessScore":null/);
});

test("contextual judge results require claim-level groundedness fields", () => {
  const missingGroundable = {
    ...makeResult(1, 1, 5),
    groundedness: { score: 5, scoreRationale: "모두 자료에 근거함" },
  };
  const missingGrounded = makeResult(1, 1, 5);
  missingGrounded.claims[0].groundable = true;
  missingGrounded.groundedness = { score: 5, scoreRationale: "모두 자료에 근거함" };

  assert.equal(JudgeResultSchema.safeParse(missingGroundable).success, false);
  assert.equal(JudgeResultSchema.safeParse(missingGrounded).success, false);
});

test("omitting the judge summary block leaves groundedness unmeasured despite claim verdicts", () => {
  const result = makeResult(4, 4, 5);
  result.claims.forEach((claim, index) => {
    claim.groundable = true;
    claim.grounded = index < 3
      ? { verdict: "supported", quote: `자료 원문 ${index + 1}` }
      : { verdict: "unsupported", quote: "" };
  });

  const recalculated = recalculateJudgeResult(result);

  assert.equal(recalculated.groundednessJudgeScore, null);
  assert.equal(recalculated.groundableCount, 0);
  assert.equal(recalculated.groundednessScore, null);
  assert.match(recalculated.groundednessRationale, /측정 불가/);
});

test("groundedness is unmeasured when context has no groundable claims", () => {
  const result = makeResult(1, 1, 2);
  result.claims[0].groundable = false;
  result.groundedness = { score: 1, scoreRationale: "대조 가능한 주장 없음" };

  const recalculated = recalculateJudgeResult(result);

  assert.equal(recalculated.groundableCount, 0);
  assert.equal(recalculated.groundedRatio, null);
  assert.equal(recalculated.groundednessScore, null);
  assert.equal(recalculated.groundednessScoreMismatch, true);
});
