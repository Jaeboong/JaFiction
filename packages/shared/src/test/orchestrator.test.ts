import * as assert from "node:assert/strict";
import test from "node:test";
import { ContextCompiler } from "../core/contextCompiler";
import { OrchestratorGateway, ReviewOrchestrator, UserInterventionRequest } from "../core/orchestrator";
import {
  buildRealtimeCoordinatorDiscussionPrompt,
  buildRealtimeReviewerPrompt
} from "../core/orchestrator/prompts/realtimePrompts";
import {
  extractNormalizedReviewerChallenge,
  extractRealtimeReviewerChallengeAction,
  extractRealtimeReviewerObjection,
  splitSectionDraftOutput
} from "../core/orchestrator/parsing/responseParsers";
import { getProviderCapabilities } from "../core/providerOptions";
import { parseReviewerCardContent } from "../core/reviewerCard";
import {
  DiscussionLedger,
  ProviderRuntimeState,
  RunChatMessage,
  ReviewTurn,
  RunAbortedError,
  RunActorRole,
  RunEvent,
  RunInterventionAbortError
} from "../core/types";
import { cleanupTempWorkspace, createStorage, createTempWorkspace } from "./helpers";

class FakeGateway implements OrchestratorGateway {
  public readonly calls: Array<{
    providerId: ProviderRuntimeState["providerId"];
    prompt: string;
    round?: number;
    messageScope?: string;
    participantId?: string;
    participantLabel?: string;
    modelOverride?: string;
    effortOverride?: string;
  }> = [];

  constructor(
    private readonly states: ProviderRuntimeState[],
    private readonly responder: (
      providerId: ProviderRuntimeState["providerId"],
      prompt: string,
      round?: number,
      options?: {
        round?: number;
        speakerRole?: RunActorRole;
        messageScope?: string;
        participantId?: string;
        participantLabel?: string;
        modelOverride?: string;
        effortOverride?: string;
        onEvent?: (event: RunEvent) => Promise<void> | void;
        abortSignal?: AbortSignal;
      }
    ) => string | Error,
    private readonly streamer?: (
      providerId: ProviderRuntimeState["providerId"],
      prompt: string,
      options: {
        round?: number;
        speakerRole?: RunActorRole;
        messageScope?: string;
        participantId?: string;
        participantLabel?: string;
        modelOverride?: string;
        effortOverride?: string;
        onEvent?: (event: RunEvent) => Promise<void> | void;
        abortSignal?: AbortSignal;
      }
    ) => Promise<void> | void
  ) {}

  async listRuntimeStates(): Promise<ProviderRuntimeState[]> {
    return this.states;
  }

  async getApiKey(): Promise<string | undefined> {
    return undefined;
  }

  async execute(
    providerId: ProviderRuntimeState["providerId"],
    prompt: string,
    options: {
      round?: number;
      speakerRole?: RunActorRole;
      messageScope?: string;
      participantId?: string;
      participantLabel?: string;
      modelOverride?: string;
      effortOverride?: string;
      onEvent?: (event: RunEvent) => Promise<void> | void;
      abortSignal?: AbortSignal;
    }
  ): Promise<{ text: string; stdout: string; stderr: string; exitCode: number }> {
    this.calls.push({
      providerId,
      prompt,
      round: options.round,
      messageScope: options.messageScope,
      participantId: options.participantId,
      participantLabel: options.participantLabel,
      modelOverride: options.modelOverride,
      effortOverride: options.effortOverride
    });
    if (this.streamer) {
      await this.streamer(providerId, prompt, options);
    }
    const response = this.responder(providerId, prompt, options.round, options);
    if (response instanceof Error) {
      throw response;
    }

    return {
      text: response,
      stdout: response,
      stderr: "",
      exitCode: 0
    };
  }
}

function healthyStates(): ProviderRuntimeState[] {
  return [
    { providerId: "codex", command: "codex", installed: true, authMode: "cli", authStatus: "healthy", hasApiKey: false, capabilities: getProviderCapabilities("codex") },
    { providerId: "claude", command: "claude", installed: true, authMode: "cli", authStatus: "healthy", hasApiKey: false, capabilities: getProviderCapabilities("claude") },
    { providerId: "gemini", command: "gemini", installed: true, authMode: "cli", authStatus: "healthy", hasApiKey: false, capabilities: getProviderCapabilities("gemini") }
  ];
}

