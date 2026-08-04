import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { OrchestratorGateway } from "../packages/shared/src/core/orchestrator";
import { getProviderCapabilities } from "../packages/shared/src/core/providerOptions";
import type {
  ProviderId,
  ProviderRuntimeState,
  RunActorRole,
  RunEvent,
} from "../packages/shared/src/core/types";
import {
  detectReviewerDropouts,
  resolvePipelineRoles,
  runEvalPipeline,
} from "./eval-pipeline";

async function createFixture(): Promise<{
  root: string;
  essayPath: string;
  postingPath: string;
  draftPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "jasojeon-eval-pipeline-test-"));
  const essayPath = join(root, "essay.md");
  const postingPath = join(root, "posting.md");
  const draftPath = join(root, "draft.md");
  await writeFile(essayPath, [
    "# 가상 지원서",
    "",
    "## [1] 가상의 지원 동기를 설명해 주세요",
    "테스트용 답안입니다.",
    "",
    "## 2. 가상의 협업 경험을 설명해 주세요",
    "두 번째 테스트용 답안입니다.",
  ].join("\n"), "utf8");
  await writeFile(postingPath, "# 가상 공고\n\n가상의 업무를 수행합니다.\n", "utf8");
  await writeFile(draftPath, "가상의 초기 초안입니다.\n", "utf8");
  return { root, essayPath, postingPath, draftPath };
}

function healthyStates(): ProviderRuntimeState[] {
  return (["codex", "claude", "gemini"] as const).map((providerId) => ({
    providerId,
    command: providerId,
    installed: true,
    authMode: "cli",
    authStatus: "healthy",
    hasApiKey: false,
    capabilities: getProviderCapabilities(providerId),
  }));
}

class FakeGateway implements OrchestratorGateway {
  readonly calls: Array<{
    providerId: ProviderId;
    prompt: string;
    participantId?: string;
  }> = [];

  async listRuntimeStates(): Promise<ProviderRuntimeState[]> {
    return healthyStates();
  }

  async getApiKey(): Promise<string | undefined> {
    return undefined;
  }

  async execute(
    providerId: ProviderId,
    prompt: string,
    options: {
      speakerRole?: RunActorRole;
      participantId?: string;
      onEvent?: (event: RunEvent) => Promise<void> | void;
    },
  ): Promise<{ text: string; stdout: string; stderr: string; exitCode: number }> {
    this.calls.push({ providerId, prompt, participantId: options.participantId });
    let text: string;
    if (/section coordinator for an ongoing multi-model essay feedback session/i.test(prompt)) {
      text = [
        "## Current Section", "도입부",
        "## Current Objective", "가상 지원 동기를 구체화합니다.",
        "## Rewrite Direction", "근거를 앞에 둡니다.",
        "## Must Keep", "- 가상 경험",
        "## Must Resolve", "- 연결 근거",
        "## Available Evidence", "- 테스트 근거",
        "## Exit Criteria", "- 한 문단으로 완결",
        "## Next Owner", "section_drafter",
      ].join("\n");
    } else if (/section drafter for a multi-model essay writing workflow/i.test(prompt)) {
      text = "## Section Draft\n가상 근거를 앞에 둔 테스트 초안입니다.";
    } else if (/role-specific reviewer collaborating/i.test(prompt)) {
      text = [
        "## Judgment", "ACCEPT",
        "## Reason", "가상 근거가 명확합니다.",
        "## Condition To Close", "없음",
        "## Direct Responses To Other Reviewers", "없음",
      ].join("\n");
    } else if (/section coordinator deciding whether/i.test(prompt)) {
      text = [
        "## Summary", "테스트 초안이 준비되었습니다.",
        "## Improvement Plan", "- 문장을 다듬습니다.",
        "## Next Owner", "finalizer",
      ].join("\n");
    } else if (/finalizer for a multi-model essay revision workflow/i.test(prompt)) {
      text = [
        "## Final Draft", "가상의 최종 초안입니다.",
        "## Final Checks", "- 테스트 확인 완료",
      ].join("\n");
    } else {
      throw new Error("예상하지 못한 프롬프트");
    }
    return { text, stdout: text, stderr: "", exitCode: 0 };
  }
}

test("role resolution uses all three reviewer providers without fallback collapse", () => {
  const result = resolvePipelineRoles({
    evidence: "codex",
    fit: "claude",
    voice: "gemini",
  });

  assert.deepEqual(result.table, [
    { role: "section_coordinator", providerId: "codex" },
    { role: "section_drafter", providerId: "codex" },
    { role: "evidence_reviewer", providerId: "codex" },
    { role: "fit_reviewer", providerId: "claude" },
    { role: "voice_reviewer", providerId: "gemini" },
    { role: "finalizer", providerId: "codex" },
  ]);
  assert.equal(result.distinctProviderCount, 3);
  assert.equal(result.fallbackCollapse, false);
});

test("role resolution exposes reviewer fallback collapse when only one provider is specified", () => {
  const result = resolvePipelineRoles({ coordinator: "claude" });

  assert.ok(result.table.every((entry) => entry.providerId === "claude"));
  assert.equal(result.distinctProviderCount, 1);
  assert.equal(result.fallbackCollapse, true);
});

