#!/usr/bin/env bun

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextCompiler } from "../packages/shared/src/core/contextCompiler";
import {
  type OrchestratorGateway,
  ReviewOrchestrator,
} from "../packages/shared/src/core/orchestrator";
import { getProviderCapabilities } from "../packages/shared/src/core/providerOptions";
import { defaultProviderCommands } from "../packages/shared/src/core/providerCommandResolver";
import {
  ProviderRegistry,
  type ProviderConfigStore,
  type ProviderSecretStore,
} from "../packages/shared/src/core/providers";
import {
  resolveRoleAssignments,
  reviewRoleOrder,
  type ResolvedRoleAssignments,
} from "../packages/shared/src/core/roleAssignments";
import { ForJobStorage } from "../packages/shared/src/core/storage";
import {
  providerIds,
  type EssayRoleId,
  type ProviderId,
  type ProviderRuntimeState,
  type ReviewTurn,
  type RoleAssignment,
  type RunEvent,
  type RunRecord,
} from "../packages/shared/src/core/types";
import { parseEssayMarkdown, type ParsedQuestion } from "./eval-rubric";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const DEFAULT_ROUNDS = 1;
const DEFAULT_TIMEOUT_MS = 300_000;
const PIPELINE_ROLES = [
  "section_coordinator",
  "section_drafter",
  "evidence_reviewer",
  "fit_reviewer",
  "voice_reviewer",
  "finalizer",
] as const;

export type PipelineRoleId = (typeof PIPELINE_ROLES)[number];

export interface PipelineRoleOptions {
  coordinator?: ProviderId;
  drafter?: ProviderId;
  evidence?: ProviderId;
  fit?: ProviderId;
  voice?: ProviderId;
  finalizer?: ProviderId;
}

export interface PipelineRoleResolution {
  resolved: ResolvedRoleAssignments;
  byRole: ResolvedRoleAssignments["byRole"];
  table: Array<{ role: PipelineRoleId; providerId: ProviderId }>;
  coordinatorProvider: ProviderId;
  reviewerProviders: ProviderId[];
  distinctProviderCount: number;
  distinctReviewerProviderCount: number;
  fallbackCollapse: boolean;
}

interface PipelineOptions extends PipelineRoleOptions {
  essayPath: string;
  question: ParsedQuestion;
  questionIndex: number;
  projectQuestionIndex: number;
  questionTitles: string[];
  postingPath?: string;
  posting?: string;
  draftPath?: string;
  draft: string;
  rounds: number;
  timeoutMs: number;
  outDir: string;
  run: boolean;
}

export interface PipelineLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface PipelineDependencies {
  logger?: PipelineLogger;
  gatewayFactory?: (
    storage: ForJobStorage,
    timeoutMs: number,
  ) => OrchestratorGateway;
}

export type PipelineExecutionResult =
  | { mode: "dry-run"; options: PipelineOptions; roles: PipelineRoleResolution }
  | { mode: "run"; outDir: string; run: RunRecord; turns: ReviewTurn[] };

export interface ReviewerDropout {
  role: PipelineRoleId;
  providerId: ProviderId;
  cycle: number;
  turn: number;
  error?: string;
}

interface ParsedCliArgs {
  options: Map<string, string>;
  run: boolean;
}

interface TurnMetadata {
  sequence: number;
  cycle: number;
  role: string;
  providerId: ProviderId;
  ms: number;
  status: ReviewTurn["status"];
  responseLength: number;
  promptLength: number;
  responseFile: string;
  promptFile: string;
  error?: string;
}

const defaultLogger: PipelineLogger = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

class MemoryProviderConfig implements ProviderConfigStore {
  get(_key: string, fallback?: string): string | undefined {
    return fallback;
  }

  async set(): Promise<void> {}
}

class EmptyProviderSecrets implements ProviderSecretStore {
  async get(): Promise<string | undefined> {
    return undefined;
  }

  async store(): Promise<void> {}

  async delete(): Promise<void> {}
}

class TimedCliGateway implements OrchestratorGateway {
  private readonly registry: ProviderRegistry;

  constructor(storage: ForJobStorage, private readonly timeoutMs: number) {
    this.registry = new ProviderRegistry(
      new MemoryProviderConfig(),
      new EmptyProviderSecrets(),
      storage,
    );
  }