function buildRealtimeLedgerResponse(options: {
  currentFocus: string;
  targetSection?: string;
  targetSectionKey?: string;
  currentObjective?: string;
  rewriteDirection?: string;
  mustKeep?: string[];
  mustResolve?: string[];
  availableEvidence?: string[];
  exitCriteria?: string[];
  nextOwner?: string;
  miniDraft: string;
  acceptedDecisions?: string[];
  openChallenges?: string[];
  deferredChallenges?: string[];
  sectionOutcome?: "keep-open" | "close-section" | "handoff-next-section" | "write-final" | "deferred-close";
  challengeDecisionLines?: string[];
}): string {
  return [
    "## Current Focus",
    options.currentFocus,
    "",
    "## Target Section",
    options.targetSection || "핵심 문단",
    "",
    ...(options.targetSectionKey
      ? ["## Target Section Key", options.targetSectionKey]
      : []),
    "",
    ...(options.currentObjective ? ["## Current Objective", options.currentObjective, ""] : []),
    ...(options.rewriteDirection ? ["## Rewrite Direction", options.rewriteDirection, ""] : []),
    "## Must Keep",
    ...(options.mustKeep && options.mustKeep.length > 0 ? options.mustKeep.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Must Resolve",
    ...(options.mustResolve && options.mustResolve.length > 0 ? options.mustResolve.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Available Evidence",
    ...(options.availableEvidence && options.availableEvidence.length > 0 ? options.availableEvidence.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Exit Criteria",
    ...(options.exitCriteria && options.exitCriteria.length > 0 ? options.exitCriteria.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Next Owner",
    options.nextOwner ?? "section_drafter",
    "",
    "## Mini Draft",
    options.miniDraft,
    "",
    "## Accepted Decisions",
    ...(options.acceptedDecisions && options.acceptedDecisions.length > 0 ? options.acceptedDecisions.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Open Challenges",
    ...(options.openChallenges && options.openChallenges.length > 0 ? options.openChallenges.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Deferred Challenges",
    ...(options.deferredChallenges && options.deferredChallenges.length > 0 ? options.deferredChallenges.map((item) => `- ${item}`) : ["- 없음"]),
    ...(options.sectionOutcome
      ? ["", "## Section Outcome", options.sectionOutcome]
      : []),
    ...(options.challengeDecisionLines && options.challengeDecisionLines.length > 0
      ? ["", "## Challenge Decisions", ...options.challengeDecisionLines]
      : [])
  ].join("\n");
}

function buildRealtimeInterventionResponse(options: {
  decision: "accept" | "redirect" | "clarify";
  reason: string;
  clarifyingQuestion?: string;
  currentFocus?: string;
  targetSection?: string;
  targetSectionKey?: string;
  currentObjective?: string;
  rewriteDirection?: string;
  mustKeep?: string[];
  mustResolve?: string[];
  availableEvidence?: string[];
  exitCriteria?: string[];
  nextOwner?: string;
  miniDraft?: string;
  acceptedDecisions?: string[];
  openChallenges?: string[];
  deferredChallenges?: string[];
  sectionOutcome?: "keep-open" | "close-section" | "handoff-next-section" | "write-final" | "deferred-close";
  challengeDecisionLines?: string[];
}): string {
  return [
    "## Decision",
    options.decision,
    "",
    "## Reason",
    options.reason,
    "",
    "## Current Focus",
    options.currentFocus ?? "사용자 지시에 맞춰 방향을 재정렬합니다.",
    "",
    "## Target Section",
    options.targetSection ?? "핵심 문단",
    "",
    ...(options.targetSectionKey ? ["## Target Section Key", options.targetSectionKey, ""] : []),
    "## Current Objective",
    options.currentObjective ?? "사용자 지시를 반영한 새 목표를 분명하게 정리합니다.",
    "",
    "## Rewrite Direction",
    options.rewriteDirection ?? "사용자 지시를 기준으로 섹션 방향을 다시 잡습니다.",
    "",
    "## Must Keep",
    ...((options.mustKeep && options.mustKeep.length > 0) ? options.mustKeep.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Must Resolve",
    ...((options.mustResolve && options.mustResolve.length > 0) ? options.mustResolve.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Available Evidence",
    ...((options.availableEvidence && options.availableEvidence.length > 0) ? options.availableEvidence.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Exit Criteria",
    ...((options.exitCriteria && options.exitCriteria.length > 0) ? options.exitCriteria.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Next Owner",
    options.nextOwner ?? "section_drafter",
    "",
    "## Mini Draft",
    options.miniDraft ?? "새 방향을 반영한 미니 초안입니다.",
    "",
    "## Accepted Decisions",
    ...((options.acceptedDecisions && options.acceptedDecisions.length > 0) ? options.acceptedDecisions.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Open Challenges",
    ...((options.openChallenges && options.openChallenges.length > 0) ? options.openChallenges.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Deferred Challenges",
    ...((options.deferredChallenges && options.deferredChallenges.length > 0) ? options.deferredChallenges.map((item) => `- ${item}`) : ["- 없음"]),
    "",
    "## Section Outcome",
    options.sectionOutcome ?? "keep-open",
    "",
    "## Challenge Decisions",
    ...((options.challengeDecisionLines && options.challengeDecisionLines.length > 0) ? options.challengeDecisionLines : ["- 없음"]),
    "",
    "## Clarifying Question",
    options.clarifyingQuestion ?? "- 없음"
  ].join("\n");
}

test("splitSectionDraftOutput returns fallbackDraft when the Section Draft heading is missing", () => {
  const parsed = splitSectionDraftOutput(
    [
      "## Current Focus",
      "핵심 방향을 다시 정리합니다.",
      "",
      "## Rewrite Direction",
      "성과와 협업 연결을 더 압축합니다."
    ].join("\n"),
    "기존 초안"
  );

  assert.equal(parsed.sectionDraft, "기존 초안");
  assert.equal(parsed.changeRationale, "");
});

test("orchestrator completes a run, writes artifacts, and remembers the coordinator", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Five years of fintech work", true);
  await storage.saveProjectTextDocument(project.slug, "Posting", "Risk platform ownership", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt) => {
    if (providerId === "claude" && /You are the finalizer for a multi-model essay revision workflow/i.test(prompt)) {
      return [
        "## Final Draft",
        "Rewritten essay",
        "## Final Checks",
        "- Final evidence check remains pending.",
        "- Cross-verify the quantified outcomes."
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "Strong draft with room for sharper evidence.", "## Improvement Plan", "- Add quantified outcomes.", "## Revised Draft", "Rewritten essay"].join("\n");
    }

    return ["## Overall Verdict", "Solid base", "## Strengths", "- Clear motivation", "## Problems", "- Missing metrics", "## Suggestions", "- Add numbers", "## Direct Responses To Other Reviewers", "- None"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Shinhan Bank?",
      draft: "I want to join because I like finance.",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 2,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    }
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.artifacts.revisedDraft, "Rewritten essay");
  assert.match(result.artifacts.finalChecks ?? "", /Final evidence check remains pending/);
  const summary = await storage.readOptionalRunArtifact(project.slug, result.run.id, "summary.md");
  const improvementPlan = await storage.readOptionalRunArtifact(project.slug, result.run.id, "improvement-plan.md");
  const revisedDraft = await storage.readOptionalRunArtifact(project.slug, result.run.id, "revised-draft.md");
  const finalChecks = await storage.readOptionalRunArtifact(project.slug, result.run.id, "final-checks.md");
  assert.ok(summary);
  assert.ok(improvementPlan);
  assert.ok(revisedDraft);
  assert.ok(finalChecks);
  assert.match(summary, /Strong draft/);
  assert.match(improvementPlan, /quantified outcomes/);
  assert.match(revisedDraft, /Rewritten essay/);
  assert.match(finalChecks, /Final evidence check remains pending/);
  assert.equal((await storage.getPreferences()).lastCoordinatorProvider, "claude");
  assert.equal((await storage.getPreferences()).lastReviewMode, "deepFeedback");
  assert.ok(events.some((event) => event.type === "run-completed"));
});

test("deep feedback sanitizes stored drafter turns when the raw response includes coordinator headings", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Five years of fintech work", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, _round, options) => {
    if (/You are the finalizer for a multi-model essay revision workflow/i.test(prompt)) {
      return ["## Final Draft", "최종 통합 초안"].join("\n");
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Current Focus",
        "지원 동기와 협업 성과를 함께 닫습니다.",
        "",
        "## Current Objective",
        "협업 문단을 더 설득력 있게 정리합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Section Draft",
        "협업 장면과 성과를 함께 보여주는 문단입니다.",
        "",
        "## Change Rationale",
        "핵심 방향을 본문 문장으로만 남겼습니다."
      ].join("\n");
    }

    if (
      options?.speakerRole === "coordinator"
      && /deciding whether the drafted section is ready to integrate/i.test(prompt)
    ) {
      return [
        "## Summary",
        "현재 섹션은 통합 가능합니다.",
        "## Improvement Plan",
        "- 현재 섹션을 본문에 반영합니다.",
        "## Next Owner",
        "finalizer"
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      return [
        "## Current Section",
        "협업 문단",
        "",
        "## Current Objective",
        "지원 동기와 협업 성과를 한 문단에서 함께 설득합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Must Keep",
        "- 지원 동기 연결",
        "",
        "## Must Resolve",
        "- 핵심 문장을 한 번 더 압축합니다.",
        "",
        "## Available Evidence",
        "- 운영 안정화 경험",
        "",
        "## Exit Criteria",
        "- 협업과 성과가 한 문단에서 함께 읽힌다.",
        "",
        "## Next Owner",
        "section_drafter"
      ].join("\n");
    }

    return [
      "## Judgment",
      "ACCEPT",
      "## Reason",
      "현재 섹션은 통합 가능합니다.",
      "## Condition To Close",
      "- 없음",
      "## Direct Responses To Other Reviewers",
      "- 없음"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Shinhan Bank?",
    draft: "I want to join because I like finance.",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const storedTurnsRaw = await storage.readOptionalRunArtifact(project.slug, result.run.id, "review-turns.json");
  assert.ok(storedTurnsRaw);
  const storedTurns = JSON.parse(storedTurnsRaw) as ReviewTurn[];
  const drafterTurn = storedTurns.find((turn) => turn.role === "drafter");
  assert.ok(drafterTurn);
  assert.equal(drafterTurn?.response, "협업 장면과 성과를 함께 보여주는 문단입니다.");
  assert.doesNotMatch(drafterTurn?.response ?? "", /Current Focus|Current Objective|Rewrite Direction/);
});

test("orchestrator continues after one reviewer fails while another remains", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kakao");
  await storage.saveProfileTextDocument("Career", "Built internal tools", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "gemini" && round === 1) {
      return new Error("Gemini failed in round 1");
    }
    if (providerId === "claude") {
      return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Tighten opening", "## Revised Draft", "Updated draft"].join("\n");
    }
    return ["## Overall Verdict", "Useful", "## Strengths", "- Specific", "## Problems", "- Long intro", "## Suggestions", "- Trim intro", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kakao?",
    draft: "I enjoy platform engineering.",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.run.status, "completed");
  assert.ok(result.turns.some((turn) => turn.providerId === "gemini" && turn.status === "failed"));
  assert.ok(result.turns.some((turn) => turn.providerId === "codex" && turn.status === "completed"));
});

test("orchestrator rejects runs with unhealthy selected participants", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Naver");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(
    [
      { providerId: "codex", command: "codex", installed: true, authMode: "cli", authStatus: "healthy", hasApiKey: false, capabilities: getProviderCapabilities("codex") },
      { providerId: "claude", command: "claude", installed: true, authMode: "cli", authStatus: "untested", hasApiKey: false, capabilities: getProviderCapabilities("claude") }
    ],
    () => "unused"
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await assert.rejects(() =>
    orchestrator.run({
      projectSlug: project.slug,
      question: "Why Naver?",
      draft: "Draft",
      reviewMode: "deepFeedback",
      coordinatorProvider: "codex",
      reviewerProviders: ["claude"],
      rounds: 1,
      selectedDocumentIds: []
    })
  );
});

test("orchestrator runs a coordinator notion pre-pass and shares the notion brief with reviewers", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("CJ OliveNetworks");
  await storage.saveProfileTextDocument("Career", "Built commerce and platform products", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude" && round === 0) {
      return [
        "## Resolution",
        "Confident match with the CJ OliveNetworks hiring notes page.",
        "## Notion Brief",
        "CJ OliveNetworks focuses on commerce, DX, and platform delivery. Emphasize measurable collaboration and implementation ownership.",
        "## Sources Considered",
        "- CJ OliveNetworks hiring notes",
        "- CJ OliveNetworks interview notes"
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "Use the brief well.", "## Improvement Plan", "- Reflect the platform and DX angle.", "## Revised Draft", "Updated final essay"].join("\n");
    }

    return ["## Overall Verdict", "Useful", "## Strengths", "- Concrete motivation", "## Problems", "- Needs more company alignment", "## Suggestions", "- Mention DX and platform ownership", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why CJ OliveNetworks?",
    draft: "I want to join because I like building services.",
    reviewMode: "deepFeedback",
    notionRequest: "CJ 올리브네트웍스 페이지 가져와서 파악해",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const notionArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "notion-brief.md");
  assert.ok(notionArtifact);
  assert.match(notionArtifact, /## Notion Brief/);
  assert.match(result.run.notionRequest ?? "", /CJ 올리브네트웍스/);
  assert.match(result.run.notionBrief ?? "", /commerce, DX, and platform delivery/i);

  const notionCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 0);
  assert.ok(notionCall);
  assert.match(notionCall.prompt, /use your configured Notion MCP tools/i);

  const reviewerCalls = gateway.calls.filter(
    (call) => call.round === 1 && call.participantId?.startsWith("reviewer-")
  );
  assert.equal(reviewerCalls.length, 3);
  assert.ok(reviewerCalls.every((call) => /## Notion Brief/.test(call.prompt)));
  assert.ok(reviewerCalls.every((call) => /Do not search Notion/.test(call.prompt)));
});

test("orchestrator routes role assignments and override settings to researcher and reviewers", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("CJ OliveNetworks");
  await storage.saveProfileTextDocument("Career", "Built commerce and platform products", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt) => {
    if (/use your configured Notion MCP tools/i.test(prompt)) {
      return [
        "## Resolution",
        "Found the most relevant hiring notes.",
        "## Notion Brief",
        "CJ OliveNetworks expects platform delivery ownership and measurable collaboration.",
        "## Sources Considered",
        "- CJ OliveNetworks hiring notes"
      ].join("\n");
    }

    if (providerId === "claude") {
      return [
        "## Summary",
        "Use the platform-delivery brief more explicitly.",
        "## Improvement Plan",
        "- Connect measurable collaboration to the target role.",
        "## Revised Draft",
        "Updated final essay"
      ].join("\n");
    }

    return [
      "## Overall Verdict",
      "Useful",
      "## Strengths",
      "- Concrete role mapping",
      "## Problems",
      "- Needs stronger evidence",
      "## Suggestions",
      "- Add implementation detail",
      "## Direct Responses To Other Reviewers",
      "- Agree"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const roleAssignments = [
    { role: "context_researcher", providerId: "codex", useProviderDefaults: false, modelOverride: "gpt-5.4-mini", effortOverride: "high" },
    { role: "section_coordinator", providerId: "claude", useProviderDefaults: true },
    { role: "section_drafter", providerId: "claude", useProviderDefaults: true },
    { role: "fit_reviewer", providerId: "gemini", useProviderDefaults: false, modelOverride: "gemini-2.5-pro" },
    { role: "evidence_reviewer", providerId: "codex", useProviderDefaults: false, modelOverride: "gpt-5.4", effortOverride: "medium" },
    { role: "voice_reviewer", providerId: "claude", useProviderDefaults: false, modelOverride: "sonnet", effortOverride: "max" },
    { role: "finalizer", providerId: "claude", useProviderDefaults: true }
  ] as const;

  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why CJ OliveNetworks?",
    draft: "I want to join because I like building services.",
    reviewMode: "deepFeedback",
    notionRequest: "CJ 올리브네트웍스 관련 노션 맥락을 가져와줘",
    roleAssignments: [...roleAssignments],
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini", "claude"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.run.roleAssignments?.length, 7);
  const researcherCall = gateway.calls.find((call) => call.participantId === "context-researcher");
  assert.ok(researcherCall);
  assert.equal(researcherCall.providerId, "codex");
  assert.equal(researcherCall.modelOverride, "gpt-5.4-mini");
  assert.equal(researcherCall.effortOverride, "high");
  assert.match(researcherCall.prompt, /Notion MCP tools/i);

  const evidenceCall = gateway.calls.find((call) => call.participantId === "reviewer-1");
  assert.ok(evidenceCall);
  assert.equal(evidenceCall.providerId, "codex");
  assert.equal(evidenceCall.modelOverride, "gpt-5.4");
  assert.equal(evidenceCall.effortOverride, "medium");
  assert.match(evidenceCall.participantLabel ?? "", /evidence reviewer/i);

  const fitCall = gateway.calls.find((call) => call.participantId === "reviewer-2");
  assert.ok(fitCall);
  assert.equal(fitCall.providerId, "gemini");
  assert.equal(fitCall.modelOverride, "gemini-2.5-pro");
  assert.equal(fitCall.effortOverride, undefined);
  assert.match(fitCall.participantLabel ?? "", /fit reviewer/i);

  const voiceCall = gateway.calls.find((call) => call.participantId === "reviewer-3");
  assert.ok(voiceCall);
  assert.equal(voiceCall.providerId, "claude");
  assert.equal(voiceCall.modelOverride, "sonnet");
  assert.equal(voiceCall.effortOverride, "max");
  assert.match(voiceCall.participantLabel ?? "", /voice reviewer/i);
});

test("orchestrator skips notion pre-pass for punctuation-only notion requests without fixed pages", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Naver");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude" && round === 0) {
      return [
        "## Resolution",
        "노션 확인",
        "## Notion Brief",
        "노션 브리프",
        "## Sources Considered",
        "- 페이지"
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Tighten examples", "## Revised Draft", "Updated draft"].join("\n");
    }

    return ["## Overall Verdict", "Useful", "## Strengths", "- Clear", "## Problems", "- Needs evidence", "## Suggestions", "- Add numbers", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);

  await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Naver?",
    draft: "검색과 플랫폼 문제를 풀고 싶습니다.",
    reviewMode: "deepFeedback",
    notionRequest: ".",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(
    gateway.calls.some((call) => call.providerId === "claude" && call.round === 0),
    false
  );

  await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Naver?",
    draft: "검색과 플랫폼 문제를 풀고 싶습니다.",
    reviewMode: "deepFeedback",
    notionRequest: "네이버 관련 노션 페이지를 찾아줘",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(
    gateway.calls.some((call) => call.providerId === "claude" && call.round === 0 && /## User Notion Request/.test(call.prompt)),
    true
  );
});

test("orchestrator carries previous run context into a continuation run", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Bucketplace");
  await storage.saveProfileTextDocument("Career", "Built user-facing platform features", true);

  await storage.createRun({
    id: "prior-run",
    projectSlug: project.slug,
    question: "Why Bucketplace?",
    draft: "기존 초안",
    reviewMode: "deepFeedback",
    notionRequest: "버킷플레이스 자료 찾아줘",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  });
  await storage.saveRunTextArtifact(project.slug, "prior-run", "summary.md", "이전 요약");
  await storage.saveRunTextArtifact(project.slug, "prior-run", "improvement-plan.md", "- 협업을 더 강조");
  await storage.saveRunTextArtifact(project.slug, "prior-run", "revised-draft.md", "이전 수정 초안");
  await storage.saveRunTextArtifact(project.slug, "prior-run", "notion-brief.md", "이전 노션 브리프");
  await storage.saveRunChatMessages(project.slug, "prior-run", [
    {
      id: "chat-1",
      providerId: "claude",
      speaker: "Claude",
      speakerRole: "coordinator",
      recipient: "You",
      round: 2,
      content: "협업과 사용자 관점을 더 드러내면 좋겠습니다.",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ]);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId) => {
    if (providerId === "claude") {
      return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Keep the collaboration angle", "## Revised Draft", "Updated draft"].join("\n");
    }
    return ["## Overall Verdict", "Useful", "## Strengths", "- Good continuation", "## Problems", "- Need sharper closing", "## Suggestions", "- Keep collaboration central", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Bucketplace now?",
    draft: "새 초안",
    reviewMode: "deepFeedback",
    continuationFromRunId: "prior-run",
    continuationNote: "이전 논의를 이어서 협업 강조 방향으로 더 다듬어줘",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  }, async (event) => {
    events.push(event);
  });

  assert.equal(result.run.continuationFromRunId, "prior-run");
  assert.match(result.run.continuationNote ?? "", /협업 강조/);

  const reviewerPrompt = gateway.calls.find((call) => call.providerId === "codex" && call.round === 1);
  assert.ok(reviewerPrompt);
  assert.match(reviewerPrompt.prompt, /## Previous Run Context/);
  assert.match(reviewerPrompt.prompt, /## User Guidance/);
  assert.match(reviewerPrompt.prompt, /Before Start/);
  assert.match(reviewerPrompt.prompt, /이전 요약/);
  assert.match(reviewerPrompt.prompt, /이전 수정 초안/);
  assert.match(reviewerPrompt.prompt, /협업과 사용자 관점을 더 드러내면 좋겠습니다/);
  assert.match(reviewerPrompt.prompt, /이전 논의를 이어서 협업 강조 방향으로 더 다듬어줘/);
  assert.equal(reviewerPrompt.participantId, "reviewer-1");
  assert.match(reviewerPrompt.messageScope ?? "", new RegExp(`run-${result.run.id}-deep-cycle-1-reviewer-reviewer-1`));

  const userContinuationDelta = events.find((event) =>
    event.type === "chat-message-delta" &&
    event.speakerRole === "user" &&
    event.message?.includes("협업 강조 방향")
  );
  assert.ok(userContinuationDelta);
});

test("continuation note that mentions notion triggers a fresh notion pre-pass and is treated as latest user guidance", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Built backend systems", true);

  await storage.createRun({
    id: "prior-run",
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "기존 초안",
    reviewMode: "deepFeedback",
    notionRequest: "이전 노션 요청",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  });
  await storage.saveRunTextArtifact(project.slug, "prior-run", "revised-draft.md", "이전 수정 초안");
  await storage.saveRunTextArtifact(project.slug, "prior-run", "notion-brief.md", "이전 노션 브리프");

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude" && round === 0) {
      return [
        "## Resolution",
        "Campung 관련 최신 노션 페이지를 다시 확인했습니다.",
        "## Notion Brief",
        "Campung는 금융 해커톤이 아니라 운영 백엔드 경험으로 정리해야 합니다.",
        "## Sources Considered",
        "- Campung 정정 메모"
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "정리 완료", "## Improvement Plan", "- 신한 연결을 더 선명하게", "## Revised Draft", "새 초안"].join("\n");
    }

    return ["## Overall Verdict", "Useful", "## Strengths", "- Good correction", "## Problems", "- Needs clearer bank fit", "## Suggestions", "- Use corrected Campung framing", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const continuationNote = "CAMPUNG에 대한 내용이 노션에 잘못 기재돼있었다. 다시 파악하고 진행해";
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "새 초안",
    reviewMode: "deepFeedback",
    continuationFromRunId: "prior-run",
    continuationNote,
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.match(result.run.notionRequest ?? "", /노션에 잘못 기재/);
  const notionCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 0);
  assert.ok(notionCall);
  assert.match(notionCall.prompt, /## User Notion Request/);
  assert.match(notionCall.prompt, /CAMPUNG에 대한 내용이 노션에 잘못 기재돼있었다/);

  const reviewerCall = gateway.calls.find((call) => call.providerId === "codex" && call.round === 1);
  assert.ok(reviewerCall);
  assert.match(reviewerCall.prompt, /## User Guidance/);
  assert.match(reviewerCall.prompt, /Before Start/);
  assert.match(reviewerCall.prompt, /다시 파악하고 진행해/);
  assert.match(reviewerCall.prompt, /Campung는 금융 해커톤이 아니라 운영 백엔드 경험으로 정리해야 합니다/);
});

test("deep feedback prompts explicitly require Korean responses while preserving English headings", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Built backend systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude" && round === 0) {
      return [
        "## Resolution",
        "노션 확인 완료",
        "## Notion Brief",
        "Campung 정정 내용",
        "## Sources Considered",
        "- 노션 페이지"
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "정리 완료", "## Improvement Plan", "- 신한 연결 보강", "## Revised Draft", "새 초안"].join("\n");
    }

    return ["## Overall Verdict", "유용함", "## Strengths", "- 정정 반영", "## Problems", "- 신한 연결 약함", "## Suggestions", "- 동기 강화", "## Direct Responses To Other Reviewers", "- 동의"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "deepFeedback",
    notionRequest: "Campung 내용을 노션에서 다시 확인해줘",
    coordinatorProvider: "claude",
    reviewerProviders: ["gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const notionCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 0);
  assert.ok(notionCall);
  assert.match(notionCall.prompt, /Write all substantive content in Korean \(한국어\)/);
  assert.match(notionCall.prompt, /Keep the required English top-level section headings exactly as written/);

  const reviewerCall = gateway.calls.find((call) => call.providerId === "gemini" && call.round === 1);
  assert.ok(reviewerCall);
  assert.match(reviewerCall.prompt, /Write all substantive content in Korean \(한국어\)/);
  assert.match(reviewerCall.prompt, /Keep the required English section headings exactly as written/);

  const coordinatorCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 1);
  assert.ok(coordinatorCall);
  assert.match(coordinatorCall.prompt, /Write all substantive content in Korean \(한국어\)/);
  assert.match(coordinatorCall.prompt, /Keep the required English section headings exactly as written/);
});

test("orchestrator persists streamed chat messages emitted during provider turns", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Line");
  await storage.saveProfileTextDocument("Career", "Built collaboration tools", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(
    healthyStates(),
    (providerId) => {
      if (providerId === "claude") {
        return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Tighten examples", "## Revised Draft", "Updated draft"].join("\n");
      }
      return ["## Overall Verdict", "Useful", "## Strengths", "- Clear", "## Problems", "- Needs stronger metrics", "## Suggestions", "- Add outcomes", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
    },
    async (providerId, _prompt, options) => {
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-started",
        providerId,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-delta",
        providerId,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: `${providerId} says hello`
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-completed",
        providerId,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Line?",
    draft: "I enjoy platform work.",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "chat-messages.json");
  assert.ok(chatArtifact);
  assert.match(chatArtifact, /codex says hello/);
  assert.match(chatArtifact, /claude says hello/);

  const runLog = await storage.readOptionalRunArtifact(project.slug, result.run.id, "run-log.txt");
  assert.ok(runLog);
  assert.match(runLog, /Reviewer:/);
  assert.match(runLog, /codex says hello/);
  assert.match(runLog, /Coordinator:/);
  assert.match(runLog, /claude says hello/);
});

test("orchestrator sanitizes completed drafter chat messages before persisting chat-messages.json", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Five years of fintech work", true);

  const compiler = new ContextCompiler(storage);
  const buildResponse = (prompt: string, options?: { speakerRole?: RunActorRole }): string => {
    if (/You are the finalizer for a multi-model essay revision workflow/i.test(prompt)) {
      return ["## Final Draft", "최종 통합 초안"].join("\n");
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Current Focus",
        "지원 동기와 협업 성과를 함께 닫습니다.",
        "",
        "## Current Objective",
        "협업 문단을 더 설득력 있게 정리합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Section Draft",
        "협업 장면과 성과를 함께 보여주는 문단입니다.",
        "",
        "## Change Rationale",
        "핵심 방향을 본문 문장으로만 남겼습니다."
      ].join("\n");
    }

    if (
      options?.speakerRole === "coordinator"
      && /deciding whether the drafted section is ready to integrate/i.test(prompt)
    ) {
      return [
        "## Summary",
        "현재 섹션은 통합 가능합니다.",
        "## Improvement Plan",
        "- 현재 섹션을 본문에 반영합니다.",
        "## Next Owner",
        "finalizer"
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      return [
        "## Current Section",
        "협업 문단",
        "",
        "## Current Objective",
        "지원 동기와 협업 성과를 한 문단에서 함께 설득합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Must Keep",
        "- 지원 동기 연결",
        "",
        "## Must Resolve",
        "- 핵심 문장을 한 번 더 압축합니다.",
        "",
        "## Available Evidence",
        "- 운영 안정화 경험",
        "",
        "## Exit Criteria",
        "- 협업과 성과가 한 문단에서 함께 읽힌다.",
        "",
        "## Next Owner",
        "section_drafter"
      ].join("\n");
    }

    return [
      "## Overall Verdict",
      "APPROVE",
      "",
      "## Strengths",
      "- 협업 경험이 또렷합니다.",
      "",
      "## Problems",
      "- 남은 문제는 없습니다.",
      "",
      "## Suggestions",
      "- 현재 문단을 유지해도 됩니다.",
      "",
      "## Direct Responses To Other Reviewers",
      "- 동의합니다."
    ].join("\n");
  };
  const gateway = new FakeGateway(
    healthyStates(),
    (_providerId, prompt, _round, options) => buildResponse(prompt, options),
    async (providerId, prompt, options) => {
      const messageId = `${options.participantId ?? providerId}-${options.round}`;
      const response = buildResponse(prompt, options);
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-started",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-delta",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: response
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-completed",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Shinhan Bank?",
    draft: "금융 서비스 운영 경험을 썼습니다.",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "chat-messages.json");
  assert.ok(chatArtifact);
  const persistedMessages = JSON.parse(chatArtifact) as RunChatMessage[];
  const drafterMessage = persistedMessages.find((message) => message.speakerRole === "drafter");
  assert.ok(drafterMessage);
  assert.equal(drafterMessage?.content, "협업 장면과 성과를 함께 보여주는 문단입니다.");
  assert.doesNotMatch(drafterMessage?.content ?? "", /Current Focus|Current Objective|Rewrite Direction/);
});

test("orchestrator blanks drafter preamble-only chat messages and suppresses their forwarded completion events", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.saveProfileTextDocument("Career", "Five years of fintech work", true);

  const compiler = new ContextCompiler(storage);
  const buildResponse = (prompt: string, options?: { speakerRole?: RunActorRole }): string => {
    if (/You are the finalizer for a multi-model essay revision workflow/i.test(prompt)) {
      return ["## Final Draft", "최종 통합 초안"].join("\n");
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Current Focus",
        "지원 동기와 협업 성과를 함께 닫습니다.",
        "",
        "## Current Objective",
        "협업 문단을 더 설득력 있게 정리합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Section Draft",
        "협업 장면과 성과를 함께 보여주는 문단입니다.",
        "",
        "## Change Rationale",
        "핵심 방향을 본문 문장으로만 남겼습니다."
      ].join("\n");
    }

    if (
      options?.speakerRole === "coordinator"
      && /deciding whether the drafted section is ready to integrate/i.test(prompt)
    ) {
      return [
        "## Summary",
        "현재 섹션은 통합 가능합니다.",
        "## Improvement Plan",
        "- 현재 섹션을 본문에 반영합니다.",
        "## Next Owner",
        "finalizer"
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      return [
        "## Current Section",
        "협업 문단",
        "",
        "## Current Objective",
        "지원 동기와 협업 성과를 한 문단에서 함께 설득합니다.",
        "",
        "## Rewrite Direction",
        "협업 장면과 성과를 한 문단으로 압축합니다.",
        "",
        "## Must Keep",
        "- 지원 동기 연결",
        "",
        "## Must Resolve",
        "- 핵심 문장을 한 번 더 압축합니다.",
        "",
        "## Available Evidence",
        "- 운영 안정화 경험",
        "",
        "## Exit Criteria",
        "- 협업과 성과가 한 문단에서 함께 읽힌다.",
        "",
        "## Next Owner",
        "section_drafter"
      ].join("\n");
    }

    return [
      "## Overall Verdict",
      "APPROVE",
      "",
      "## Strengths",
      "- 협업 경험이 또렷합니다.",
      "",
      "## Problems",
      "- 남은 문제는 없습니다.",
      "",
      "## Suggestions",
      "- 현재 문단을 유지해도 됩니다.",
      "",
      "## Direct Responses To Other Reviewers",
      "- 동의합니다."
    ].join("\n");
  };
  const events: RunEvent[] = [];
  const gateway = new FakeGateway(
    healthyStates(),
    (_providerId, prompt, _round, options) => buildResponse(prompt, options),
    async (providerId, prompt, options) => {
      const baseMessageId = `${options.participantId ?? providerId}-${options.round}`;
      const response = buildResponse(prompt, options);
      if (options.speakerRole === "drafter") {
        const preambleMessageId = `${baseMessageId}-preamble`;
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-started",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: preambleMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: ""
        });
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-delta",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: preambleMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: "생각을 정리한 뒤 본문을 적겠습니다."
        });
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-completed",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: preambleMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: ""
        });

        const draftMessageId = `${baseMessageId}-draft`;
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-started",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: draftMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: ""
        });
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-delta",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: draftMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: response
        });
        await options.onEvent?.({
          timestamp: new Date().toISOString(),
          type: "chat-message-completed",
          providerId,
          participantId: options.participantId,
          participantLabel: options.participantLabel,
          round: options.round,
          messageId: draftMessageId,
          speakerRole: options.speakerRole,
          recipient: "All",
          message: ""
        });
        return;
      }

      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-started",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: baseMessageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-delta",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: baseMessageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: response
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-completed",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: baseMessageId,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: ""
      });
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Shinhan Bank?",
      draft: "금융 서비스 운영 경험을 썼습니다.",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex"],
      rounds: 1,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    }
  );

  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "chat-messages.json");
  assert.ok(chatArtifact);
  const persistedMessages = JSON.parse(chatArtifact) as RunChatMessage[];
  const persistedPreambleMessage = persistedMessages.find((message) => (
    message.speakerRole === "drafter" && message.content === ""
  ));
  const persistedDraftMessage = persistedMessages.find((message) => (
    message.speakerRole === "drafter" && message.content === "협업 장면과 성과를 함께 보여주는 문단입니다."
  ));
  assert.ok(persistedPreambleMessage);
  assert.ok(persistedDraftMessage);
  const preambleMessageId = persistedPreambleMessage.id;
  const draftMessageId = persistedDraftMessage.id;
  assert.equal(persistedPreambleMessage?.speakerRole, "drafter");
  assert.equal(persistedPreambleMessage?.content, "");
  assert.equal(persistedDraftMessage?.content, "협업 장면과 성과를 함께 보여주는 문단입니다.");
  assert.ok(!events.some((event) => event.messageId === preambleMessageId));
  assert.ok(events.some((event) => event.type === "chat-message-completed" && event.messageId === draftMessageId));
});