test("individual role overrides survive role assignment fallback resolution", () => {
  const result = resolvePipelineRoles({
    coordinator: "codex",
    drafter: "gemini",
    evidence: "claude",
    finalizer: "gemini",
  });

  assert.equal(result.byRole.section_drafter.providerId, "gemini");
  assert.equal(result.byRole.evidence_reviewer.providerId, "claude");
  assert.equal(result.byRole.fit_reviewer.providerId, "claude");
  assert.equal(result.byRole.voice_reviewer.providerId, "claude");
  assert.equal(result.byRole.finalizer.providerId, "gemini");
  assert.equal(result.distinctProviderCount, 3);
  assert.equal(result.distinctReviewerProviderCount, 1);
  assert.equal(result.fallbackCollapse, true);
});

test("dry-run prints the plan and never constructs a provider gateway", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const messages: string[] = [];
  let gatewayConstructed = false;

  const result = await runEvalPipeline([
    "--essay", fixture.essayPath,
    "--question", "1",
    "--posting", fixture.postingPath,
    "--rounds", "2",
    "--coordinator", "claude",
  ], {
    logger: {
      log: (message) => messages.push(message),
      warn: (message) => messages.push(message),
    },
    gatewayFactory: () => {
      gatewayConstructed = true;
      return new FakeGateway();
    },
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(gatewayConstructed, false);
  assert.match(messages.join("\n"), /예상 턴 호출 수: \(4 \+ 3\) × 2 = 14/);
  assert.match(messages.join("\n"), /경고:.*프로바이더/);
});

test("invalid providers, rounds, and missing input files are rejected", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    runEvalPipeline(["--essay", fixture.essayPath, "--question", "1", "--coordinator", "openai"]),
    /providerId.*codex, claude, gemini/,
  );
  await assert.rejects(
    runEvalPipeline(["--essay", fixture.essayPath, "--question", "1", "--rounds", "0"]),
    /--rounds.*1 이상의 정수/,
  );
  await assert.rejects(
    runEvalPipeline(["--essay", join(fixture.root, "missing.md"), "--question", "1"]),
    /자소서 파일이 없습니다/,
  );
  await assert.rejects(
    runEvalPipeline([
      "--essay", fixture.essayPath,
      "--question", "1",
      "--posting", join(fixture.root, "missing-posting.md"),
    ]),
    /공고 파일이 없습니다/,
  );
});

test("question indices outside the parsed essay range are rejected", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    runEvalPipeline(["--essay", fixture.essayPath, "--question", "3"]),
    /문항 3.*찾지 못했습니다/,
  );
});

test("failed reviewer turns record the cycle where the reviewer is permanently dropped", () => {
  const dropouts = detectReviewerDropouts([{
    providerId: "claude",
    participantId: "reviewer-2",
    participantLabel: "Claude fit reviewer",
    role: "reviewer",
    round: 2,
    prompt: "가상 프롬프트",
    response: "",
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:01.000Z",
    status: "failed",
    error: "가상 실패",
  }]);

  assert.deepEqual(dropouts, [{
    role: "fit_reviewer",
    providerId: "claude",
    cycle: 2,
    turn: 1,
    error: "가상 실패",
  }]);
});

test("injected gateways produce complete turn and prompt dumps without real providers", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const outDir = join(fixture.root, "output");
  const gateway = new FakeGateway();

  const result = await runEvalPipeline([
    "--essay", fixture.essayPath,
    "--question", "1",
    "--posting", fixture.postingPath,
    "--draft", fixture.draftPath,
    "--out", outDir,
    "--coordinator", "codex",
    "--evidence", "codex",
    "--fit", "claude",
    "--voice", "gemini",
    "--run",
  ], {
    logger: { log: () => undefined, warn: () => undefined },
    gatewayFactory: () => gateway,
  });

  assert.equal(result.mode, "run");
  assert.equal(gateway.calls.length, 7);
  const turnFiles = await readdir(join(outDir, "turns"));
  assert.equal(turnFiles.filter((name) => name.endsWith(".prompt.md")).length, 7);
  assert.equal(turnFiles.filter((name) => name.endsWith(".md") && !name.endsWith(".prompt.md")).length, 7);

  const runJson = JSON.parse(await readFile(join(outDir, "run.json"), "utf8")) as {
    status: string;
    turns: Array<{ role: string; providerId: string; responseLength: number }>;
  };
  assert.equal(runJson.status, "completed");
  assert.equal(runJson.turns.length, 7);
  assert.ok(runJson.turns.every((turn) => turn.responseLength > 0));

  const report = await readFile(join(outDir, "report.md"), "utf8");
  assert.match(report, /역할→프로바이더 해석표/);
  assert.match(report, /가상의 최종 초안입니다/);
  const firstPrompt = await readFile(join(outDir, "turns", "01-section-coordinator-codex.prompt.md"), "utf8");
  assert.match(firstPrompt, /프롬프트 전문/);
  assert.match(firstPrompt, /ForJob Compiled Context/);
});
