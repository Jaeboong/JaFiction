#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// ─── 상수 ───────────────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const ANCHOR_FILE = join(REPO_ROOT, "docs/plans/2026-07-31-rubric-anchors-draft.md");
const GROUNDEDNESS_ANCHOR_FILE = join(
  REPO_ROOT,
  "docs/plans/2026-08-04-groundedness-anchor-draft.md",
);
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, ".harness/eval-rubric");
const RESULTS_FILE_NAME = "results.json";

const OUTPUT_SCHEMA_PROMPT_WITHOUT_CONTEXT = `{
  "dimension": "specificity/evidence",
  "claims": [
    { "text": "<원문 인용>", "kind": "self" | "link",
      "elements": { "context": bool, "role": bool, "result": bool },
      "hasEvidence": bool, "note": "<판정 근거 한 줄>" }
  ],
  "excluded": [ { "text": "<인용>", "reason": "aspiration" | "company_info" | "transition" } ],
  "score": 1..5,
  "scoreRationale": "<적용한 앵커 규칙>"
}`;

const OUTPUT_SCHEMA_PROMPT_WITH_CONTEXT = `{
  "dimension": "specificity/evidence",
  "claims": [
    { "text": "<답안 원문 인용>", "kind": "self" | "link",
      "elements": { "context": bool, "role": bool, "result": bool },
      "hasEvidence": bool, "note": "<specificity/evidence 판정 근거 한 줄>",
      "groundable": bool,
      "grounded": { "verdict": "supported" | "unsupported" | "contradicted",
        "quote": "<사용자 제공 자료의 원문 인용>" } }
  ],
  "excluded": [ { "text": "<답안 원문 인용>", "reason": "aspiration" | "company_info" | "transition" } ],
  "score": 1..5,
  "scoreRationale": "<specificity/evidence에 적용한 앵커 규칙>",
  "groundedness": { "score": 1..5, "scoreRationale": "<groundedness에 적용한 앵커 규칙>" }
}`;

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const EvidenceElementsSchema = z.object({
  context: z.boolean(),
  role: z.boolean(),
  result: z.boolean(),
}).strict();

const GroundedVerdictSchema = z.enum(["supported", "unsupported", "contradicted"]);

const GroundedSchema = z.object({
  verdict: GroundedVerdictSchema,
  quote: z.string(),
}).strict();

const ClaimSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["self", "link"]),
  elements: EvidenceElementsSchema,
  hasEvidence: z.boolean(),
  note: z.string().min(1),
  groundable: z.boolean().optional(),
  grounded: GroundedSchema.optional(),
}).strict();

const ExcludedSchema = z.object({
  text: z.string().min(1),
  reason: z.enum(["aspiration", "company_info", "transition"]),
}).strict();

const GroundednessSchema = z.object({
  score: z.number().int().min(1).max(5),
  scoreRationale: z.string().min(1),
}).strict();

export const JudgeResultSchema = z.object({
  dimension: z.literal("specificity/evidence"),
  claims: z.array(ClaimSchema),
  excluded: z.array(ExcludedSchema),
  score: z.number().int().min(1).max(5),
  scoreRationale: z.string().min(1),
  groundedness: GroundednessSchema.optional(),
}).strict().superRefine((result, context) => {
  if (result.groundedness === undefined) return;

  result.claims.forEach((claim, index) => {
    if (claim.groundable === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claims", index, "groundable"],
        message: "groundedness 채점 시 groundable 판정이 필요합니다.",
      });
      return;
    }
    if (claim.groundable && claim.grounded === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claims", index, "grounded"],
        message: "groundable claim에는 grounded 판정이 필요합니다.",
      });
    }
  });
});

export type EvidenceElements = z.infer<typeof EvidenceElementsSchema>;
export type GroundedVerdict = z.infer<typeof GroundedVerdictSchema>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

interface ClaimCheck extends Omit<JudgeResult["claims"][number], "hasEvidence"> {
  reportedHasEvidence: boolean;
  recalculatedHasEvidence: boolean;
  evidenceMismatch: boolean;
  reportedVerdict: GroundedVerdict | null;
  recalculatedVerdict: GroundedVerdict | null;
  verdictMismatch: boolean;
}