test("orchestrator only persists completed chat messages when an aborted run leaves streaming messages behind", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Line");
  const compiler = new ContextCompiler(storage);
  const controller = new AbortController();
  let abortScheduled = false;

  const gateway: OrchestratorGateway = {
    async listRuntimeStates() {
      return healthyStates();
    },
    async getApiKey() {
      return undefined;
    },
    async execute(providerId, _prompt, options) {
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-started",
        providerId,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: `${providerId} partial leak`
      });
      if (!abortScheduled) {
        abortScheduled = true;
        queueMicrotask(() => controller.abort());
      }

      return new Promise((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new RunAbortedError("Run aborted by user."));
        }, { once: true });
      });
    }
  };

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await assert.rejects(
    orchestrator.run(
      {
        projectSlug: project.slug,
        question: "Why Line?",
        draft: "플랫폼 운영 경험을 썼습니다.",
        reviewMode: "deepFeedback",
        coordinatorProvider: "claude",
        reviewerProviders: ["codex", "gemini"],
        rounds: 1,
        selectedDocumentIds: []
      },
      undefined,
      undefined,
      undefined,
      controller.signal
    ),
    RunAbortedError
  );

  const [run] = await storage.listRuns(project.slug);
  assert.ok(run);
  assert.equal(run.status, "aborted");
  assert.equal(await storage.loadRunChatMessages(project.slug, run.id), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, run.id, "chat-messages.json"), undefined);
});

test("orchestrator continues to another cycle on blank input and stops on /done", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Toss");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId) => {
    if (providerId === "claude") {
      return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Tighten evidence", "## Revised Draft", "Updated draft"].join("\n");
    }
    return ["## Overall Verdict", "Useful", "## Strengths", "- Clear", "## Problems", "- Needs metrics", "## Suggestions", "- Add outcomes", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  let pauseCount = 0;
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Toss?",
      draft: "I like fintech.",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    async () => {
      pauseCount += 1;
      return pauseCount === 1 ? "" : "/done";
    }
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.rounds, 2);
  assert.ok(events.filter((event) => event.type === "awaiting-user-input").length >= 2);
  assert.ok(events.some((event) => event.type === "user-input-received" && /Session marked complete/.test(event.message ?? "")));
  assert.ok(gateway.calls.some((call) => call.providerId === "claude" && call.round === 2));
});

