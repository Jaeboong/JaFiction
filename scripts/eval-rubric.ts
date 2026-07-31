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
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, ".harness/eval-rubric");
const RESULTS_FILE_NAME = "results.json";

const OUTPUT_SCHEMA_PROMPT = `{
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

// ─── 스키마 ─────────────────────────────────────────────────────────────────

const EvidenceElementsSchema = z.object({
  context: z.boolean(),
  role: z.boolean(),
  result: z.boolean(),
}).strict();

const ClaimSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["self", "link"]),
  elements: EvidenceElementsSchema,
  hasEvidence: z.boolean(),
  note: z.string().min(1),
}).strict();

const ExcludedSchema = z.object({
  text: z.string().min(1),
  reason: z.enum(["aspiration", "company_info", "transition"]),
}).strict();

export const JudgeResultSchema = z.object({
  dimension: z.literal("specificity/evidence"),
  claims: z.array(ClaimSchema),
  excluded: z.array(ExcludedSchema),
  score: z.number().int().min(1).max(5),
  scoreRationale: z.string().min(1),
}).strict();

export type EvidenceElements = z.infer<typeof EvidenceElementsSchema>;
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

interface ClaimCheck extends Omit<JudgeResult["claims"][number], "hasEvidence"> {
  reportedHasEvidence: boolean;
  recalculatedHasEvidence: boolean;
  evidenceMismatch: boolean;
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
  const claims = result.claims.map((claim) => {
    const recalculatedHasEvidence = hasEvidenceFromElements(claim.elements);
    return {
      text: claim.text,
      kind: claim.kind,
      elements: claim.elements,
      note: claim.note,
      reportedHasEvidence: claim.hasEvidence,
      recalculatedHasEvidence,
      evidenceMismatch: claim.hasEvidence !== recalculatedHasEvidence,
    };
  });
  const claimCount = claims.length;
  const evidenceCount = claims.filter((claim) => claim.recalculatedHasEvidence).length;
  const recalculatedScore = calculateScore(claimCount, evidenceCount);

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
  };
}

// ─── 프롬프트 생성 ───────────────────────────────────────────────────────────

function loadAnchorRules(): string {
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

function buildJudgePrompt(
  question: ParsedQuestion,
  anchorRules: string,
  posting: string | undefined,
): string {
  return `# specificity/evidence 평가 요청

아래 규약을 그대로 적용해 자소서 답안을 채점하세요. 규약을 완화하거나 다른 평가 차원을 섞지 마세요.

${anchorRules}

## 평가 대상 문항

문항 ${question.index}. ${question.title}

## 답안

${question.body}

## 공고 원문 요약

${posting?.trim() || "제공되지 않음"}

## 출력 계약

아래 스키마와 정확히 같은 필드만 사용하세요.

\`\`\`json
${OUTPUT_SCHEMA_PROMPT}
\`\`\`

- \`kind\`는 자기 주장이면 \`self\`, 연결 주장이면 \`link\`입니다.
- \`elements\`의 각 값과 \`hasEvidence\`를 독립적으로 빠짐없이 판정하세요.
- \`claims[].text\`와 \`excluded[].text\`는 반드시 답안 원문을 그대로 인용하세요.
- 설명, 마크다운 코드 펜스, 머리말을 붙이지 말고 유효한 JSON 객체만 반환하세요.
`;
}

function emitPrompts(
  essayPath: string,
  outDir: string,
  questionIndex: number | undefined,
  postingPath: string | undefined,
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
  mkdirSync(outDir, { recursive: true });

  console.log(`=== judge 프롬프트 생성 (${selected.length}개) ===`);
  for (const question of selected) {
    const outputPath = join(outDir, `question-${question.index}.prompt.md`);
    writeFileSync(outputPath, buildJudgePrompt(question, anchorRules, posting), "utf-8");
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

function formatRatio(value: number): string {
  return value.toFixed(2);
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

function loadComparisonResults(path: string): StoredResult[] {
  if (statSync(path).isDirectory()) return ingestFiles(path);

  const value = readJsonFile(path);
  if (isStoredResults(value)) return value.results;

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
  eval-rubric emit --essay <path> [--question <index>] [--posting <path>] [--out <dir>]
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
    assertAllowedOptions(args, ["essay", "question", "posting", "out"]);
    emitPrompts(
      resolve(requireOption(args, "essay")),
      resolve(args.options.get("out") ?? DEFAULT_OUTPUT_DIR),
      parseQuestionIndex(args.options.get("question")),
      args.options.get("posting") ? resolve(args.options.get("posting")!) : undefined,
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