export interface RecalculatedResult {
  dimension: "specificity/evidence";
  claims: ClaimCheck[];
  excluded: JudgeResult["excluded"];
  claimCount: number;
  evidenceCount: number;
  evidenceRatio: number;
  judgeScore: number;
  score: number;
  recalculatedScore: number;
  scoreMismatch: boolean;
  hasEvidenceMismatchCount: number;
  judgeScoreRationale: string;
  recalculationRationale: string;
  groundableCount: number;
  supportedCount: number;
  unsupportedCount: number;
  contradictedCount: number;
  groundedRatio: number | null;
  groundednessJudgeScore: number | null;
  groundednessScore: number | null;
  groundednessScoreMismatch: boolean;
  verdictDemotionCount: number;
  groundednessRationale: string;
}

interface StoredResult extends RecalculatedResult {
  sourceFile: string;
}

interface StoredResults {
  generatedAt: string;
  dimension: "specificity/evidence";
  results: StoredResult[];
}

export interface ParsedQuestion {
  index: number;
  title: string;
  body: string;
  charCount: number;
}

interface CliArgs {
  command: string;
  options: Map<string, string>;
}

// ─── 자소서 파싱 ─────────────────────────────────────────────────────────────

export function parseEssayMarkdown(markdown: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let current: { index: number; title: string; bodyLines: string[] } | undefined;

  const flush = (): void => {
    if (!current) return;
    const body = current.bodyLines.join("\n").trim();
    questions.push({
      index: current.index,
      title: current.title,
      body,
      charCount: body.length,
    });
  };

  for (const line of lines) {
    if (/^##\s+사실성\s+점검(?:\s+메모)?\s*$/.test(line.trim())) {
      flush();
      current = undefined;
      break;
    }

    const heading = line.match(/^##\s+(?:\[(\d+)\]|(\d+)\.)\s*(.+?)\s*$/);
    if (heading) {
      flush();
      current = {
        index: Number(heading[1] ?? heading[2]),
        title: heading[3].trim(),
        bodyLines: [],
      };
      continue;
    }

    if (current) current.bodyLines.push(line);
  }

  flush();
  return questions;
}

function printParsedQuestions(questions: ParsedQuestion[]): void {
  console.log(`=== 자소서 문항 파싱 결과 (${questions.length}개) ===`);
  for (const question of questions) {
    console.log(`\n[문항 ${question.index}] ${question.title}`);
    console.log(`글자수: ${question.charCount}`);
    console.log("답안:");
    console.log(question.body);
  }
}

// ─── 재계산 ─────────────────────────────────────────────────────────────────

export function hasEvidenceFromElements(elements: EvidenceElements): boolean {
  return Object.values(elements).filter(Boolean).length >= 2;
}

export function calculateScore(claimCount: number, evidenceCount: number): number {
  if (!Number.isInteger(claimCount) || !Number.isInteger(evidenceCount)) {
    throw new Error("claim 수와 근거 claim 수는 정수여야 합니다.");
  }
  if (claimCount < 0 || evidenceCount < 0 || evidenceCount > claimCount) {
    throw new Error("claim 수와 근거 claim 수의 범위가 올바르지 않습니다.");
  }

  if (claimCount < 3) return evidenceCount + 1;
  if (evidenceCount === 0) return 1;
  if (evidenceCount * 5 >= claimCount * 4) return 5;
  if (evidenceCount * 5 >= claimCount * 3) return 4;
  if (evidenceCount * 5 >= claimCount * 2) return 3;
  return 2;
}

export function calculateGroundednessScore(
  groundableCount: number,
  supportedCount: number,
  contradictedCount: number,
): number | null {
  if (
    !Number.isInteger(groundableCount)
    || !Number.isInteger(supportedCount)
    || !Number.isInteger(contradictedCount)
  ) {
    throw new Error("groundable, supported, contradicted claim 수는 정수여야 합니다.");
  }
  if (
    groundableCount < 0
    || supportedCount < 0
    || contradictedCount < 0
    || supportedCount > groundableCount
    || contradictedCount > groundableCount
  ) {
    throw new Error("groundedness claim 수의 범위가 올바르지 않습니다.");
  }

  if (groundableCount === 0) return null;
  if (contradictedCount >= 2) return 1;
  if (supportedCount * 2 < groundableCount) return 1;
  if (contradictedCount === 1) return 2;
  if (supportedCount === groundableCount) return 5;
  if (supportedCount * 10 >= groundableCount * 9) return 4;
  if (supportedCount * 4 >= groundableCount * 3) return 3;
  return 2;
}

function buildRecalculationRationale(
  claimCount: number,
  evidenceCount: number,
  score: number,
): string {
  if (claimCount < 3) {
    return `claim ${claimCount}개(<3)이므로 근거 claim 절대 수 ${evidenceCount}개를 적용해 ${score}점`;
  }

  const ratio = evidenceCount / claimCount;
  if (evidenceCount === 0) {
    return `claim ${claimCount}개(≥3), 근거 claim 0개이므로 1점`;
  }
  return `claim ${claimCount}개(≥3)이므로 비율 판정. 근거 ${evidenceCount}개, 비율 ${ratio.toFixed(2)}로 ${score}점`;
}

export function recalculateJudgeResult(result: JudgeResult): RecalculatedResult {
  const hasGroundednessContext = result.groundedness !== undefined;
  const claims = result.claims.map((claim) => {
    const recalculatedHasEvidence = hasEvidenceFromElements(claim.elements);
    const reportedVerdict = claim.grounded?.verdict ?? null;
    const recalculatedVerdict = !hasGroundednessContext || claim.groundable !== true
      ? null
      : reportedVerdict === "supported" && claim.grounded?.quote.trim().length === 0
        ? "unsupported"
        : reportedVerdict ?? "unsupported";
    return {
      text: claim.text,
      kind: claim.kind,
      elements: claim.elements,
      note: claim.note,
      groundable: claim.groundable,
      grounded: claim.grounded,
      reportedHasEvidence: claim.hasEvidence,
      recalculatedHasEvidence,
      evidenceMismatch: claim.hasEvidence !== recalculatedHasEvidence,
      reportedVerdict,
      recalculatedVerdict,
      verdictMismatch: reportedVerdict !== recalculatedVerdict,
    };
  });
  const claimCount = claims.length;
  const evidenceCount = claims.filter((claim) => claim.recalculatedHasEvidence).length;
  const recalculatedScore = calculateScore(claimCount, evidenceCount);
  const groundableClaims = hasGroundednessContext
    ? claims.filter((claim) => claim.groundable === true)
    : [];
  const groundableCount = groundableClaims.length;
  const supportedCount = groundableClaims.filter(
    (claim) => claim.recalculatedVerdict === "supported",
  ).length;
  const unsupportedCount = groundableClaims.filter(
    (claim) => claim.recalculatedVerdict === "unsupported",
  ).length;
  const contradictedCount = groundableClaims.filter(
    (claim) => claim.recalculatedVerdict === "contradicted",
  ).length;
  const groundednessScore = hasGroundednessContext
    ? calculateGroundednessScore(groundableCount, supportedCount, contradictedCount)
    : null;
  const groundednessJudgeScore = result.groundedness?.score ?? null;

  return {
    dimension: result.dimension,
    claims,
    excluded: result.excluded,
    claimCount,
    evidenceCount,
    evidenceRatio: claimCount === 0 ? 0 : evidenceCount / claimCount,
    judgeScore: result.score,
    score: recalculatedScore,
    recalculatedScore,
    scoreMismatch: result.score !== recalculatedScore,
    hasEvidenceMismatchCount: claims.filter((claim) => claim.evidenceMismatch).length,
    judgeScoreRationale: result.scoreRationale,
    recalculationRationale: buildRecalculationRationale(
      claimCount,
      evidenceCount,
      recalculatedScore,
    ),
    groundableCount,
    supportedCount,
    unsupportedCount,
    contradictedCount,
    groundedRatio: groundableCount === 0 ? null : supportedCount / groundableCount,
    groundednessJudgeScore,
    groundednessScore,
    groundednessScoreMismatch: groundednessJudgeScore !== groundednessScore,
    verdictDemotionCount: groundableClaims.filter(
      (claim) => claim.reportedVerdict === "supported"
        && claim.recalculatedVerdict === "unsupported"
        && claim.grounded?.quote.trim().length === 0,
    ).length,
    groundednessRationale: result.groundedness?.scoreRationale
      ?? "컨텍스트 미제공으로 groundedness 측정 불가",
  };
}

// ─── 프롬프트 생성 ───────────────────────────────────────────────────────────

export function loadAnchorRules(): string {
  const content = readFileSync(ANCHOR_FILE, "utf-8");
  const unitsStart = content.indexOf("### 1.1 주장(claim)");
  const anchorsStart = content.indexOf("## 2. 앵커 — specificity/evidence");
  const outputStart = content.indexOf("## 3. 채점 출력 형식");
  if (unitsStart < 0 || anchorsStart < 0 || outputStart < 0) {
    throw new Error(`앵커 규약 섹션을 찾을 수 없습니다: ${ANCHOR_FILE}`);
  }

  return [
    content.slice(unitsStart, anchorsStart).trim(),
    content.slice(anchorsStart, outputStart).trim(),
  ].join("\n\n");
}

export function loadGroundednessAnchorRules(): string {
  const content = readFileSync(GROUNDEDNESS_ANCHOR_FILE, "utf-8");
  const rulesStart = content.indexOf("## 3. 판정 대상");
  const reviewStart = content.indexOf("## 6. 사용자 확인 필요");
  if (rulesStart < 0 || reviewStart < 0 || reviewStart <= rulesStart) {
    throw new Error(`groundedness 앵커 규약 섹션을 찾을 수 없습니다: ${GROUNDEDNESS_ANCHOR_FILE}`);
  }

  return `# groundedness\n\n${content.slice(rulesStart, reviewStart).trim()}`;
}

export function buildJudgePrompt(
  question: ParsedQuestion,
  anchorRules: string,
  posting: string | undefined,
  groundednessAnchorRules: string | undefined,
  context: string | undefined,
): string {
  const hasGroundednessContext = groundednessAnchorRules !== undefined && context !== undefined;
  const groundednessRequest = groundednessAnchorRules === undefined || context === undefined
    ? ""
    : `

## groundedness 규약

${groundednessAnchorRules}

## 사용자 제공 자료 원문

${context.trim()}`;
  const outputSchemaPrompt = hasGroundednessContext
    ? OUTPUT_SCHEMA_PROMPT_WITH_CONTEXT
    : OUTPUT_SCHEMA_PROMPT_WITHOUT_CONTEXT;
  const groundednessInstructions = hasGroundednessContext
    ? `- \`claims[]\`는 두 차원이 공유합니다. 각 claim에 \`groundable\`을 판정하고, \`groundable: true\`이면 \`grounded\`를 포함하세요.
- \`supported\`이면 \`grounded.quote\`에 사용자 제공 자료 원문을 공백이 아닌 문자열로 인용하세요. \`groundable: false\`이면 \`grounded\`를 생략하세요.
`
    : "";

  return `# specificity/evidence${hasGroundednessContext ? " + groundedness" : ""} 평가 요청

아래 규약을 그대로 적용해 자소서 답안을 채점하세요. 규약을 완화하거나 다른 평가 차원을 섞지 마세요.

${anchorRules}${groundednessRequest}

## 평가 대상 문항

문항 ${question.index}. ${question.title}

## 답안

${question.body}

## 공고 원문 요약

${posting?.trim() || "제공되지 않음"}

## 출력 계약

아래 스키마와 정확히 같은 필드만 사용하세요.

\`\`\`json
${outputSchemaPrompt}
\`\`\`

- \`kind\`는 자기 주장이면 \`self\`, 연결 주장이면 \`link\`입니다.
- \`elements\`의 각 값과 \`hasEvidence\`를 독립적으로 빠짐없이 판정하세요.
- \`claims[].text\`와 \`excluded[].text\`는 반드시 답안 원문을 그대로 인용하세요.
${groundednessInstructions}- 설명, 마크다운 코드 펜스, 머리말을 붙이지 말고 유효한 JSON 객체만 반환하세요.
`;
}

function emitPrompts(
  essayPath: string,
  outDir: string,
  questionIndex: number | undefined,
  postingPath: string | undefined,
  contextPath: string | undefined,
): void {
  const questions = parseEssayMarkdown(readFileSync(essayPath, "utf-8"));
  const selected = questionIndex === undefined
    ? questions
    : questions.filter((question) => question.index === questionIndex);
  if (selected.length === 0) {
    throw new Error(
      questionIndex === undefined
        ? "자소서에서 문항 헤딩을 찾지 못했습니다."
        : `문항 ${questionIndex}을(를) 찾지 못했습니다.`,
    );
  }

  const anchorRules = loadAnchorRules();
  const posting = postingPath ? readFileSync(postingPath, "utf-8") : undefined;
  const groundednessAnchorRules = contextPath ? loadGroundednessAnchorRules() : undefined;
  const context = contextPath ? readFileSync(contextPath, "utf-8") : undefined;
  mkdirSync(outDir, { recursive: true });

  console.log(`=== judge 프롬프트 생성 (${selected.length}개) ===`);
  for (const question of selected) {
    const outputPath = join(outDir, `question-${question.index}.prompt.md`);
    writeFileSync(
      outputPath,
      buildJudgePrompt(question, anchorRules, posting, groundednessAnchorRules, context),
      "utf-8",
    );
    console.log(`[문항 ${question.index}] ${outputPath}`);
  }
}

// ─── 결과 적재 ───────────────────────────────────────────────────────────────

function readJsonFile(path: string): unknown {
  const content = readFileSync(path, "utf-8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: JSON 파싱 실패: ${message}`);
  }
}

function parseJudgeResult(path: string): JudgeResult {
  const parsed = JudgeResultSchema.safeParse(readJsonFile(path));
  if (!parsed.success) {
    throw new Error(`${path}: 스키마 검증 실패\n${parsed.error.message}`);
  }
  return parsed.data;
}

function listResultFiles(path: string): string[] {
  if (!existsSync(path)) throw new Error(`결과 경로가 없습니다: ${path}`);
  if (!statSync(path).isDirectory()) return [path];

  const files = readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .filter((entry) => entry.name !== RESULTS_FILE_NAME)
    .map((entry) => join(path, entry.name))
    .sort();
  if (files.length === 0) throw new Error(`JSON 결과 파일이 없습니다: ${path}`);
  return files;
}

function ingestFiles(path: string): StoredResult[] {
  return listResultFiles(path).map((file) => ({
    sourceFile: basename(file),
    ...recalculateJudgeResult(parseJudgeResult(file)),
  }));
}

function formatRatio(value: number | null | undefined): string {
  return value === null || value === undefined ? "측정 불가" : value.toFixed(2);
}

function formatNullableScore(value: number | null | undefined): string {
  return value === null || value === undefined ? "측정 불가" : String(value);
}

function formatGroundednessCount(result: StoredResult, value: number): string {
  return result.groundednessJudgeScore === null ? "측정 불가" : String(value);
}

function printIngestTable(results: StoredResult[]): void {
  console.log("=== specificity/evidence 채점 결과 ===");
  console.log("| 파일 | claim | 근거 | 비율 | judge | 재계산/채택 | 점수 불일치 | claim 판정 불일치 |");
  console.log("|---|---:|---:|---:|---:|---:|:---:|---:|");
  for (const result of results) {
    console.log(
      `| ${result.sourceFile.replace(/\|/g, "\\|")} | ${result.claimCount} | ${result.evidenceCount} | ${formatRatio(result.evidenceRatio)} | ${result.judgeScore} | ${result.score} | ${result.scoreMismatch ? "예" : "아니오"} | ${result.hasEvidenceMismatchCount} |`,
    );
  }

  const evidenceMismatches = results.flatMap((result) =>
    result.claims
      .filter((claim) => claim.evidenceMismatch)
      .map((claim) => ({ sourceFile: result.sourceFile, claim })),
  );
  if (evidenceMismatches.length > 0) {
    console.log("\n[claim hasEvidence 불일치]");
    for (const { sourceFile, claim } of evidenceMismatches) {
      console.log(
        `- ${sourceFile}: "${claim.text}" judge=${claim.reportedHasEvidence}, 재계산=${claim.recalculatedHasEvidence}`,
      );
    }
  }

  console.log("\n=== groundedness 채점 결과 ===");
  console.log("| 파일 | groundable | supported | unsupported | contradicted | 비율 | judge | 재계산/채택 | 점수 불일치 | verdict 강등 | claim 판정 불일치 |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|");
  for (const result of results) {
    const verdictMismatchCount = result.claims.filter((claim) => claim.verdictMismatch).length;
    console.log(
      `| ${result.sourceFile.replace(/\|/g, "\\|")} | ${formatGroundednessCount(result, result.groundableCount)} | ${formatGroundednessCount(result, result.supportedCount)} | ${formatGroundednessCount(result, result.unsupportedCount)} | ${formatGroundednessCount(result, result.contradictedCount)} | ${formatRatio(result.groundedRatio)} | ${formatNullableScore(result.groundednessJudgeScore)} | ${formatNullableScore(result.groundednessScore)} | ${result.groundednessScoreMismatch ? "예" : "아니오"} | ${result.verdictDemotionCount} | ${verdictMismatchCount} |`,
    );
  }

  const verdictMismatches = results.flatMap((result) =>
    result.claims
      .filter((claim) => claim.verdictMismatch)
      .map((claim) => ({ sourceFile: result.sourceFile, claim })),
  );
  if (verdictMismatches.length > 0) {
    console.log("\n[claim grounded verdict 불일치]");
    for (const { sourceFile, claim } of verdictMismatches) {
      console.log(
        `- ${sourceFile}: "${claim.text}" judge=${claim.reportedVerdict ?? "측정 불가"}, 재계산=${claim.recalculatedVerdict ?? "측정 불가"}`,
      );
    }
  }
}

function ingestResults(resultPath: string): void {
  const results = ingestFiles(resultPath);
  const stored: StoredResults = {
    generatedAt: new Date().toISOString(),
    dimension: "specificity/evidence",
    results,
  };
  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = join(DEFAULT_OUTPUT_DIR, RESULTS_FILE_NAME);
  writeFileSync(outputPath, JSON.stringify(stored, null, 2), "utf-8");

  printIngestTable(results);
  console.log(`\nresults.json 저장: ${outputPath}`);
}

// ─── 결과 비교 ───────────────────────────────────────────────────────────────

function isStoredResults(value: unknown): value is StoredResults {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.dimension === "specificity/evidence" && Array.isArray(record.results);
}

function normalizeStoredResult(result: StoredResult): StoredResult {
  const groundednessJudgeScore = result.groundednessJudgeScore ?? null;
  const groundednessScore = result.groundednessScore ?? null;
  return {
    ...result,
    claims: result.claims.map((claim) => {
      const reportedVerdict = claim.reportedVerdict ?? null;
      const recalculatedVerdict = claim.recalculatedVerdict ?? null;
      return {
        ...claim,
        reportedVerdict,
        recalculatedVerdict,
        verdictMismatch: claim.verdictMismatch
          ?? (reportedVerdict !== recalculatedVerdict),
      };
    }),
    groundableCount: result.groundableCount ?? 0,
    supportedCount: result.supportedCount ?? 0,
    unsupportedCount: result.unsupportedCount ?? 0,
    contradictedCount: result.contradictedCount ?? 0,
    groundedRatio: result.groundedRatio ?? null,
    groundednessJudgeScore,
    groundednessScore,
    groundednessScoreMismatch: result.groundednessScoreMismatch
      ?? (groundednessJudgeScore !== groundednessScore),
    verdictDemotionCount: result.verdictDemotionCount ?? 0,
    groundednessRationale: result.groundednessRationale
      ?? "컨텍스트 미제공으로 groundedness 측정 불가",
  };
}

function loadComparisonResults(path: string): StoredResult[] {
  if (statSync(path).isDirectory()) return ingestFiles(path);

  const value = readJsonFile(path);
  if (isStoredResults(value)) return value.results.map(normalizeStoredResult);

  const parsed = JudgeResultSchema.safeParse(value);
  if (parsed.success) {
    return [{ sourceFile: basename(path), ...recalculateJudgeResult(parsed.data) }];
  }
  throw new Error(`${path}: 채점 원본 또는 ingest results.json 형식이 아닙니다.`);
}

function pairResults(
  aResults: StoredResult[],
  bResults: StoredResult[],
): Array<{ label: string; a?: StoredResult; b?: StoredResult }> {
  if (aResults.length === 1 && bResults.length === 1) {
    return [{ label: "specificity/evidence", a: aResults[0], b: bResults[0] }];
  }

  const aByFile = new Map(aResults.map((result) => [result.sourceFile, result]));
  const bByFile = new Map(bResults.map((result) => [result.sourceFile, result]));
  const names = [...new Set([...aByFile.keys(), ...bByFile.keys()])].sort();
  return names.map((name) => ({ label: name, a: aByFile.get(name), b: bByFile.get(name) }));
}

function indexedClaims(claims: ClaimCheck[]): Map<string, ClaimCheck> {
  const counts = new Map<string, number>();
  const indexed = new Map<string, ClaimCheck>();
  for (const claim of claims) {
    const occurrence = (counts.get(claim.text) ?? 0) + 1;
    counts.set(claim.text, occurrence);
    indexed.set(`${claim.text}\u0000${occurrence}`, claim);
  }
  return indexed;
}

function printClaimDifferences(label: string, a: StoredResult, b: StoredResult): void {
  const aClaims = indexedClaims(a.claims);
  const bClaims = indexedClaims(b.claims);
  const keys = [...new Set([...aClaims.keys(), ...bClaims.keys()])];
  const differences = keys.filter((key) => {
    const aClaim = aClaims.get(key);
    const bClaim = bClaims.get(key);
    return !aClaim
      || !bClaim
      || aClaim.recalculatedHasEvidence !== bClaim.recalculatedHasEvidence;
  });
  if (differences.length === 0) return;

  console.log(`\n[${label}: claim 판정 차이]`);
  for (const key of differences) {
    const text = key.slice(0, key.lastIndexOf("\u0000"));
    const aClaim = aClaims.get(key);
    const bClaim = bClaims.get(key);
    const aValue = aClaim ? (aClaim.recalculatedHasEvidence ? "근거 있음" : "근거 없음") : "claim 없음";
    const bValue = bClaim ? (bClaim.recalculatedHasEvidence ? "근거 있음" : "근거 없음") : "claim 없음";
    console.log(`- "${text}" — A: ${aValue}, B: ${bValue}`);
  }
}

function compareResults(aPath: string, bPath: string): void {
  const pairs = pairResults(loadComparisonResults(aPath), loadComparisonResults(bPath));
  console.log("=== specificity/evidence 비교 ===");
  console.log("| 결과 | A 점수 | B 점수 | 점수 차(A-B) | A claim | B claim | claim 수 차(A-B) |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const pair of pairs) {
    const aScore = pair.a?.score;
    const bScore = pair.b?.score;
    const scoreDifference = aScore === undefined || bScore === undefined ? "-" : aScore - bScore;
    const claimDifference = pair.a && pair.b ? pair.a.claimCount - pair.b.claimCount : "-";
    console.log(
      `| ${pair.label.replace(/\|/g, "\\|")} | ${aScore ?? "-"} | ${bScore ?? "-"} | ${scoreDifference} | ${pair.a?.claimCount ?? "-"} | ${pair.b?.claimCount ?? "-"} | ${claimDifference} |`,
    );
    if (pair.a && pair.b) printClaimDifferences(pair.label, pair.a, pair.b);
  }

  console.log("\n=== groundedness 비교 ===");
  console.log("| 결과 | A 점수 | B 점수 | 점수 차(A-B) | A groundable | B groundable | groundable 수 차(A-B) |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const pair of pairs) {
    const aScore = pair.a ? pair.a.groundednessScore ?? null : undefined;
    const bScore = pair.b ? pair.b.groundednessScore ?? null : undefined;
    const scoreDifference = aScore === undefined || bScore === undefined
      ? "-"
      : aScore === null || bScore === null
        ? "측정 불가"
        : aScore - bScore;
    const aGroundableCount = pair.a
      ? pair.a.groundednessJudgeScore === null ? null : pair.a.groundableCount
      : undefined;
    const bGroundableCount = pair.b
      ? pair.b.groundednessJudgeScore === null ? null : pair.b.groundableCount
      : undefined;
    const groundableDifference = aGroundableCount === undefined || bGroundableCount === undefined
      ? "-"
      : aGroundableCount === null || bGroundableCount === null
        ? "측정 불가"
      : aGroundableCount - bGroundableCount;
    console.log(
      `| ${pair.label.replace(/\|/g, "\\|")} | ${aScore === undefined ? "-" : formatNullableScore(aScore)} | ${bScore === undefined ? "-" : formatNullableScore(bScore)} | ${scoreDifference} | ${aGroundableCount === undefined ? "-" : formatNullableScore(aGroundableCount)} | ${bGroundableCount === undefined ? "-" : formatNullableScore(bGroundableCount)} | ${groundableDifference} |`,
    );
  }
}

// ─── 인자 파싱 및 메인 ───────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): CliArgs {
  const [command = "", ...rest] = argv;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`올바르지 않은 인자입니다: ${key ?? "(없음)"}`);
    }
    options.set(key.slice(2), value);
  }
  return { command, options };
}