test("orchestrator marks the run aborted when provider execution is cancelled", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Baemin");
  const compiler = new ContextCompiler(storage);
  const controller = new AbortController();
  const gateway: OrchestratorGateway = {
    async listRuntimeStates() {
      return healthyStates();
    },
    async getApiKey() {
      return undefined;
    },
    async execute() {
      return new Promise((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new RunAbortedError("Run aborted by user."));
        }, { once: true });
      });
    }
  };

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const runPromise = orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Baemin?",
      draft: "음식 배달 서비스를 자주 사용합니다.",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    undefined,
    undefined,
    controller.signal
  );

  controller.abort();

  await assert.rejects(runPromise, RunAbortedError);
  const [run] = await storage.listRuns(project.slug);
  assert.equal(run?.status, "aborted");
  assert.ok(events.some((event) => event.type === "run-aborted"));
  assert.ok(events.every((event) => event.type !== "run-failed"));
});

test("orchestrator injects non-empty user intervention into the next cycle prompts", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("NHN");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId) => {
    if (providerId === "claude") {
      return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Highlight collaboration", "## Revised Draft", "Updated draft"].join("\n");
    }
    return ["## Overall Verdict", "Useful", "## Strengths", "- Relevant", "## Problems", "- Weak company fit", "## Suggestions", "- Explain collaboration", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  let pauseCount = 0;
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why NHN?",
      draft: "I like building services.",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    undefined,
    async () => {
      pauseCount += 1;
      return pauseCount === 1 ? "협업 관점을 더 강조해줘" : "/done";
    }
  );

  assert.equal(result.run.status, "completed");
  const reviewerCall = gateway.calls.find((call) => call.providerId === "codex" && call.round === 2);
  const coordinatorCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 2);
  assert.ok(reviewerCall);
  assert.ok(coordinatorCall);
  assert.match(reviewerCall.prompt, /## User Guidance/);
  assert.match(reviewerCall.prompt, /협업 관점을 더 강조해줘/);
  assert.match(coordinatorCall.prompt, /## User Guidance/);
  assert.match(coordinatorCall.prompt, /협업 관점을 더 강조해줘/);
  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "chat-messages.json");
  assert.ok(chatArtifact);
  assert.match(chatArtifact, /"speaker": "You"/);
});

test("realtime mode checkpoints the latest draft before paused completion without finalizing", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  await storage.saveProfileTextDocument("Career", "Built product and growth systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt, round) => {
    if (providerId === "claude") {
      return /closing a realtime multi-model essay review session/i.test(prompt)
        ? "최종 지원서 초안"
        : buildRealtimeLedgerResponse({
            currentFocus: round === 1 ? "핵심 성과 수치를 먼저 선명하게 정리합니다." : "성과와 회사 연결을 한 문단으로 정리합니다.",
            targetSection: "도입 문단",
            miniDraft: round === 1
              ? "대규모 결제 안정화 경험을 먼저 꺼내고, 왜 그 경험이 컬리와 맞닿는지 바로 잇습니다."
              : "대규모 결제 안정화 경험을 먼저 꺼내고, 그 경험이 컬리의 사용자 신뢰와 어떻게 연결되는지 한 문단에서 정리합니다.",
            acceptedDecisions: ["성과 수치를 초반에 배치한다"],
            openChallenges: round === 1 ? ["컬리와의 연결 근거를 더 분명히 써야 한다"] : []
          });
    }

    return [
      "Mini Draft: 성과를 먼저 꺼내는 방향은 좋습니다.",
      round === 1
        ? "Challenge: 컬리와의 연결 근거는 아직 열어둬야 합니다."
        : "Challenge: 남은 쟁점은 이제 닫아도 됩니다.",
      round === 1
        ? "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다."
        : "Cross-feedback: 직전 라운드 objection에 동의하며 회사 연결 근거를 더 보강했습니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kurly?",
    draft: "사용자 문제를 해결하는 서비스가 좋아요.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.rounds, 2);
  assert.equal(result.artifacts.revisedDraft, "최종 지원서 초안");
  assert.equal((await storage.getPreferences()).lastReviewMode, "realtime");
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "summary.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "improvement-plan.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "revised-draft.md"), "최종 지원서 초안");
  const discussionLedger = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(discussionLedger);
  assert.match(discussionLedger, /## Mini Draft/);
  assert.match(discussionLedger, /성과와 회사 연결/);
  const reviewerPrompt = gateway.calls.find((call) => call.providerId === "codex");
  assert.ok(reviewerPrompt);
  assert.match(reviewerPrompt.prompt, /Status: APPROVE/);
});

test("realtime mode uses the finalizer role assignment and override settings for the closing draft", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  await storage.saveProfileTextDocument("Career", "Built product and growth systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서 초안";
    }

    if (providerId === "claude") {
      return buildRealtimeLedgerResponse({
        currentFocus: "핵심 성과와 회사 연결을 한 문단으로 정리합니다.",
        targetSection: "도입 문단",
        miniDraft: "결제 안정화 경험을 먼저 제시하고 그 경험이 컬리의 사용자 신뢰와 이어진다고 정리합니다.",
        acceptedDecisions: ["성과 수치를 초반에 배치한다"],
        openChallenges: []
      });
    }

    return [
      "Mini Draft: 방향은 좋습니다.",
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const roleAssignments = [
    { role: "context_researcher", providerId: "claude", useProviderDefaults: true },
    { role: "section_coordinator", providerId: "claude", useProviderDefaults: true },
    { role: "section_drafter", providerId: "claude", useProviderDefaults: true },
    { role: "fit_reviewer", providerId: "gemini", useProviderDefaults: true },
    { role: "evidence_reviewer", providerId: "codex", useProviderDefaults: true },
    { role: "voice_reviewer", providerId: "claude", useProviderDefaults: true },
    { role: "finalizer", providerId: "codex", useProviderDefaults: false, modelOverride: "gpt-5.4", effortOverride: "xhigh" }
  ] as const;

  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kurly?",
    draft: "사용자 문제를 해결하는 서비스가 좋아요.",
    reviewMode: "realtime",
    roleAssignments: [...roleAssignments],
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini", "claude"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.artifacts.revisedDraft, "최종 지원서 초안");
  const finalizerCall = gateway.calls.find((call) => call.participantId === "finalizer");
  assert.ok(finalizerCall);
  assert.equal(finalizerCall.providerId, "codex");
  assert.equal(finalizerCall.modelOverride, "gpt-5.4");
  assert.equal(finalizerCall.effortOverride, "xhigh");
  assert.match(finalizerCall.messageScope ?? "", /realtime-round-1-finalizer-final/);
});

test("realtime inserts the section drafter between the coordinator and reviewers", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  await storage.saveProfileTextDocument("Career", "Built product and growth systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, _round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서 초안";
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Section Draft",
        "드래프터가 다시 쓴 협업 문단입니다.",
        "",
        "## Change Rationale",
        "성과와 협업 연결을 한 문단으로 바로 읽히게 정리했습니다."
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "협업 성과를 더 또렷하게 정리합니다.",
        targetSection: "협업 문단",
        miniDraft: "초기 미니 초안입니다.",
        acceptedDecisions: ["협업 장면을 구체화한다"],
        openChallenges: []
      });
    }

    return [
      "Mini Draft: 방향은 충분합니다.",
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kurly?",
    draft: "사용자 문제를 해결하는 서비스가 좋아요.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const coordinatorIndex = gateway.calls.findIndex((call) => call.participantId === "coordinator");
  const drafterIndex = gateway.calls.findIndex((call) => call.participantId === "section-drafter");
  const reviewerIndex = gateway.calls.findIndex((call) => call.participantId === "reviewer-1");
  assert.ok(coordinatorIndex >= 0);
  assert.ok(drafterIndex > coordinatorIndex);
  assert.ok(reviewerIndex > drafterIndex);
  assert.match(gateway.calls[reviewerIndex]?.prompt ?? "", /드래프터가 다시 쓴 협업 문단입니다\./);
});

test("realtime sanitizes stored drafter turns when the raw response includes coordinator headings", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  await storage.saveProfileTextDocument("Career", "Built product and growth systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, _round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서 초안";
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Current Focus",
        "핵심 방향을 다시 정리합니다.",
        "",
        "## Rewrite Direction",
        "협업 성과와 운영 안정성을 한 문단으로 압축합니다.",
        "",
        "## Section Draft",
        "협업과 운영 안정성을 함께 보여주는 문단입니다.",
        "",
        "## Change Rationale",
        "핵심 방향을 문장 안으로 흡수했습니다."
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "협업 성과를 더 또렷하게 정리합니다.",
        targetSection: "협업 문단",
        currentObjective: "협업과 운영 안정성을 한 문단에서 함께 설득합니다.",
        rewriteDirection: "협업 장면과 운영 안정성을 한 문단으로 압축합니다.",
        mustResolve: ["핵심 문장을 한 번 더 압축합니다."],
        miniDraft: "초기 미니 초안입니다.",
        acceptedDecisions: ["협업 장면을 구체화한다"],
        openChallenges: []
      });
    }

    return [
      "Mini Draft: 방향은 충분합니다.",
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kurly?",
    draft: "사용자 문제를 해결하는 서비스가 좋아요.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const storedTurnsRaw = await storage.readOptionalRunArtifact(project.slug, result.run.id, "review-turns.json");
  assert.ok(storedTurnsRaw);
  const storedTurns = JSON.parse(storedTurnsRaw) as ReviewTurn[];
  const drafterTurn = storedTurns.find((turn) => turn.role === "drafter");
  assert.ok(drafterTurn);
  assert.equal(drafterTurn?.response, "협업과 운영 안정성을 함께 보여주는 문단입니다.");
  assert.doesNotMatch(drafterTurn?.response ?? "", /Current Focus|Rewrite Direction|핵심 방향/);
});