  async listRuntimeStates(): Promise<ProviderRuntimeState[]> {
    return providerIds.map((providerId) => ({
      providerId,
      command: defaultProviderCommands[providerId],
      installed: true,
      authMode: "cli",
      authStatus: "healthy",
      hasApiKey: false,
      capabilities: getProviderCapabilities(providerId),
    }));
  }

  async getApiKey(): Promise<string | undefined> {
    return undefined;
  }

  async execute(
    providerId: ProviderId,
    prompt: string,
    options: Parameters<OrchestratorGateway["execute"]>[2],
  ): Promise<Awaited<ReturnType<OrchestratorGateway["execute"]>>> {
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, this.timeoutMs);
    timer.unref();
    const abortSignal = options.abortSignal
      ? AbortSignal.any([options.abortSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      return await this.registry.execute(providerId, prompt, {
        ...options,
        abortSignal,
      });
    } catch (error) {
      if (timedOut) {
        throw new Error(`${providerId} 턴이 ${this.timeoutMs}ms 제한을 초과했습니다.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function resolvePipelineRoles(options: PipelineRoleOptions): PipelineRoleResolution {
  const coordinatorProvider = options.coordinator ?? providerIds[0];
  const reviewerProviders = [options.evidence, options.fit, options.voice]
    .filter((providerId): providerId is ProviderId => providerId !== undefined);
  const roleAssignments: RoleAssignment[] = [
    options.drafter
      ? makeRoleAssignment("section_drafter", options.drafter)
      : undefined,
    options.evidence
      ? makeRoleAssignment("evidence_reviewer", options.evidence)
      : undefined,
    options.fit
      ? makeRoleAssignment("fit_reviewer", options.fit)
      : undefined,
    options.voice
      ? makeRoleAssignment("voice_reviewer", options.voice)
      : undefined,
    options.finalizer
      ? makeRoleAssignment("finalizer", options.finalizer)
      : undefined,
  ].filter((assignment): assignment is RoleAssignment => assignment !== undefined);
  const resolved = resolveRoleAssignments(
    roleAssignments,
    coordinatorProvider,
    reviewerProviders,
  );
  const table = PIPELINE_ROLES.map((role) => ({
    role,
    providerId: resolved.byRole[role].providerId,
  }));
  const distinctProviderCount = new Set(table.map((entry) => entry.providerId)).size;
  const distinctReviewerProviderCount = new Set(
    reviewRoleOrder.map((role) => resolved.byRole[role].providerId),
  ).size;

  return {
    resolved,
    byRole: resolved.byRole,
    table,
    coordinatorProvider: resolved.byRole.section_coordinator.providerId,
    reviewerProviders: reviewRoleOrder.map((role) => resolved.byRole[role].providerId),
    distinctProviderCount,
    distinctReviewerProviderCount,
    fallbackCollapse: distinctReviewerProviderCount < 3,
  };
}

function makeRoleAssignment(role: EssayRoleId, providerId: ProviderId): RoleAssignment {
  return { role, providerId, useProviderDefaults: true };
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const options = new Map<string, string>();
  let run = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--run") {
      if (run) throw new Error("--run 플래그가 중복되었습니다.");
      run = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`올바르지 않은 인자입니다: ${key ?? "(없음)"}`);
    }
    const name = key.slice(2);
    if (options.has(name)) throw new Error(`--${name} 옵션이 중복되었습니다.`);
    options.set(name, value);
    index += 1;
  }
  return { options, run };
}

function requireOption(args: ParsedCliArgs, name: string): string {
  const value = args.options.get(name);
  if (!value) throw new Error(`--${name} 옵션이 필요합니다.`);
  return value;
}

function assertAllowedOptions(args: ParsedCliArgs): void {
  const allowed = new Set([
    "essay",
    "question",
    "posting",
    "draft",
    "out",
    "rounds",
    "timeout-ms",
    "coordinator",
    "drafter",
    "evidence",
    "fit",
    "voice",
    "finalizer",
  ]);
  const unknown = [...args.options.keys()].filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`지원하지 않는 옵션입니다: --${unknown.join(", --")}`);
  }
}

function parsePositiveInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name}은 1 이상의 정수여야 합니다.`);
  }
  return parsed;
}

function parseProvider(raw: string | undefined, optionName: string): ProviderId | undefined {
  if (raw === undefined) return undefined;
  if (!providerIds.includes(raw as ProviderId)) {
    throw new Error(
      `--${optionName} providerId가 올바르지 않습니다. 유효값: ${providerIds.join(", ")}`,
    );
  }
  return raw as ProviderId;
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${label} 경로가 파일이 아닙니다: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} 파일이 없습니다: ${path}`);
    }
    throw error;
  }
}

function timestampSegment(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function loadPipelineOptions(argv: string[]): Promise<PipelineOptions> {
  const args = parseCliArgs(argv);
  assertAllowedOptions(args);
  const essayPath = resolve(requireOption(args, "essay"));
  const questionIndex = parsePositiveInteger(
    requireOption(args, "question"),
    "question",
    1,
  );
  const postingPath = args.options.get("posting")
    ? resolve(args.options.get("posting")!)
    : undefined;
  const draftPath = args.options.get("draft")
    ? resolve(args.options.get("draft")!)
    : undefined;
  await assertFile(essayPath, "자소서");
  if (postingPath) await assertFile(postingPath, "공고");
  if (draftPath) await assertFile(draftPath, "초안");

  const questions = parseEssayMarkdown(await readFile(essayPath, "utf8"));
  const projectQuestionIndex = questions.findIndex(
    (candidate) => candidate.index === questionIndex,
  );
  if (projectQuestionIndex < 0) {
    throw new Error(`자소서에서 문항 ${questionIndex}을(를) 찾지 못했습니다.`);
  }
  const question = questions[projectQuestionIndex];

  return {
    essayPath,
    question,
    questionIndex,
    projectQuestionIndex,
    questionTitles: questions.map((candidate) => candidate.title),
    postingPath,
    posting: postingPath ? await readFile(postingPath, "utf8") : undefined,
    draftPath,
    draft: draftPath ? await readFile(draftPath, "utf8") : "",
    rounds: parsePositiveInteger(args.options.get("rounds"), "rounds", DEFAULT_ROUNDS),
    timeoutMs: parsePositiveInteger(
      args.options.get("timeout-ms"),
      "timeout-ms",
      DEFAULT_TIMEOUT_MS,
    ),
    outDir: resolve(
      args.options.get("out")
        ?? join(REPO_ROOT, "docs/test_output/pipeline", timestampSegment()),
    ),
    run: args.run,
    coordinator: parseProvider(args.options.get("coordinator"), "coordinator"),
    drafter: parseProvider(args.options.get("drafter"), "drafter"),
    evidence: parseProvider(args.options.get("evidence"), "evidence"),
    fit: parseProvider(args.options.get("fit"), "fit"),
    voice: parseProvider(args.options.get("voice"), "voice"),
    finalizer: parseProvider(args.options.get("finalizer"), "finalizer"),
  };
}

function printPlan(
  logger: PipelineLogger,
  options: PipelineOptions,
  roles: PipelineRoleResolution,
): void {
  logger.log(`=== deepFeedback pipeline ${options.run ? "실행" : "dry-run"} ===`);
  logger.log("| 역할 | 프로바이더 |");
  logger.log("|---|---|");
  for (const entry of roles.table) {
    logger.log(`| ${entry.role} | ${entry.providerId} |`);
  }
  if (roles.fallbackCollapse) {
    logger.warn(
      `경고: 해석된 리뷰어 역할의 서로 다른 프로바이더가 ${roles.distinctReviewerProviderCount}개뿐입니다. reviewerProviders 폴백으로 역할이 같은 프로바이더에 접혔을 수 있습니다.`,
    );
  }
  const reviewerCount = reviewRoleOrder.length;
  const expectedCalls = (4 + reviewerCount) * options.rounds;
  logger.log(
    `예상 턴 호출 수: (4 + ${reviewerCount}) × ${options.rounds} = ${expectedCalls}`,
  );
  logger.log(`문항: ${options.question.index}. ${options.question.title}`);
  logger.log(`자소서 경로: ${options.essayPath}`);
  logger.log(`공고 경로: ${options.postingPath ?? "(없음)"}`);
  logger.log(`초안 경로: ${options.draftPath ?? "(없음 — 빈 문자열)"}`);
  logger.log(`출력 경로: ${options.outDir}`);
  if (!options.run) logger.log("--run이 없어 실제 프로바이더를 호출하지 않고 종료합니다.");
}

export async function runEvalPipeline(
  argv: string[],
  dependencies: PipelineDependencies = {},
): Promise<PipelineExecutionResult> {
  const logger = dependencies.logger ?? defaultLogger;
  const options = await loadPipelineOptions(argv);
  const roles = resolvePipelineRoles(options);
  printPlan(logger, options, roles);
  if (!options.run) return { mode: "dry-run", options, roles };

  await mkdir(options.outDir, { recursive: true });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "jasojeon-eval-pipeline-"));
  let executionError: unknown;
  let returned:
    | { run: RunRecord; turns: ReviewTurn[] }
    | undefined;
  let storedRun: RunRecord | undefined;
  let storedTurns: ReviewTurn[] = [];
  const events: RunEvent[] = [];

  try {
    const storage = new ForJobStorage(workspaceRoot, ".jasojeon-eval");
    await storage.ensureInitialized();
    const project = await storage.createProject({
      companyName: "Pipeline Evaluation",
      roleName: "Evaluation Target",
      jobPostingText: options.posting,
      essayQuestions: options.questionTitles,
    });
    const selectedDocumentIds: string[] = [];
    if (options.posting?.trim()) {
      const postingDocument = await storage.saveProjectTextDocument(
        project.slug,
        "채용 공고 원문",
        options.posting,
        true,
        options.postingPath ? `${basename(options.postingPath)}에서 가져온 평가 컨텍스트` : undefined,
      );
      selectedDocumentIds.push(postingDocument.id);
    }

    const gateway = dependencies.gatewayFactory
      ? dependencies.gatewayFactory(storage, options.timeoutMs)
      : new TimedCliGateway(storage, options.timeoutMs);
    const orchestrator = new ReviewOrchestrator(
      storage,
      new ContextCompiler(storage),
      gateway,
    );

    try {
      const result = await orchestrator.run(
        {
          projectSlug: project.slug,
          projectQuestionIndex: options.projectQuestionIndex,
          question: options.question.title,
          draft: options.draft,
          reviewMode: "deepFeedback",
          roleAssignments: roles.resolved.all,
          coordinatorProvider: roles.coordinatorProvider,
          reviewerProviders: roles.reviewerProviders,
          rounds: options.rounds,
          selectedDocumentIds,
        },
        (event) => {
          events.push(event);
        },
      );
      returned = { run: result.run, turns: result.turns };
    } catch (error) {
      executionError = error;
    }

    storedRun = returned?.run ?? (await storage.listRuns(project.slug))[0];
    if (!storedRun) {
      throw executionError ?? new Error("오케스트레이터 run 레코드를 찾지 못했습니다.");
    }
    storedTurns = await storage.loadReviewTurns(project.slug, storedRun.id)
      ?? returned?.turns
      ?? [];

    await writePipelineOutputs({
      options,
      roles,
      run: storedRun,
      turns: storedTurns,
      events,
      executionError,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  if (executionError) {
    const message = executionError instanceof Error
      ? executionError.message
      : String(executionError);
    throw new Error(`deepFeedback pipeline 실행 실패: ${message} (덤프: ${options.outDir})`);
  }
  if (!storedRun) throw new Error("오케스트레이터 run 결과가 없습니다.");
  logger.log(`실행 덤프 저장: ${options.outDir}`);
  return { mode: "run", outDir: options.outDir, run: storedRun, turns: storedTurns };
}

interface OutputInput {
  options: PipelineOptions;
  roles: PipelineRoleResolution;
  run: RunRecord;
  turns: ReviewTurn[];
  events: RunEvent[];
  executionError?: unknown;
}

async function writePipelineOutputs(input: OutputInput): Promise<void> {
  const turnsDir = join(input.options.outDir, "turns");
  await mkdir(turnsDir, { recursive: true });
  const metadata: TurnMetadata[] = [];

  for (const [index, turn] of input.turns.entries()) {
    const sequence = index + 1;
    const role = turnRoleName(turn);
    const prefix = `${String(sequence).padStart(2, "0")}-${role}-${turn.providerId}`;
    const responseFile = `turns/${prefix}.md`;
    const promptFile = `turns/${prefix}.prompt.md`;
    const ms = turnDurationMs(turn);
    await writeFile(
      join(input.options.outDir, responseFile),
      renderTurnResponse(sequence, role, turn, ms),
      "utf8",
    );
    await writeFile(
      join(input.options.outDir, promptFile),
      renderTurnPrompt(sequence, role, turn, ms),
      "utf8",
    );
    metadata.push({
      sequence,
      cycle: turn.round,
      role,
      providerId: turn.providerId,
      ms,
      status: turn.status,
      responseLength: turn.response.length,
      promptLength: turn.prompt.length,
      responseFile,
      promptFile,
      error: turn.error,
    });
  }

  const reviewerDropouts = detectReviewerDropouts(input.turns);
  const failureMessage = input.executionError instanceof Error
    ? input.executionError.message
    : input.executionError === undefined
      ? undefined
      : String(input.executionError);
  const runJson = {
    generatedAt: new Date().toISOString(),
    status: input.run.status,
    error: failureMessage,
    roleAssignments: input.roles.table,
    distinctProviderCount: input.roles.distinctProviderCount,
    distinctReviewerProviderCount: input.roles.distinctReviewerProviderCount,
    fallbackCollapse: input.roles.fallbackCollapse,
    rounds: input.options.rounds,
    completedRounds: input.run.rounds,
    timeoutMs: input.options.timeoutMs,
    expectedTurnCalls: (4 + reviewRoleOrder.length) * input.options.rounds,
    input: {
      essayPath: input.options.essayPath,
      questionIndex: input.options.question.index,
      questionTitle: input.options.question.title,
      postingPath: input.options.postingPath,
      draftPath: input.options.draftPath,
    },
    runId: input.run.id,
    eventCount: input.events.length,
    turns: metadata,
    failedTurns: metadata.filter((turn) => turn.status === "failed"),
    reviewerDropouts,
  };
  await writeFile(
    join(input.options.outDir, "run.json"),
    `${JSON.stringify(runJson, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(input.options.outDir, "report.md"),
    renderReport(input, metadata, reviewerDropouts, failureMessage),
    "utf8",
  );
}

function renderTurnResponse(
  sequence: number,
  role: string,
  turn: ReviewTurn,
  ms: number,
): string {
  return [
    `# Turn ${String(sequence).padStart(2, "0")}`,
    "",
    `- 역할: ${role}`,
    `- 프로바이더: ${turn.providerId}`,
    `- 사이클: ${turn.round}`,
    `- 소요시간: ${ms}ms`,
    `- 상태: ${turn.status}`,
    ...(turn.error ? [`- 오류: ${turn.error}`] : []),
    "",
    "## 응답 전문",
    "",
    turn.response,
    "",
  ].join("\n");
}

function renderTurnPrompt(
  sequence: number,
  role: string,
  turn: ReviewTurn,
  ms: number,
): string {
  return [
    `# Turn ${String(sequence).padStart(2, "0")} Prompt`,
    "",
    `- 역할: ${role}`,
    `- 프로바이더: ${turn.providerId}`,
    `- 사이클: ${turn.round}`,
    `- 소요시간: ${ms}ms`,
    `- 상태: ${turn.status}`,
    "",
    "## 프롬프트 전문",
    "",
    turn.prompt,
    "",
  ].join("\n");
}

function renderReport(
  input: OutputInput,
  turns: TurnMetadata[],
  reviewerDropouts: ReviewerDropout[],
  failureMessage?: string,
): string {
  const lines = [
    "# deepFeedback Pipeline Report",
    "",
    `- 상태: ${input.run.status}`,
    `- 요청 사이클: ${input.options.rounds}`,
    `- 완료 사이클: ${input.run.rounds}`,
    `- 턴별 제한: ${input.options.timeoutMs}ms`,
    `- 문항: ${input.options.question.index}. ${input.options.question.title}`,
    ...(failureMessage ? [`- 실행 오류: ${failureMessage}`] : []),
    "",
    "## 역할→프로바이더 해석표",
    "",
    "| 역할 | 프로바이더 |",
    "|---|---|",
    ...input.roles.table.map((entry) => `| ${entry.role} | ${entry.providerId} |`),
    "",
  ];
  if (input.roles.fallbackCollapse) {
    lines.push(
      `> 경고: 리뷰어 역할의 서로 다른 프로바이더가 ${input.roles.distinctReviewerProviderCount}개뿐입니다. reviewerProviders 폴백 붕괴가 발생했을 수 있습니다.`,
      "",
    );
  }
  lines.push(
    "## 턴 순서",
    "",
    "| # | 사이클 | 역할 | 프로바이더 | ms | 상태 | 응답 길이 |",
    "|---:|---:|---|---|---:|---|---:|",
    ...turns.map((turn) =>
      `| ${turn.sequence} | ${turn.cycle} | ${turn.role} | ${turn.providerId} | ${turn.ms} | ${turn.status} | ${turn.responseLength} |`
    ),
    "",
    "## 리뷰어 탈락",
    "",
  );
  if (reviewerDropouts.length === 0) {
    lines.push("탈락한 리뷰어가 없습니다.", "");
  } else {
    lines.push(
      "| 사이클 | 역할 | 프로바이더 | 실패 턴 | 오류 |",
      "|---:|---|---|---:|---|",
      ...reviewerDropouts.map((dropout) =>
        `| ${dropout.cycle} | ${dropout.role} | ${dropout.providerId} | ${dropout.turn} | ${escapeTableCell(dropout.error ?? "")} |`
      ),
      "",
    );
  }
  lines.push("## 턴별 응답 전문", "");
  for (const [index, turn] of input.turns.entries()) {
    lines.push(
      `### ${String(index + 1).padStart(2, "0")} · ${turnRoleName(turn)} · ${turn.providerId}`,
      "",
      `- 사이클: ${turn.round}`,
      `- 소요시간: ${turnDurationMs(turn)}ms`,
      `- 상태: ${turn.status}`,
      ...(turn.error ? [`- 오류: ${turn.error}`] : []),
      "",
      turn.response,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function detectReviewerDropouts(turns: ReviewTurn[]): ReviewerDropout[] {
  return turns.flatMap((turn, index) => {
    if (turn.role !== "reviewer" || turn.status !== "failed") return [];
    const role = reviewerPipelineRole(turn);
    if (!role) return [];
    return [{
      role,
      providerId: turn.providerId,
      cycle: turn.round,
      turn: index + 1,
      error: turn.error,
    }];
  });
}

function reviewerPipelineRole(turn: ReviewTurn): PipelineRoleId | undefined {
  switch (turn.participantId) {
    case "reviewer-1":
      return "evidence_reviewer";
    case "reviewer-2":
      return "fit_reviewer";
    case "reviewer-3":
      return "voice_reviewer";
    default:
      return undefined;
  }
}

function turnRoleName(turn: ReviewTurn): string {
  switch (turn.participantId) {
    case "coordinator":
      return "section-coordinator";
    case "section-drafter":
      return "section-drafter";
    case "reviewer-1":
      return "evidence-reviewer";
    case "reviewer-2":
      return "fit-reviewer";
    case "reviewer-3":
      return "voice-reviewer";
    case "finalizer":
      return "finalizer";
    case "context-researcher":
      return "context-researcher";
    default:
      return turn.role;
  }
}

function turnDurationMs(turn: ReviewTurn): number {
  if (!turn.finishedAt) return 0;
  return Math.max(0, Date.parse(turn.finishedAt) - Date.parse(turn.startedAt));
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function printUsage(): void {
  console.log(`사용법:
  eval-pipeline --essay <path> --question <index> [옵션]

역할 옵션:
  --coordinator <providerId>
  --drafter <providerId>
  --evidence <providerId>
  --fit <providerId>
  --voice <providerId>
  --finalizer <providerId>

실행 옵션:
  --posting <path>       공고 원문 md
  --draft <path>         초기 초안 (기본: 빈 문자열)
  --rounds <n>           사이클 수 (기본: ${DEFAULT_ROUNDS})
  --timeout-ms <n>       턴별 제한 (기본: ${DEFAULT_TIMEOUT_MS})
  --out <dir>            출력 디렉토리
  --run                  실제 프로바이더 CLI 실행 (기본: dry-run)

providerId 유효값: ${providerIds.join(", ")}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help")) {
    printUsage();
    return;
  }
  await runEvalPipeline(argv);
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("치명적 오류:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