function requireOption(args: CliArgs, name: string): string {
  const value = args.options.get(name);
  if (!value) throw new Error(`--${name} 옵션이 필요합니다.`);
  return value;
}

function resolveOptionalOption(args: CliArgs, name: string): string | undefined {
  const value = args.options.get(name);
  return value === undefined ? undefined : resolve(value);
}

function assertAllowedOptions(args: CliArgs, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...args.options.keys()].filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) throw new Error(`지원하지 않는 옵션입니다: --${unknown.join(", --")}`);
}

function parseQuestionIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--question은 1 이상의 정수여야 합니다.");
  }
  return parsed;
}

function printUsage(): void {
  console.log(`사용법:
  eval-rubric parse --essay <path>
  eval-rubric emit --essay <path> [--question <index>] [--posting <path>] [--context <path>] [--out <dir>]
  eval-rubric ingest --result <path.json|dir>
  eval-rubric compare --a <path> --b <path>

기본 출력 디렉토리: ${DEFAULT_OUTPUT_DIR}`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === "parse") {
    assertAllowedOptions(args, ["essay"]);
    printParsedQuestions(parseEssayMarkdown(readFileSync(resolve(requireOption(args, "essay")), "utf-8")));
    return;
  }
  if (args.command === "emit") {
    assertAllowedOptions(args, ["essay", "question", "posting", "context", "out"]);
    emitPrompts(
      resolve(requireOption(args, "essay")),
      resolve(args.options.get("out") ?? DEFAULT_OUTPUT_DIR),
      parseQuestionIndex(args.options.get("question")),
      resolveOptionalOption(args, "posting"),
      resolveOptionalOption(args, "context"),
    );
    return;
  }
  if (args.command === "ingest") {
    assertAllowedOptions(args, ["result"]);
    ingestResults(resolve(requireOption(args, "result")));
    return;
  }
  if (args.command === "compare") {
    assertAllowedOptions(args, ["a", "b"]);
    compareResults(resolve(requireOption(args, "a")), resolve(requireOption(args, "b")));
    return;
  }

  printUsage();
  if (args.command) throw new Error(`지원하지 않는 서브커맨드입니다: ${args.command}`);
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("치명적 오류:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