test("realtime prompts explicitly require Korean responses while preserving status lines", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  await storage.saveProfileTextDocument("Career", "Built product systems", true);

  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt) => {
    if (providerId === "claude") {
      return /closing a realtime multi-model essay review session/i.test(prompt)
        ? "최종 지원서 초안"
        : buildRealtimeLedgerResponse({
            currentFocus: "핵심 근거를 더 선명하게 맞춥니다.",
            targetSection: "도입 문단",
            miniDraft: "핵심 성과와 지원 동기의 연결을 두 문장으로 압축합니다.",
            acceptedDecisions: ["성과를 먼저 말한다"],
            openChallenges: []
          });
    }

    return ["Mini Draft: 방향은 좋습니다.", "Challenge: 남은 쟁점은 없습니다.", "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.", "Status: APPROVE"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Kurly?",
    draft: "사용자 문제 해결이 좋아요.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const coordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 1 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  assert.ok(coordinatorPrompt);
  assert.match(coordinatorPrompt.prompt, /Write your response sentences in Korean \(한국어\)/);
  assert.match(coordinatorPrompt.prompt, /Keep any required English status line exactly as written/);

  const reviewerPrompt = gateway.calls.find((call) => call.providerId === "gemini" && call.round === 1);
  assert.ok(reviewerPrompt);
  assert.match(reviewerPrompt.prompt, /Write your response sentences in Korean \(한국어\)/);
  assert.match(reviewerPrompt.prompt, /Keep any required English status line exactly as written/);
  assert.match(reviewerPrompt.prompt, /Status: APPROVE/);
  assert.match(reviewerPrompt.prompt, /- Updated At Round: 1/);
  assert.doesNotMatch(reviewerPrompt.prompt, /## Discussion Ledger/);
  assert.match(reviewerPrompt.prompt, /## Mini Draft/);

  const finalPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && /closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  assert.ok(finalPrompt);
  assert.match(finalPrompt.prompt, /Write the final essay draft in Korean \(한국어\)/);
});

test("first-round realtime reviewer prompts keep the coordinator reference empty instead of reusing the current ledger", () => {
  const ledger: DiscussionLedger = {
    currentFocus: "현재 라운드에서 직무 지원 이유를 정리합니다.",
    miniDraft: "운영 안정성을 직무 언어로 압축합니다.",
    acceptedDecisions: ["직무 언어를 먼저 세운다"],
    openChallenges: ["회사 연결 근거를 한 문장 더 보강한다"],
    deferredChallenges: [],
    targetSection: "직무 지원 이유",
    updatedAtRound: 1
  };
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude section coordinator",
      role: "coordinator",
      round: 1,
      prompt: "coordinator prompt",
      response: [
        buildRealtimeLedgerResponse({
          currentFocus: ledger.currentFocus,
          targetSection: ledger.targetSection,
          miniDraft: ledger.miniDraft,
          acceptedDecisions: ledger.acceptedDecisions,
          openChallenges: ledger.openChallenges
        }),
        "",
        "CURRENT-ROUND-COORDINATOR-SENTINEL"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];

  const prompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n초안",
    "",
    [],
    turns,
    1,
    ledger,
    "reviewer-1"
  ).text;

  assert.match(prompt, /## Coordinator Reference\n\n_No coordinator reference yet\._/);
  assert.match(prompt, /- Updated At Round: 1/);
  assert.doesNotMatch(prompt, /coord-r1/);
  assert.doesNotMatch(prompt, /Coordinator round 1/);
});

test("realtime reviewer prompts include the latest ledger and scoped cross-feedback references", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Musinsa");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, prompt, round) => {
    if (providerId === "claude") {
      if (/closing a realtime multi-model essay review session/i.test(prompt)) {
        return "무신사 최종본";
      }
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "브랜드 적합도보다 성과 근거를 먼저 정리합니다." : "성과 근거와 브랜드 적합도를 같이 묶습니다.",
        targetSection: "지원 동기 문단",
        miniDraft: round === 1
          ? "검색 품질 개선 성과를 먼저 제시하고, 왜 그 경험이 무신사와 닿는지 한 문장으로 잇습니다."
          : "검색 품질 개선 성과를 먼저 제시하고, 그 경험이 무신사의 탐색 경험과 어떻게 이어지는지 두 문장으로 잇습니다.",
        acceptedDecisions: ["성과를 문단 첫머리에 둔다"],
        openChallenges: round === 1 ? ["무신사와의 연결 근거가 아직 약하다"] : []
      });
    }

    return [
      round === 1
        ? "Mini Draft: 성과를 먼저 두는 방향은 좋습니다."
        : "Mini Draft: 무신사와의 연결 문장을 더 선명하게 유지하세요.",
      round === 1
        ? "Challenge: 무신사와의 연결 근거는 열어둬야 합니다."
        : "Challenge: 남은 쟁점은 이제 닫아도 됩니다.",
      round === 1
        ? "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다."
        : "Cross-feedback: 직전 라운드 objection에 동의하며 회사 연결 근거를 더 보강해야 합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Musinsa?",
    draft: "패션 플랫폼이 좋아서 지원합니다.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const roundTwoReviewerPrompt = gateway.calls.find((call) => call.providerId === "codex" && call.round === 2);
  assert.ok(roundTwoReviewerPrompt);
  assert.match(roundTwoReviewerPrompt.prompt, /- Updated At Round: 2/);
  assert.doesNotMatch(roundTwoReviewerPrompt.prompt, /## Discussion Ledger/);
  assert.match(roundTwoReviewerPrompt.prompt, /## Coordinator Reference/);
  assert.match(roundTwoReviewerPrompt.prompt, /## Reviewer References/);
  assert.match(roundTwoReviewerPrompt.prompt, /## Mini Draft/);
  assert.match(roundTwoReviewerPrompt.prompt, /성과를 문단 첫머리에 둔다/);
  assert.match(roundTwoReviewerPrompt.prompt, /무신사와의 연결 근거가 아직 약하다/);
  assert.match(roundTwoReviewerPrompt.prompt, /Cross-feedback: \[refId\] agree/);
  assert.match(roundTwoReviewerPrompt.prompt, /Cross-feedback: \[refId\] disagree/);
});

test("realtime coordinator prompt history excludes prior coordinator turn bodies", () => {
  const currentLedger: DiscussionLedger = {
    currentFocus: "성과 근거를 유지한 채 회사 연결을 다듬습니다.",
    miniDraft: "성과를 먼저 두고 회사 연결을 뒤에 붙입니다.",
    acceptedDecisions: ["성과를 먼저 둔다"],
    openChallenges: [],
    deferredChallenges: [],
    targetSection: "지원 동기",
    updatedAtRound: 2
  };
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude section coordinator",
      role: "coordinator",
      round: 1,
      prompt: "round-one coordinator prompt",
      response: [
        buildRealtimeLedgerResponse({
          currentFocus: "이전 라운드에서 성과 근거를 정리합니다.",
          targetSection: "지원 동기",
          miniDraft: "성과를 먼저 제시합니다.",
          acceptedDecisions: ["성과를 앞에 둔다"],
          openChallenges: ["회사 연결 근거가 아직 약합니다."]
        }),
        "",
        "COORDINATOR-HISTORY-SENTINEL"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    },
    {
      providerId: "codex",
      participantId: "reviewer-1",
      participantLabel: "Codex evidence reviewer",
      role: "reviewer",
      round: 1,
      prompt: "round-one reviewer prompt",
      response: [
        "Status: REVISE",
        "Mini Draft:",
        "REVIEWER-HISTORY-SENTINEL",
        "Challenge: [new] keep-open",
        "회사 연결 근거를 한 문장 더 보강해야 합니다.",
        "Cross-feedback: agree",
        "첫 라운드라 coordinator reference만 있습니다."
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];

  const prompt = buildRealtimeCoordinatorDiscussionPrompt(
    "## Current Draft\n초안",
    "",
    [],
    turns,
    2,
    currentLedger
  ).text;

  assert.match(prompt, /## Recent Discussion/);
  assert.match(prompt, /REVIEWER-HISTORY-SENTINEL/);
  assert.doesNotMatch(prompt, /COORDINATOR-HISTORY-SENTINEL/);
});

test("realtime seeds shadow tickets from legacy ledger arrays without changing current behavior", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "직무 지원 이유를 먼저 닫습니다." : "남은 쟁점을 정리해 마무리합니다.",
        targetSection: "직무 지원 이유",
        miniDraft: round === 1
          ? "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다."
          : "정합성과 운영 안정성을 함께 드러내는 문장으로 마무리합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: round === 1 ? ["왜 은행이어야 하는지 한 문장 더 보강한다"] : [],
        deferredChallenges: round === 1 ? ["입행 후 포부 문단을 더 구체화한다"] : []
      });
    }

    return [
      "Mini Draft: 방향은 적절합니다.",
      round === 1 ? "Challenge: 현재 섹션 쟁점은 열어둬야 합니다." : "Challenge: 남은 쟁점은 없습니다.",
      round === 1 ? "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다." : "Cross-feedback: [coord-r1] agree 현재 섹션 방향은 적절합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  }, async (event) => {
    events.push(event);
  });

  assert.equal(result.artifacts.revisedDraft, "최종본");
  const ledgerUpdate = events.find((event) => event.type === "discussion-ledger-updated" && event.round === 1);
  assert.ok(ledgerUpdate?.discussionLedger);
  assert.equal(ledgerUpdate.discussionLedger?.targetSectionKey, "직무-지원-이유");
  assert.equal(ledgerUpdate.discussionLedger?.tickets?.length, 2);
  assert.deepEqual(
    ledgerUpdate.discussionLedger?.tickets?.map((ticket) => ({
      status: ticket.status,
      severity: ticket.severity,
      text: ticket.text
    })),
    [
      {
        status: "open",
        severity: "blocking",
        text: "왜 은행이어야 하는지 한 문장 더 보강한다"
      },
      {
        status: "deferred",
        severity: "advisory",
        text: "입행 후 포부 문단을 더 구체화한다"
      }
    ]
  );
});

test("realtime reviewer prompt exposes challenge tickets and requests normalized challenge grammar", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Musinsa");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "지원 동기 문단을 먼저 닫습니다." : "포부 문단을 정리합니다.",
        targetSection: round === 1 ? "지원 동기 문단" : "포부 문단",
        miniDraft: "성과와 플랫폼 적합도를 한 문단으로 정리합니다.",
        acceptedDecisions: ["성과를 먼저 둔다"],
        openChallenges: round === 1 ? ["무신사와의 연결 근거를 더 보강한다"] : [],
        deferredChallenges: round === 1 ? ["포부 문단을 더 구체화한다"] : []
      });
    }

    return [
      "Status: APPROVE",
      "Mini Draft:",
      "방향은 적절합니다.",
      round === 1
        ? "Challenge: [t-지원-동기-문단-a1b2c3] keep-open"
        : "Challenge: [t-포부-문단-b2c3d4] close",
      round === 1 ? "연결 문장이 한 단계 부족합니다." : "포부 문단도 충분합니다.",
      round === 1
        ? "Cross-feedback: agree"
        : "Cross-feedback: [coord-r1] agree",
      round === 1 ? "첫 라운드라 coordinator reference만 있습니다." : "현재 섹션은 다음 문단으로 넘어갈 수 있습니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 무신사인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const reviewerPrompt = gateway.calls.find((call) => call.providerId === "codex" && call.round === 1);
  assert.ok(reviewerPrompt);
  assert.match(reviewerPrompt.prompt, /## Challenge Tickets/);
  assert.match(reviewerPrompt.prompt, /\[t-[^\]\s]+-[0-9a-f]{6}\]/);
  assert.match(reviewerPrompt.prompt, /Respond in exactly these 4 labeled sections in this order\./);
  assert.match(reviewerPrompt.prompt, /Challenge: \[ticketId\] keep-open/);
  assert.match(reviewerPrompt.prompt, /Challenge: \[new\] defer/);
  assert.match(reviewerPrompt.prompt, /티켓 ID는 반드시 대괄호를 포함한 형식으로 출력: \[t-xxx-xxxxxx\]/);
  assert.match(reviewerPrompt.prompt, /플레이스홀더가 아님 — 실제 티켓 ID를 대괄호 안에 그대로 넣을 것/);
  assert.match(reviewerPrompt.prompt, /Cross-feedback: \[refId\] agree/);
  assert.match(reviewerPrompt.prompt, /Cross-feedback: \[refId\] disagree/);
  assert.doesNotMatch(reviewerPrompt.prompt, /because/);
});

test("realtime prompts expose formal tone guidance, valid section keys, role boundaries, and reviewer verdict summaries", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "drafter") {
      return ["## Section Draft", `${round}라운드 드래프터 초안입니다.`].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      if (round === 1) {
        return buildRealtimeLedgerResponse({
          currentFocus: "직무 지원 이유를 먼저 닫습니다.",
          targetSection: "직무 지원 이유",
          targetSectionKey: "why-banking",
          currentObjective: "지원 이유를 직무 언어로 선명하게 닫습니다.",
          rewriteDirection: "정합성과 운영 안정성을 한 문단으로 압축합니다.",
          mustResolve: ["생활금융 맥락을 한 문장 더 보강합니다."],
          miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
          acceptedDecisions: ["직무 언어를 유지한다"],
          openChallenges: [],
          deferredChallenges: ["입행 후 포부를 거래 안정성 관점으로 더 구체화한다"],
          sectionOutcome: "handoff-next-section",
          challengeDecisionLines: [
            "- [new] add | sectionKey=future-impact | sectionLabel=입행 후 포부 | severity=advisory | text=입행 후 포부를 거래 안정성 관점으로 더 구체화한다"
          ]
        });
      }

      return buildRealtimeLedgerResponse({
        currentFocus: "입행 후 포부 문단을 정리합니다.",
        targetSection: "입행 후 포부",
        targetSectionKey: "future-impact",
        currentObjective: "입행 후 기여 방향을 문장 하나로 또렷하게 닫습니다.",
        rewriteDirection: "거래 안정성 기여와 운영 품질 개선 의지를 함께 보여줍니다.",
        mustResolve: ["입행 후 포부를 거래 안정성 관점으로 더 구체화한다"],
        miniDraft: "입행 후에는 거래 처리 안정성과 운영 품질을 높이는 역할을 맡고 싶습니다.",
        acceptedDecisions: ["직무 지원 이유는 닫혔다"],
        openChallenges: [],
        deferredChallenges: [],
        sectionOutcome: "write-final"
      });
    }

    if (round === 1 && options?.participantId === "reviewer-1") {
      return [
        "Status: REVISE",
        "Mini Draft:",
        "회사 적합도 연결은 충분하지만 한 문장만 더 다듬으면 좋겠습니다.",
        "Challenge: [new] keep-open",
        "생활금융 연결 문장을 한 단계 더 압축해 주세요.",
        "Cross-feedback: agree",
        "첫 라운드라 coordinator reference만 있습니다."
      ].join("\n");
    }

    return [
      "Status: APPROVE",
      "Mini Draft:",
      "현재 방향이면 섹션을 닫아도 됩니다.",
      "Challenge: close",
      "남은 쟁점은 없습니다.",
      round === 1 ? "Cross-feedback: agree" : "Cross-feedback: [coord-r1] agree",
      round === 1 ? "첫 라운드라 coordinator reference만 있습니다." : "입행 후 포부 문단으로 넘어간 판단에 동의합니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini", "codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const roundOneCoordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 1 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  const roundOneReviewerPrompt = gateway.calls.find((call) => call.participantId === "reviewer-1" && call.round === 1);
  const roundOneDrafterPrompt = gateway.calls.find((call) => call.participantId === "section-drafter" && call.round === 1);
  const roundTwoCoordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 2 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );

  assert.ok(roundOneCoordinatorPrompt);
  assert.ok(roundOneReviewerPrompt);
  assert.ok(roundOneDrafterPrompt);
  assert.ok(roundTwoCoordinatorPrompt);

  assert.match(roundOneCoordinatorPrompt.prompt, /## 어조 규칙/);
  assert.match(roundOneCoordinatorPrompt.prompt, /## Valid Section Keys/);
  assert.match(roundOneCoordinatorPrompt.prompt, /why-banking/);
  assert.match(roundOneCoordinatorPrompt.prompt, /future-impact/);
  assert.match(roundOneCoordinatorPrompt.prompt, /챌린지 텍스트나 ID를 섹션 키로 사용하지 말 것/);
  assert.match(roundOneReviewerPrompt.prompt, /## 어조 규칙/);
  assert.match(roundOneDrafterPrompt.prompt, /## 어조 규칙/);
  assert.match(roundOneDrafterPrompt.prompt, /Current Focus: 직무 지원 이유를 먼저 닫습니다\./);
  assert.match(roundOneDrafterPrompt.prompt, /Rewrite Direction: 정합성과 운영 안정성을 한 문단으로 압축합니다\./);
  assert.doesNotMatch(roundOneDrafterPrompt.prompt, /### Current Focus/);
  assert.doesNotMatch(roundOneDrafterPrompt.prompt, /### Rewrite Direction/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /## Reviewer Verdict/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /APPROVE: 2 \/ REVISE: 1 \/ BLOCK: 0/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /Minority REVISE \(Codex evidence reviewer\):/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /생활금융 연결 문장을 한 단계 더 압축해 주세요/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /## Section Role Boundary/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /현재 섹션 담당:/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /다음 섹션으로 위임:/);
});

test("realtime parses structured section outcome and challenge decisions while keeping legacy fallback", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "직무 지원 이유를 먼저 닫습니다." : "포부 문단을 보강합니다.",
        targetSection: round === 1 ? "직무 지원 이유" : "입행 후 포부",
        targetSectionKey: round === 1 ? "why-banking" : "future-impact",
        miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: round === 1 ? ["왜 은행이어야 하는지 한 문장 더 보강한다"] : [],
        deferredChallenges: round === 1 ? ["입행 후 포부 문단을 더 구체화한다"] : [],
        sectionOutcome: round === 1 ? "handoff-next-section" : "write-final",
        challengeDecisionLines: round === 1
          ? [
              "- [new] add | sectionKey=future-impact | sectionLabel=입행 후 포부 | severity=advisory | text=마지막 문단에서 거래 안정성 기여를 더 구체화한다"
            ]
          : ["- [new] add | malformed"]
      });
    }

    return [
      "Mini Draft: 방향은 적절합니다.",
      round === 1 ? "Challenge: 남은 쟁점은 없습니다." : "Challenge: [new] defer because malformed structured output이어도 legacy fallback이 유지되어야 합니다.",
      round === 1
        ? "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다."
        : "Cross-feedback: [coord-r1] agree 포부 문단으로 넘어가는 방향은 적절합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  }, async (event) => {
    events.push(event);
  });

  const roundOneLedger = events.find((event) => event.type === "discussion-ledger-updated" && event.round === 1)?.discussionLedger;
  assert.ok(roundOneLedger);
  assert.equal(roundOneLedger?.targetSectionKey, "why-banking");
  assert.equal(roundOneLedger?.sectionOutcome, "handoff-next-section");
  assert.ok(roundOneLedger?.tickets?.some((ticket) => ticket.text === "마지막 문단에서 거래 안정성 기여를 더 구체화한다"));
  assert.ok(roundOneLedger?.deferredChallenges.includes("마지막 문단에서 거래 안정성 기여를 더 구체화한다"));

  const roundTwoLedger = events.find((event) => event.type === "discussion-ledger-updated" && event.round === 2)?.discussionLedger;
  assert.ok(roundTwoLedger);
  assert.equal(roundTwoLedger?.sectionOutcome, "write-final");
  assert.deepEqual(roundTwoLedger?.openChallenges, []);
  const ledgerArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(ledgerArtifact);
  assert.match(ledgerArtifact, /Target Section Key: future-impact/);
  assert.match(ledgerArtifact, /Section Outcome: write-final/);
});

test("realtime downgrades invalid write-final into a blocking-cluster handoff", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      if (round === 1) {
        return buildRealtimeLedgerResponse({
          currentFocus: "직무 지원 이유를 먼저 닫습니다.",
          targetSection: "직무 지원 이유",
          targetSectionKey: "why-banking",
          miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
          acceptedDecisions: ["정합성 문장은 유지한다"],
          openChallenges: [],
          deferredChallenges: [],
          sectionOutcome: "write-final",
          challengeDecisionLines: [
            "- [new] add | sectionKey=future-impact | sectionLabel=입행 후 포부 | severity=advisory | text=포부를 거래 안정성 관점으로 더 구체화한다",
            "- [new] add | sectionKey=why-company | sectionLabel=왜 신한인가 | severity=blocking | text=생활금융 확장과 연결되는 동기를 더 구체화한다"
          ]
        });
      }

      return buildRealtimeLedgerResponse({
        currentFocus: "왜 신한인가 섹션을 닫습니다.",
        targetSection: "왜 신한인가",
        targetSectionKey: "why-company",
        miniDraft: "생활금융 확장 방향과 해커톤 경험을 연결합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: [],
        deferredChallenges: [],
        sectionOutcome: "write-final"
      });
    }

    if (round === 1) {
      return [
        "Mini Draft: 방향은 적절합니다.",
        options?.participantId === "reviewer-1"
          ? "Challenge: [t-why-company-a1b2c3] keep-open because 회사 적합도는 다음 섹션에서 닫는 편이 맞습니다."
          : "Challenge: [t-future-impact-b2c3d4] defer because 포부는 후속 섹션으로 넘겨도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
        options?.participantId === "reviewer-1" ? "Status: APPROVE" : "Status: REVISE"
      ].join("\n");
    }

    return [
      "Mini Draft: 방향은 적절합니다.",
      "Challenge: [t-why-company-a1b2c3] close because 회사 적합도도 충분히 정리됐습니다.",
      "Cross-feedback: [coord-r1] agree 다음 섹션 handoff는 적절했습니다.",
      options?.participantId === "reviewer-1" ? "Status: APPROVE" : "Status: REVISE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.artifacts.revisedDraft, "최종본");
  const handoffCoordinatorPrompt = gateway.calls.find(
    (call) =>
      call.providerId === "claude" &&
      (call.round ?? 0) >= 2 &&
      !/closing a realtime multi-model essay review session/i.test(call.prompt) &&
      /Target Section: 왜 신한인가/.test(call.prompt)
  );
  assert.ok(handoffCoordinatorPrompt);
  assert.doesNotMatch(
    gateway.calls.find((call) => call.providerId === "claude" && call.round === 1 && /closing a realtime multi-model essay review session/i.test(call.prompt))?.prompt ?? "",
    /./
  );
});

test("realtime weak-consensus polish runs once per section before finalizing", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Toss");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      if (/most reviewers still recommend advisory revisions/i.test(prompt)) {
        return buildRealtimeLedgerResponse({
          currentFocus: "약한 합의를 한 번 더 정리합니다.",
          targetSection: "직무 지원 이유",
          targetSectionKey: "why-banking",
          miniDraft: "정합성과 운영 안정성을 더 압축해 정리합니다.",
          acceptedDecisions: ["정합성 문장은 유지한다"],
          openChallenges: [],
          deferredChallenges: [],
          sectionOutcome: "write-final"
        });
      }
      return buildRealtimeLedgerResponse({
        currentFocus: "직무 지원 이유를 먼저 닫습니다.",
        targetSection: "직무 지원 이유",
        targetSectionKey: "why-banking",
        miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: [],
        deferredChallenges: [],
        sectionOutcome: "write-final"
      });
    }

    if (round === 1) {
      return [
        "Mini Draft: 방향은 적절합니다.",
        "Challenge: [new] keep-open because 문장을 한 번 더 압축하면 더 좋아집니다.",
        "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
        options?.participantId === "reviewer-3" ? "Status: APPROVE" : "Status: REVISE"
      ].join("\n");
    }

    return [
      "Mini Draft: 방향은 충분합니다.",
      "Challenge: [new] close because 더 이상 남은 쟁점은 없습니다.",
      "Cross-feedback: [coord-r1] agree 약한 합의를 한 번 더 정리한 것은 적절했습니다.",
      options?.participantId === "reviewer-3" ? "Status: REVISE" : "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 토스인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini", "codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.artifacts.revisedDraft, "최종본");
  assert.equal(
    gateway.calls.filter((call) => /most reviewers still recommend advisory revisions/i.test(call.prompt)).length,
    1
  );
});

test("realtime reviewer prompt uses reference packets and excludes self references by participant id", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "직무 지원 이유를 먼저 닫습니다." : "마지막 포부 문단으로 넘어갑니다.",
        targetSection: round === 1 ? "직무 지원 이유" : "입행 후 포부",
        miniDraft: round === 1
          ? "정합성과 운영 안정성을 함께 다루는 이유를 직무 언어로 정리합니다."
          : "입행 후에는 거래 처리 안정성과 운영 품질 향상에 기여하고 싶습니다.",
        acceptedDecisions: ["MOA와 CAMPUNG을 함께 쓴다"],
        openChallenges: [],
        deferredChallenges: round === 1 ? ["입행 후 포부를 더 구체화한다"] : []
      });
    }

    if (round === 1 && options?.participantId === "reviewer-1") {
      return [
        "Mini Draft: 직무 언어는 적절합니다.",
        "Challenge: 남은 쟁점은 이제 닫아도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator note만 참고합니다.",
        "Status: APPROVE"
      ].join("\n");
    }

    if (round === 1 && options?.participantId === "reviewer-2") {
      return [
        "Mini Draft: 결론 문장은 더 또렷하게 유지하세요.",
        "Challenge: 입행 후 포부는 후속 과제로 넘겨도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator note만 참고합니다.",
        "Status: APPROVE"
      ].join("\n");
    }

    return [
      `Mini Draft: ${options?.participantId} 기준으로 포부 문단 방향은 괜찮습니다.`,
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: [rev-r1-reviewer-2] agree reviewer 2가 말한 후속 포부 과제 분리에 동의합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "codex"],
    rounds: 1,
    maxRoundsPerSection: 2,
    selectedDocumentIds: []
  });

  const reviewerOneRoundTwoPrompt = gateway.calls.find((call) => call.participantId === "reviewer-1" && call.round === 2);
  assert.ok(reviewerOneRoundTwoPrompt);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /## Coordinator Reference/);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /## Reviewer References/);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /coord-r1/);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /rev-r1-reviewer-2/);
  assert.doesNotMatch(reviewerOneRoundTwoPrompt.prompt, /rev-r1-reviewer-1/);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /Cross-feedback: \[refId\] agree/);
  assert.match(reviewerOneRoundTwoPrompt.prompt, /Cross-feedback: \[refId\] disagree/);
});

test("realtime reviewer references prioritize Challenge lines over Mini Draft lines", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Toss");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "지원 이유를 닫습니다." : "포부를 닫습니다.",
        targetSection: round === 1 ? "지원 이유" : "포부",
        miniDraft: "정합성과 운영 경험을 연결합니다.",
        acceptedDecisions: ["정합성 문장을 유지한다"],
        openChallenges: [],
        deferredChallenges: round === 1 ? ["포부를 더 구체화한다"] : []
      });
    }

    if (round === 1 && options?.participantId === "reviewer-1") {
      return [
        "Mini Draft: 이 문장은 유지하세요.",
        "Challenge: 마지막 포부를 더 구체화해야 합니다.",
        "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
        "Status: APPROVE"
      ].join("\n");
    }

    return [
      "Mini Draft: 포부는 한 문장 더 구체화하세요.",
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: [rev-r1-reviewer-1] agree 포부 구체화 과제가 남는다는 점에 동의합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 토스인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const roundTwoReviewerPrompt = gateway.calls.find((call) => call.participantId === "reviewer-2" && call.round === 2);
  assert.ok(roundTwoReviewerPrompt);
  assert.match(roundTwoReviewerPrompt.prompt, /포부를 더 구체화해야 합니다/);
  assert.doesNotMatch(roundTwoReviewerPrompt.prompt, /이 문장은 유지하세요\./);
});

test("realtime reviewer references normalize structured Challenge grammar before summarizing", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: round === 1 ? "직무 지원 이유를 닫습니다." : "왜 신한인가 문단으로 넘어갑니다.",
        targetSection: round === 1 ? "직무 지원 이유" : "왜 신한인가",
        miniDraft: "정합성과 운영 안정성을 뱅킹 직무 언어로 정리합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: [],
        deferredChallenges: round === 1 ? ["왜 신한인가 연결을 더 구체화한다"] : []
      });
    }

    if (round === 1 && options?.participantId === "reviewer-1") {
      return [
        "Status: REVISE",
        "Mini Draft:",
        "정합성 문장은 유지하세요.",
        "Challenge: [t-why-company-a1b2c3]   KEEP-OPEN  ",
        "왜 신한인가와의 연결이 한 단계 더 필요합니다.  ",
        "Cross-feedback: agree",
        "첫 라운드라 coordinator reference만 있습니다."
      ].join("\n");
    }

    return [
      "Status: APPROVE",
      "Mini Draft:",
      "다음 섹션 방향은 적절합니다.",
      "Challenge: close",
      "남은 쟁점은 없습니다.",
      "Cross-feedback: [rev-r1-reviewer-1] agree",
      "회사 적합도 연결을 다음 섹션에서 닫는 방향에 동의합니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const roundTwoReviewerPrompt = gateway.calls.find((call) => call.participantId === "reviewer-2" && call.round === 2);
  assert.ok(roundTwoReviewerPrompt);
  assert.match(roundTwoReviewerPrompt.prompt, /\[t-why-company-a1b2c3\] keep-open because 왜 신한인가와의 연결이 한 단계 더 필요합니다\./);
  assert.doesNotMatch(roundTwoReviewerPrompt.prompt, /KEEP-OPEN\s+because/);
});

test("realtime challenge parser accepts bare ticket ids and preserves normalized reviewer summaries", () => {
  const response = [
    "Status: REVISE",
    "Mini Draft:",
    "도입부 연결은 좋지만 한 문장만 더 다듬으면 됩니다.",
    "Challenge: t-intro-section-a0734f keep-open",
    "도입부 연결 근거를 한 문장 더 유지해야 합니다.",
    "Cross-feedback: agree",
    "첫 라운드라 coordinator reference만 있습니다."
  ].join("\n");

  assert.deepEqual(extractNormalizedReviewerChallenge(response), {
    ticketId: "t-intro-section-a0734f",
    action: "keep-open",
    reason: "도입부 연결 근거를 한 문장 더 유지해야 합니다."
  });
  assert.equal(extractRealtimeReviewerChallengeAction(response), "keep-open");
  assert.equal(
    extractRealtimeReviewerObjection(response),
    "[t-intro-section-a0734f] keep-open because 도입부 연결 근거를 한 문장 더 유지해야 합니다."
  );
});

test("reviewer card parser tolerates preamble, bare ticket ids, and inline reasons", () => {
  const response = [
    "검토 메모를 먼저 남깁니다.",
    "이 문장은 카드 파싱에서 무시되어야 합니다.",
    "",
    "Mini Draft:",
    "지원 동기를 첫 문장에 배치합니다.",
    "",
    "Challenge: t-fit-company-a0734f keep-open because 회사 적합도 근거를 한 문장 더 보강해야 합니다.",
    "",
    "Cross-feedback: [rev-r1-reviewer-1] agree 직전 reviewer의 지적에 동의합니다.",
    "Status: revise"
  ].join("\n");

  assert.deepEqual(parseReviewerCardContent(response), {
    miniDraft: "지원 동기를 첫 문장에 배치합니다.",
    challenges: ["회사 적합도 근거를 한 문장 더 보강해야 합니다."],
    crossFeedback: ["직전 reviewer의 지적에 동의합니다."],
    status: "REVISE"
  });
});

test("reviewer card parser keeps the card when challenge or cross-feedback bodies are omitted", () => {
  const response = [
    "Mini Draft: 방향은 유지해도 됩니다.",
    "Challenge: [t-fit-company-a0734f] keep-open",
    "Cross-feedback: disagree",
    "Status: APPROVE"
  ].join("\n");

  assert.deepEqual(parseReviewerCardContent(response), {
    miniDraft: "방향은 유지해도 됩니다.",
    challenges: [],
    crossFeedback: [],
    status: "APPROVE"
  });
});

test("realtime closes a section on REVISE when blockers are cleared and hands off deferred challenges", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서";
    }

    if (options?.speakerRole === "coordinator") {
      if (round === 1) {
        return buildRealtimeLedgerResponse({
          currentFocus: "직무 지원 이유를 닫습니다.",
          targetSection: "직무 지원 이유",
          miniDraft: "정합성과 운영 안정성을 뱅킹 직무 언어로 정리합니다.",
          acceptedDecisions: ["직무 언어로 닫는다"],
          openChallenges: [],
          deferredChallenges: ["마지막 포부 문단을 더 구체화한다"]
        });
      }
      return buildRealtimeLedgerResponse({
        currentFocus: "포부 문단으로 handoff합니다.",
        targetSection: "마지막 포부 문단",
        miniDraft: "입행 후에는 거래 처리 안정성과 운영 품질을 높이는 역할을 맡고 싶습니다.",
        acceptedDecisions: ["직무 지원 이유는 닫혔다"],
        openChallenges: [],
        deferredChallenges: []
      });
    }

    if (round === 1) {
      return [
        "Mini Draft: 지원 이유 문단은 이 방향이면 충분합니다.",
        "Challenge: 현재 섹션 쟁점은 닫아도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
        options?.participantId === "reviewer-1" ? "Status: REVISE" : "Status: APPROVE"
      ].join("\n");
    }

    return [
      "Mini Draft: 포부 문단도 충분합니다.",
      "Challenge: 남은 쟁점은 없습니다.",
      "Cross-feedback: [coord-r1] agree 직무 지원 이유는 이미 section-ready라고 봅니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 컬리인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.artifacts.revisedDraft, "최종 지원서");
  const roundTwoCoordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 2 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  assert.ok(roundTwoCoordinatorPrompt);
  assert.match(roundTwoCoordinatorPrompt.prompt, /- Updated At Round: 1/);
  assert.doesNotMatch(roundTwoCoordinatorPrompt.prompt, /## Previous Discussion Ledger/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /### Deferred Challenges/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /마지막 포부 문단을 더 구체화한다/);
  assert.equal(
    gateway.calls.filter((call) => call.providerId === "claude" && /closing a realtime multi-model essay review session/i.test(call.prompt)).length,
    1
  );
});

test("realtime deferred-close converts current advisory tickets into the next section must-resolve queue", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("KakaoBank");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서";
    }

    if (options?.speakerRole === "drafter") {
      return ["## Section Draft", `${round}라운드 섹션 초안입니다.`].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      if (round === 1) {
        return buildRealtimeLedgerResponse({
          currentFocus: "직무 지원 이유 문단을 현재 라운드에서 닫습니다.",
          targetSection: "직무 지원 이유",
          targetSectionKey: "why-banking",
          currentObjective: "직무 지원 이유를 닫되, 문장 압축 제안은 다음 섹션으로 넘깁니다.",
          rewriteDirection: "핵심 근거는 유지하고 문장 압축은 후속 섹션에서 흡수합니다.",
          mustResolve: ["직무 지원 이유를 한 문단으로 닫습니다."],
          miniDraft: "운영 안정성과 정합성을 한 문단으로 묶습니다.",
          acceptedDecisions: ["직무 지원 이유를 먼저 닫는다"],
          openChallenges: [],
          deferredChallenges: ["입행 후 포부를 거래 안정성 관점으로 더 구체화한다"],
          sectionOutcome: "deferred-close",
          challengeDecisionLines: [
            "- [new] add | sectionKey=why-banking | sectionLabel=직무 지원 이유 | severity=advisory | text=문장을 한 번 더 압축한다",
            "- [new] add | sectionKey=future-impact | sectionLabel=입행 후 포부 | severity=advisory | text=입행 후 포부를 거래 안정성 관점으로 더 구체화한다"
          ]
        });
      }

      return buildRealtimeLedgerResponse({
        currentFocus: "입행 후 포부 문단을 정리합니다.",
        targetSection: "입행 후 포부",
        targetSectionKey: "future-impact",
        currentObjective: "입행 후 포부와 앞선 문장 압축 포인트를 함께 정리합니다.",
        rewriteDirection: "입행 후 기여 포부와 문장 정돈을 동시에 마무리합니다.",
        mustResolve: [
          "입행 후 포부를 거래 안정성 관점으로 더 구체화한다",
          "문장을 한 번 더 압축한다"
        ],
        miniDraft: "거래 안정성과 운영 품질을 높이는 방향으로 포부를 정리합니다.",
        acceptedDecisions: ["직무 지원 이유는 deferred-close로 닫혔다"],
        openChallenges: [],
        deferredChallenges: [],
        sectionOutcome: "write-final"
      });
    }

    if (round === 1) {
      return [
        options?.participantId === "reviewer-1" ? "Status: REVISE" : "Status: APPROVE",
        "Mini Draft:",
        "현재 방향이면 문단을 닫아도 됩니다.",
        options?.participantId === "reviewer-1" ? "Challenge: [new] keep-open" : "Challenge: close",
        options?.participantId === "reviewer-1" ? "문장을 한 번 더 압축하면 더 좋겠습니다." : "남은 쟁점은 없습니다.",
        "Cross-feedback: agree",
        "첫 라운드라 coordinator reference만 있습니다."
      ].join("\n");
    }

    return [
      "Status: APPROVE",
      "Mini Draft:",
      "포부 문단도 충분합니다.",
      "Challenge: close",
      "남은 쟁점은 없습니다.",
      "Cross-feedback: [coord-r1] agree",
      "deferred-close handoff는 적절했습니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 카카오뱅크인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.artifacts.revisedDraft, "최종 지원서");
  const roundTwoCoordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 2 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  assert.ok(roundTwoCoordinatorPrompt);
  assert.match(roundTwoCoordinatorPrompt.prompt, /- Updated At Round: 1/);
  assert.doesNotMatch(roundTwoCoordinatorPrompt.prompt, /## Previous Discussion Ledger/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /문장을 한 번 더 압축한다/);
  assert.match(roundTwoCoordinatorPrompt.prompt, /입행 후 포부를 거래 안정성 관점으로 더 구체화한다/);
  const ledgerArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(ledgerArtifact);
  assert.match(ledgerArtifact, /Target Section Key: future-impact/);
  assert.match(ledgerArtifact, /문장을 한 번 더 압축한다/);
});

test("realtime BLOCK still prevents section closure even when open challenges are empty", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Socar");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "도입 문단을 닫습니다.",
        targetSection: "도입 문단",
        miniDraft: "핵심 임팩트를 먼저 말합니다.",
        acceptedDecisions: ["임팩트를 먼저 둔다"],
        openChallenges: [],
        deferredChallenges: []
      });
    }

    return [
      "Mini Draft: 방향은 나쁘지 않습니다.",
      "Challenge: 현재 섹션 쟁점은 없지만 아직 문단을 닫으면 안 됩니다.",
      "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
      options?.participantId === "reviewer-1" ? "Status: BLOCK" : "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "왜 쏘카인가?",
      draft: "초안",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    undefined,
    async () => "/done"
  );

  assert.equal(result.artifacts.revisedDraft, "초안");
  assert.equal(
    gateway.calls.filter((call) => call.providerId === "claude" && /closing a realtime multi-model essay review session/i.test(call.prompt)).length,
    0
  );
});

test("realtime injects a convergence notice after three consecutive REVISE-majority rounds and escalates to awaiting-user-input", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Toss");
  const compiler = new ContextCompiler(storage);
  const events: RunEvent[] = [];
  const observedStatuses: string[] = [];
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (options?.speakerRole === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종본";
    }

    if (options?.speakerRole === "drafter") {
      return ["## Section Draft", `${round}라운드 섹션 초안입니다.`].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      if (/## Convergence Notice/.test(prompt)) {
        return buildRealtimeLedgerResponse({
          currentFocus: "[AWAITING USER INPUT] 협업 사례와 운영 성과 중 어느 축을 더 앞세울지 사용자의 우선순위 확인이 필요합니다.",
          targetSection: "직무 지원 이유",
          targetSectionKey: "why-banking",
          currentObjective: "사용자 우선순위를 확인하기 전에는 더 이상 수렴시키기 어렵습니다.",
          rewriteDirection: "사용자 판단 전까지는 방향을 확정하지 않습니다.",
          mustResolve: ["협업 사례와 운영 성과 중 어느 축을 더 앞세울지 지정해 주세요."],
          miniDraft: "사용자 우선순위 확인 후 다시 정리합니다.",
          acceptedDecisions: ["핵심 근거는 유지한다"],
          openChallenges: [],
          deferredChallenges: [],
          sectionOutcome: "keep-open"
        });
      }

      return buildRealtimeLedgerResponse({
        currentFocus: "직무 지원 이유 문단을 더 압축합니다.",
        targetSection: "직무 지원 이유",
        targetSectionKey: "why-banking",
        currentObjective: "핵심 메시지를 더 또렷하게 압축합니다.",
        rewriteDirection: "지원 이유와 협업 성과의 비중을 계속 조정합니다.",
        mustResolve: ["핵심 문장을 더 압축합니다."],
        miniDraft: "운영 안정성과 협업 경험을 함께 보여줍니다.",
        acceptedDecisions: ["핵심 경험은 유지한다"],
        openChallenges: [],
        deferredChallenges: [],
        sectionOutcome: "keep-open"
      });
    }

    return [
      options?.participantId === "reviewer-3" ? "Status: APPROVE" : "Status: REVISE",
      "Mini Draft:",
      "아직 한 방향으로 충분히 수렴되지는 않았습니다.",
      options?.participantId === "reviewer-3" ? "Challenge: close" : "Challenge: [new] keep-open",
      options?.participantId === "reviewer-3" ? "현재 초안의 큰 틀은 맞습니다." : "강조 축이 계속 흔들리고 있습니다.",
      "Cross-feedback: agree",
      "직전 방향 조정은 이해되지만 아직 더 필요합니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "왜 토스인가?",
      draft: "초안",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini", "codex"],
      rounds: 1,
      maxRoundsPerSection: 6,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    async ({ projectSlug, runId }) => {
      observedStatuses.push((await storage.getRun(projectSlug, runId)).status);
      return "/done";
    }
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.artifacts.revisedDraft, "초안");
  const roundFourCoordinatorPrompt = gateway.calls.find(
    (call) => call.providerId === "claude" && call.round === 4 && !/closing a realtime multi-model essay review session/i.test(call.prompt)
  );
  assert.ok(roundFourCoordinatorPrompt);
  assert.match(roundFourCoordinatorPrompt.prompt, /## Convergence Notice/);
  assert.match(roundFourCoordinatorPrompt.prompt, /이 섹션은 3라운드 REVISE 중입니다/);
  assert.ok(events.some((event) => event.type === "awaiting-user-input" && /협업 사례와 운영 성과 중 어느 축을 더 앞세울지/.test(event.message ?? "")));
  assert.ok(observedStatuses.includes("awaiting-user-input"));
});

test("auto notion requests are labeled as auto context requests", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Shinhan Bank");
  await storage.updateProject({
    ...(await storage.getProject(project.slug)),
    notionPageIds: ["page-1", "page-2"]
  });
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude" && round === 0) {
      return [
        "## Resolution",
        "자동 컨텍스트 확인",
        "## Notion Brief",
        "자동 생성된 노션 컨텍스트입니다.",
        "## Sources Considered",
        "- page-1"
      ].join("\n");
    }

    if (providerId === "claude") {
      return ["## Summary", "요약", "## Improvement Plan", "- 보강", "## Revised Draft", "수정본"].join("\n");
    }

    return ["## Overall Verdict", "유용", "## Strengths", "- 좋음", "## Problems", "- 근거 부족", "## Suggestions", "- 보강", "## Direct Responses To Other Reviewers", "- 동의"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 신한은행인가?",
    draft: "초안",
    reviewMode: "deepFeedback",
    notionRequest: ".",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: []
  });

  const notionCall = gateway.calls.find((call) => call.providerId === "claude" && call.round === 0);
  assert.ok(notionCall);
  assert.match(notionCall.prompt, /## Auto Context Request/);
  assert.doesNotMatch(notionCall.prompt, /## User Notion Request/);
});

test("realtime mode tracks duplicate reviewer slots separately", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Dang근");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/closing a realtime multi-model essay review session/i.test(prompt)) {
      return "중복 reviewer 최종본";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "협업 경험을 더 또렷하게 맞춥니다.",
        targetSection: "협업 문단",
        miniDraft: "협업 장면을 먼저 보여주고, 그 결과를 숫자로 닫습니다.",
        acceptedDecisions: ["협업 장면을 구체화한다"],
        openChallenges: round === 1 ? ["결과 수치가 아직 약하다"] : []
      });
    }

    if (round === 1 && options?.participantId === "reviewer-1") {
      return ["Mini Draft: 협업 장면은 좋지만 결과 수치는 약합니다.", "Challenge: 결과 수치는 아직 열어둬야 합니다.", "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.", "Status: REVISE"].join("\n");
    }

    return [
      `Mini Draft: ${options?.participantLabel || "reviewer"} 기준으로 방향은 충분합니다.`,
      round === 1 ? "Challenge: 결과 수치는 더 보강해야 합니다." : "Challenge: 남은 쟁점은 없습니다.",
      round === 1 ? "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다." : "Cross-feedback: 직전 objection을 반영해 수치 보강에 동의합니다.",
      "Status: APPROVE"
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "Why Dang근?",
    draft: "동네 기반 서비스가 좋아서 지원합니다.",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "codex"],
    rounds: 1,
    maxRoundsPerSection: 2,
    selectedDocumentIds: []
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.rounds, 2);
  assert.equal(result.artifacts.revisedDraft, "중복 reviewer 최종본");

  const roundOneReviewerCalls = gateway.calls.filter((call) => call.round === 1 && call.providerId === "codex");
  assert.equal(roundOneReviewerCalls.length, 3);
  assert.deepEqual(
    roundOneReviewerCalls.map((call) => call.participantId),
    ["reviewer-1", "reviewer-2", "reviewer-3"]
  );
  assert.deepEqual(
    roundOneReviewerCalls.map((call) => call.participantLabel),
    ["Codex evidence reviewer", "Codex fit reviewer", "Codex voice reviewer"]
  );
  assert.notEqual(roundOneReviewerCalls[0].messageScope, roundOneReviewerCalls[1].messageScope);
  assert.notEqual(roundOneReviewerCalls[1].messageScope, roundOneReviewerCalls[2].messageScope);

  const storedTurnsRaw = await storage.readOptionalRunArtifact(project.slug, result.run.id, "review-turns.json");
  assert.ok(storedTurnsRaw);
  assert.match(storedTurnsRaw, /"participantId": "reviewer-1"/);
  assert.match(storedTurnsRaw, /"participantId": "reviewer-2"/);
});

test("realtime mode pauses at the configured section round limit when blocking issues remain", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Woowa");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round) => {
    if (providerId === "claude") {
      return buildRealtimeLedgerResponse({
        currentFocus: "이 문단의 근거를 더 보강합니다.",
        targetSection: "지원 동기 문단",
        miniDraft: "서비스 친숙함만 말하지 말고, 직접 만든 개선 경험과 연결합니다.",
        acceptedDecisions: ["서비스 친숙함만으로는 부족하다"],
        openChallenges: [`라운드 ${round}에서도 근거가 여전히 약하다`]
      });
    }

    return ["Mini Draft: 아직 구체성이 부족합니다.", "Challenge: 쟁점을 유지해야 합니다.", "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.", "Status: BLOCK"].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Woowa?",
      draft: "배달 서비스가 익숙해서 지원합니다.",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      maxRoundsPerSection: 3,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    async () => "/done"
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.rounds, 3);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "summary.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "improvement-plan.md"), undefined);
  assert.match(
    await storage.readOptionalRunArtifact(project.slug, result.run.id, "revised-draft.md") ?? "",
    /서비스 친숙함만 말하지 말고, 직접 만든 개선 경험과 연결합니다\./
  );
  const ledgerArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(ledgerArtifact);
  assert.match(ledgerArtifact, /## Open Challenges/);
  assert.ok(events.some((event) => event.type === "awaiting-user-input" && /without a document-ready conclusion/i.test(event.message ?? "")));
  assert.ok(events.some((event) => event.type === "user-input-received" && /without a final draft/i.test(event.message ?? "")));
  assert.equal(
    gateway.calls.filter((call) => call.providerId === "claude" && /closing a realtime multi-model essay review session/i.test(call.prompt)).length,
    0
  );
});

test("realtime mode aborts the active turn immediately and resumes through the intervention coordinator", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Socar");
  const compiler = new ContextCompiler(storage);
  const queuedMessages: string[] = [];
  let activeExecutionController: AbortController | undefined;

  const gateway = new FakeGateway(
    healthyStates(),
    (providerId, prompt, round) => {
      if (providerId === "claude") {
        if (/You are the intervention coordinator for a realtime multi-model essay review discussion/i.test(prompt)) {
          return buildRealtimeInterventionResponse({
            decision: "redirect",
            reason: "사용자 지시에 맞춰 협업 중심으로 즉시 방향을 전환합니다.",
            currentFocus: "사용자 요청대로 협업 경험 중심으로 방향을 전환합니다.",
            targetSection: "협업 문단",
            targetSectionKey: "collaboration-section",
            currentObjective: "혼자 해결했다는 인상을 줄이고 협업 맥락을 전면에 둡니다.",
            rewriteDirection: "개인 성취보다 협업 장면과 역할 조율을 앞세워 다시 씁니다.",
            mustResolve: ["[USER DIRECTIVE - 최우선 지시] 방금 논점 말고 협업이 드러나게 바꿔줘"],
            acceptedDecisions: ["협업 경험을 전면에 둔다"],
            openChallenges: [],
            deferredChallenges: [],
            sectionOutcome: "keep-open"
          });
        }
        if (/closing a realtime multi-model essay review session/i.test(prompt)) {
          return "협업 중심 최종본";
        }
        return buildRealtimeLedgerResponse({
          currentFocus: "우선 핵심 임팩트를 선명하게 잡습니다.",
          targetSection: "도입 문단",
          miniDraft: "모빌리티 서비스 경험보다 직접 만든 임팩트를 먼저 말합니다.",
          acceptedDecisions: ["임팩트를 먼저 제시한다"],
          openChallenges: ["협업 장면이 아직 드러나지 않는다"]
        });
      }

      return ["Mini Draft: 이제 충분합니다.", "Challenge: 남은 쟁점은 없습니다.", "Cross-feedback: 직전 objection에 동의하며 협업 장면을 보강했습니다.", "Status: APPROVE"].join("\n");
    },
    async (providerId, _prompt, options) => {
      if (providerId === "codex" && options.round === 1) {
        queuedMessages.push("방금 논점 말고 협업이 드러나게 바꿔줘");
        await new Promise((_resolve, reject) => {
          const rejectWithAbort = () => reject(new RunAbortedError("Run interrupted by queued intervention."));
          if (options.abortSignal?.aborted) {
            rejectWithAbort();
            return;
          }
          options.abortSignal?.addEventListener("abort", rejectWithAbort, { once: true });
          activeExecutionController?.abort(new RunInterventionAbortError("방금 논점 말고 협업이 드러나게 바꿔줘"));
        });
      }
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Socar?",
      draft: "모빌리티 서비스를 좋아해서 지원합니다.",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    undefined,
    undefined,
    () => queuedMessages.splice(0, queuedMessages.length),
    undefined,
    (controller) => {
      activeExecutionController = controller;
    }
  );

  assert.equal(result.artifacts.revisedDraft, "협업 중심 최종본");
  assert.equal(
    gateway.calls.some((call) => call.providerId === "gemini" && call.round === 1),
    false
  );
  assert.equal(
    gateway.calls.some((call) => call.providerId === "claude" && call.round === 2 && /You are the intervention coordinator for a realtime multi-model essay review discussion/i.test(call.prompt)),
    true
  );
  const snapshotArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "intervention-partial-snapshot.json");
  assert.ok(snapshotArtifact);
  assert.match(snapshotArtifact, /"participantLabel": "Claude section coordinator"/);
  assert.match(snapshotArtifact, /"participantLabel": "Claude section drafter"/);
  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "chat-messages.json");
  assert.ok(chatArtifact);
  assert.match(chatArtifact, /협업이 드러나게 바꿔줘/);
});

test("realtime intervention coordinator can ask for clarification and retry with the follow-up directive", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Karrot");
  const compiler = new ContextCompiler(storage);
  const queuedMessages: string[] = [];
  const prompts: UserInterventionRequest[] = [];
  let activeExecutionController: AbortController | undefined;
  let clarifyCount = 0;

  const gateway = new FakeGateway(
    healthyStates(),
    (providerId, prompt) => {
      if (providerId === "claude") {
        if (/You are the intervention coordinator for a realtime multi-model essay review discussion/i.test(prompt)) {
          clarifyCount += 1;
          if (clarifyCount === 1) {
            return buildRealtimeInterventionResponse({
              decision: "clarify",
              reason: "사용자 지시가 방향성만 있고 초점이 모호합니다.",
              clarifyingQuestion: "협업을 강조하되 어느 문단을 먼저 바꿔야 하는지 한 문장으로 지정해 주세요."
            });
          }
          return buildRealtimeInterventionResponse({
            decision: "redirect",
            reason: "추가 지시를 반영해 도입 문단을 협업 경험 중심으로 재정렬합니다.",
            currentFocus: "도입 문단을 협업 경험 중심으로 재정렬합니다.",
            targetSection: "도입 문단",
            targetSectionKey: "intro-section",
            currentObjective: "협업 경험이 첫 문단에서 바로 드러나게 만듭니다.",
            rewriteDirection: "임팩트보다 협업 장면과 조율 역할을 먼저 제시합니다.",
            mustResolve: ["[USER DIRECTIVE - 최우선 지시] 도입 문단부터 협업 사례를 전면에 둬줘"],
            acceptedDecisions: ["도입 문단부터 협업 사례를 꺼낸다"],
            openChallenges: [],
            deferredChallenges: []
          });
        }
        if (/closing a realtime multi-model essay review session/i.test(prompt)) {
          return "협업 강조 최종본";
        }
        return buildRealtimeLedgerResponse({
          currentFocus: "핵심 성과를 먼저 정리합니다.",
          targetSection: "도입 문단",
          targetSectionKey: "intro-section",
          miniDraft: "성과를 먼저 제시한 뒤 회사 연결로 이어갑니다.",
          acceptedDecisions: ["성과를 먼저 제시한다"],
          openChallenges: []
        });
      }

      return ["Mini Draft: 현재 방향은 충분합니다.", "Challenge: 남은 쟁점은 없습니다.", "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.", "Status: APPROVE"].join("\n");
    },
    async (providerId, _prompt, options) => {
      if (providerId === "codex" && options.round === 1) {
        queuedMessages.push("협업 중심으로 바꿔줘");
        await new Promise((_resolve, reject) => {
          const rejectWithAbort = () => reject(new RunAbortedError("Run interrupted by queued intervention."));
          if (options.abortSignal?.aborted) {
            rejectWithAbort();
            return;
          }
          options.abortSignal?.addEventListener("abort", rejectWithAbort, { once: true });
          activeExecutionController?.abort(new RunInterventionAbortError("협업 중심으로 바꿔줘"));
        });
      }
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const events: RunEvent[] = [];
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Karrot?",
      draft: "지역 기반 서비스가 좋아서 지원합니다.",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? "도입 문단부터 협업 사례를 전면에 둬줘" : "/done";
    },
    () => queuedMessages.splice(0, queuedMessages.length),
    undefined,
    (controller) => {
      activeExecutionController = controller;
    }
  );

  assert.equal(result.run.status, "completed");
  assert.equal(clarifyCount, 2);
  assert.ok(events.some((event) => event.type === "awaiting-user-input" && /한 문장으로 지정해 주세요/.test(event.message ?? "")));
  assert.ok(gateway.calls.some((call) => /도입 문단부터 협업 사례를 전면에 둬줘/.test(call.prompt)));
});

test("realtime intervention force-close directives defer open challenges and hand off immediately", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Naver");
  const compiler = new ContextCompiler(storage);
  const queuedMessages: string[] = [];
  let activeExecutionController: AbortController | undefined;

  const gateway = new FakeGateway(
    healthyStates(),
    (providerId, prompt, round) => {
      if (providerId === "claude") {
        if (/closing a realtime multi-model essay review session/i.test(prompt)) {
          return "섹션 강제 확정 뒤 최종본";
        }
        if (round === 1) {
          return buildRealtimeLedgerResponse({
            currentFocus: "지원 동기 문단의 논점을 정리합니다.",
            targetSection: "지원 동기 문단",
            targetSectionKey: "motivation-section",
            miniDraft: "네이버 서비스 친숙함보다 문제 해결 경험을 연결합니다.",
            acceptedDecisions: ["서비스 친숙함만으로는 부족하다"],
            openChallenges: ["지원 동기와 실무 경험 연결이 아직 약하다"],
            deferredChallenges: ["협업 문단의 역할 분담을 후반에 보강한다"]
          });
        }
        return buildRealtimeLedgerResponse({
          currentFocus: "협업 문단으로 즉시 handoff합니다.",
          targetSection: "협업 문단",
          targetSectionKey: "collaboration-section",
          miniDraft: "역할 분담과 조율 장면을 협업 문단에서 정리합니다.",
          acceptedDecisions: ["협업 문단으로 이동한다"],
          openChallenges: [],
          deferredChallenges: ["지원 동기와 실무 경험 연결이 아직 약하다"]
        });
      }

      return ["Mini Draft: 충분합니다.", "Challenge: 남은 쟁점은 없습니다.", "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.", "Status: APPROVE"].join("\n");
    },
    async (providerId, _prompt, options) => {
      if (providerId === "codex" && options.round === 1) {
        queuedMessages.push("/close 여기서 확정하고 넘어가");
        await new Promise((_resolve, reject) => {
          const rejectWithAbort = () => reject(new RunAbortedError("Run interrupted by queued intervention."));
          if (options.abortSignal?.aborted) {
            rejectWithAbort();
            return;
          }
          options.abortSignal?.addEventListener("abort", rejectWithAbort, { once: true });
          activeExecutionController?.abort(new RunInterventionAbortError("/close 여기서 확정하고 넘어가"));
        });
      }
    }
  );

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "Why Naver?",
      draft: "서비스를 자주 사용해서 지원합니다.",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    undefined,
    undefined,
    () => queuedMessages.splice(0, queuedMessages.length),
    undefined,
    (controller) => {
      activeExecutionController = controller;
    }
  );

  assert.equal(result.run.status, "completed");
  assert.equal(
    gateway.calls.some((call) => /You are the intervention coordinator for a realtime multi-model essay review discussion/i.test(call.prompt)),
    false
  );
  const ledgerArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(ledgerArtifact);
  assert.match(ledgerArtifact, /Target Section: 협업 문단/);
  assert.match(ledgerArtifact, /지원 동기와 실무 경험 연결이 아직 약하다/);
});
