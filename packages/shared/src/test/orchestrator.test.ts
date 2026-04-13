import * as assert from "node:assert/strict";
import test from "node:test";
import { ContextCompiler } from "../core/contextCompiler";
import { OrchestratorGateway, ReviewOrchestrator, UserInterventionRequest } from "../core/orchestrator";
import {
  buildRealtimeCoordinatorDiscussionPrompt,
  buildRealtimeFinalDraftPrompt,
  buildRealtimeSectionDrafterPrompt,
  buildRealtimeReviewerPrompt
} from "../core/orchestrator/prompts/realtimePrompts";
import { buildDrafterBriefBlock } from "../core/orchestrator/prompts/promptBlocks";
import {
  buildRealtimeReviewerFeedbackPacket,
  extractDiscussionLedger,
  extractNormalizedReviewerChallenge,
  extractRealtimeReviewerChallengeAction,
  extractRealtimeReviewerObjection,
  splitSectionDraftOutput
} from "../core/orchestrator/parsing/responseParsers";
import {
  shouldRunWeakConsensusPolish,
  validateSectionOutcome
} from "../core/orchestrator/discussion/convergenceEvaluator";
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
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
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

  assert.equal(result.run.roleAssignments?.length, 8);
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
  const gateway = new FakeGateway(
    healthyStates(),
    (providerId) => {
      if (providerId === "claude") {
        return ["## Summary", "Coordinator summary", "## Improvement Plan", "- Keep the collaboration angle", "## Revised Draft", "Updated draft"].join("\n");
      }
      return ["## Overall Verdict", "Useful", "## Strengths", "- Good continuation", "## Problems", "- Need sharper closing", "## Suggestions", "- Keep collaboration central", "## Direct Responses To Other Reviewers", "- Agree"].join("\n");
    },
    async (providerId, _prompt, options) => {
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-started",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All"
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-delta",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All",
        message: `${providerId} resumed message`
      });
      await options.onEvent?.({
        timestamp: new Date().toISOString(),
        type: "chat-message-completed",
        providerId,
        participantId: options.participantId,
        participantLabel: options.participantLabel,
        round: options.round,
        messageId: `${providerId}-${options.round}`,
        speakerRole: options.speakerRole,
        recipient: "All"
      });
    }
  );

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

test("orchestrator can resume an existing run id without overwriting prior chat history or review turns", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Bucketplace");

  await storage.createRun({
    id: "run-1",
    projectSlug: project.slug,
    question: "Why Bucketplace?",
    draft: "기존 초안",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    maxRoundsPerSection: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: "2026-04-11T00:00:00.000Z",
    finishedAt: "2026-04-11T00:03:00.000Z"
  });
  await storage.saveRunTextArtifact(project.slug, "run-1", "revised-draft.md", "이전 수정 초안");
  await storage.saveReviewTurns(project.slug, "run-1", [
    {
      providerId: "claude",
      participantId: "section-coordinator",
      participantLabel: "Coordinator",
      role: "coordinator",
      round: 1,
      prompt: "old prompt",
      response: "old response",
      startedAt: "2026-04-11T00:00:01.000Z",
      finishedAt: "2026-04-11T00:00:05.000Z",
      status: "completed"
    }
  ]);
  await storage.saveRunChatMessages(project.slug, "run-1", [
    {
      id: "old-chat",
      providerId: "claude",
      participantId: "section-coordinator",
      participantLabel: "Coordinator",
      speaker: "Claude",
      speakerRole: "coordinator",
      recipient: "All",
      round: 1,
      content: "이전 대화 메시지",
      startedAt: "2026-04-11T00:00:01.000Z",
      finishedAt: "2026-04-11T00:00:05.000Z",
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
  const result = await orchestrator.run({
    existingRunId: "run-1",
    projectSlug: project.slug,
    question: "Why Bucketplace?",
    draft: "이전 수정 초안",
    reviewMode: "deepFeedback",
    continuationFromRunId: "run-1",
    continuationNote: "같은 실행에서 이어서 다듬어줘",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.run.id, "run-1");
  assert.equal(result.run.startedAt, "2026-04-11T00:00:00.000Z");
  assert.ok(result.run.lastResumedAt);

  const persistedTurnsRaw = await storage.readOptionalRunArtifact(project.slug, "run-1", "review-turns.json");
  assert.ok(persistedTurnsRaw);
  assert.match(persistedTurnsRaw, /old response/);

  const chatArtifact = await storage.readOptionalRunArtifact(project.slug, "run-1", "chat-messages.json");
  assert.ok(chatArtifact);
  assert.match(chatArtifact, /이전 대화 메시지/);
  assert.match(chatArtifact, /같은 실행에서 이어서 다듬어줘/);
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
  assert.ok(events.some((event) => event.type === "chat-message-started" && event.messageId === preambleMessageId));
  assert.ok(events.some((event) => event.type === "chat-message-delta" && event.messageId === preambleMessageId));
  assert.ok(!events.some((event) => event.type === "chat-message-completed" && event.messageId === preambleMessageId));
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

test("realtime mode finalizes after the first PASS-only reviewer round", async (t) => {
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
  assert.equal(result.run.rounds, 1);
  assert.equal(result.artifacts.revisedDraft, "최종 지원서 초안");
  assert.equal((await storage.getPreferences()).lastReviewMode, "realtime");
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "summary.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "improvement-plan.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "revised-draft.md"), "최종 지원서 초안");
  const discussionLedger = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(discussionLedger);
  assert.match(discussionLedger, /## Mini Draft/);
  assert.match(discussionLedger, /핵심 성과 수치를 먼저 선명하게 정리합니다\./);
  const reviewerPrompt = gateway.calls.find((call) => call.providerId === "codex");
  assert.ok(reviewerPrompt);
  assert.match(reviewerPrompt.prompt, /Status: PASS/);
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
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
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
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
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
  assert.match(reviewerPrompt.prompt, /Status: PASS/);
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

test("realtime reviewer prompts include the latest ledger and scoped cross-feedback references", () => {
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude coordinator",
      role: "coordinator",
      round: 1,
      prompt: "coord",
      response: buildRealtimeLedgerResponse({
        currentFocus: "브랜드 적합도보다 성과 근거를 먼저 정리합니다.",
        targetSection: "지원 동기 문단",
        targetSectionKey: "why-musinsa",
        miniDraft: "검색 품질 개선 성과를 먼저 제시하고, 왜 그 경험이 무신사와 닿는지 한 문장으로 잇습니다.",
        acceptedDecisions: ["성과를 문단 첫머리에 둔다"],
        openChallenges: ["무신사와의 연결 근거가 아직 약하다"]
      }),
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
      prompt: "reviewer-1",
      response: [
        "Mini Draft: 성과를 먼저 두는 방향은 좋습니다.",
        "Challenge: 무신사와의 연결 근거는 열어둬야 합니다.",
        "Cross-feedback: 첫 라운드라 교차 피드백은 없습니다.",
        "Status: PASS"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];
  const latestLedger: DiscussionLedger = {
    currentFocus: "성과 근거와 브랜드 적합도를 같이 묶습니다.",
    currentObjective: "성과 근거와 무신사 연결을 한 문단에서 읽히게 합니다.",
    rewriteDirection: "성과를 먼저 두고 무신사 연결 문장을 뒤에 붙입니다.",
    miniDraft: "검색 품질 개선 성과 뒤에 무신사 탐색 경험 연결을 붙입니다.",
    mustKeep: [],
    mustResolve: ["무신사 연결 문장을 더 선명하게 씁니다."],
    availableEvidence: [],
    exitCriteria: [],
    acceptedDecisions: ["성과를 문단 첫머리에 둔다"],
    openChallenges: ["무신사와의 연결 근거가 아직 약하다"],
    deferredChallenges: [],
    targetSection: "지원 동기 문단",
    targetSectionKey: "why-musinsa",
    nextOwner: "fit_reviewer",
    updatedAtRound: 2
  };

  const prompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n패션 플랫폼이 좋아서 지원합니다.",
    "",
    [],
    turns,
    2,
    latestLedger,
    "reviewer-2"
  ).text;

  assert.match(prompt, /- Updated At Round: 2/);
  assert.doesNotMatch(prompt, /## Discussion Ledger/);
  assert.match(prompt, /## Coordinator Reference/);
  assert.match(prompt, /## Reviewer References/);
  assert.match(prompt, /## Mini Draft/);
  assert.match(prompt, /성과를 문단 첫머리에 둔다/);
  assert.match(prompt, /무신사와의 연결 근거가 아직 약하다/);
  assert.match(prompt, /rev-r1-reviewer-1/);
  assert.match(prompt, /Cross-feedback: \[refId\] agree/);
  assert.match(prompt, /Cross-feedback: \[refId\] disagree/);
});

test("realtime drafter prompt uses a flat coordinator brief without previous draft anchors", () => {
  const ledger: DiscussionLedger = {
    currentFocus: "성과와 지원 동기 연결을 한 문단에서 정리합니다.",
    currentObjective: "핵심 성과와 회사 적합도를 동시에 읽히게 만듭니다.",
    rewriteDirection: "성과를 먼저 두고 회사 연결 문장을 뒤에 붙입니다.",
    miniDraft: "결제 안정화 성과를 먼저 제시한 뒤 회사 연결을 잇습니다.",
    sectionDraft: "이전 초안 전체가 여기에 들어갑니다.",
    changeRationale: "이전 초안의 설명 메모입니다.",
    mustKeep: ["결제 안정화 경험"],
    mustResolve: ["회사 연결 문장을 더 선명하게 쓴다"],
    availableEvidence: ["트래픽 급증 시 안정화 경험"],
    exitCriteria: ["성과와 회사 연결이 한 문단에서 함께 읽힌다"],
    acceptedDecisions: ["성과를 먼저 배치한다"],
    openChallenges: ["연결 문장이 아직 약하다"],
    deferredChallenges: [],
    targetSection: "지원 동기 문단",
    targetSectionKey: "지원-동기-문단",
    nextOwner: "section_drafter",
    updatedAtRound: 2
  };
  const drafterBriefBlock = buildDrafterBriefBlock(ledger);

  const prompt = buildRealtimeSectionDrafterPrompt(
    "## Current Draft\n초안",
    "",
    [],
    [],
    2,
    ledger
  ).text;

  assert.match(drafterBriefBlock, /<coordinator-brief>/);
  assert.doesNotMatch(drafterBriefBlock, /###/);
  assert.doesNotMatch(drafterBriefBlock, /## /);
  assert.doesNotMatch(drafterBriefBlock, /이전 초안 전체가 여기에 들어갑니다\./);
  assert.match(prompt, /<coordinator-brief>/);
  assert.doesNotMatch(prompt, /<coordinator-context>/);
  assert.doesNotMatch(prompt, /### Current Focus/);
  assert.doesNotMatch(prompt, /### Previous Draft/);
  assert.doesNotMatch(prompt, /Section Draft:/);
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

test("realtime prompts expose formal tone guidance, valid section keys, role boundaries, and finalizer feedback packets", () => {
  const ledger: DiscussionLedger = {
    currentFocus: "직무 지원 이유를 먼저 닫습니다.",
    currentObjective: "지원 이유를 직무 언어로 선명하게 닫습니다.",
    rewriteDirection: "정합성과 운영 안정성을 한 문단으로 압축합니다.",
    miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
    mustKeep: [],
    mustResolve: ["생활금융 맥락을 한 문장 더 보강합니다."],
    availableEvidence: [],
    exitCriteria: [],
    acceptedDecisions: ["직무 언어를 유지한다"],
    openChallenges: [],
    deferredChallenges: ["입행 후 포부를 거래 안정성 관점으로 더 구체화한다"],
    targetSection: "직무 지원 이유",
    targetSectionKey: "why-banking",
    nextOwner: "section_drafter",
    updatedAtRound: 1
  };
  const revisePacket = buildRealtimeReviewerFeedbackPacket({
    participantId: "reviewer-1",
    participantLabel: "Codex evidence reviewer",
    response: [
      "Status: REVISE",
      "Mini Draft:",
      "회사 적합도 연결은 충분하지만 한 문장만 더 다듬으면 좋겠습니다.",
      "Challenge: close",
      "생활금융 연결 문장을 한 단계 더 압축해 주세요.",
      "Cross-feedback: agree",
      "첫 라운드라 coordinator reference만 있습니다."
    ].join("\n")
  });
  const passPacket = buildRealtimeReviewerFeedbackPacket({
    participantId: "reviewer-2",
    participantLabel: "Gemini fit reviewer",
    response: [
      "Status: PASS",
      "Mini Draft:",
      "현재 방향이면 섹션을 닫아도 됩니다.",
      "Challenge: close",
      "남은 쟁점은 없습니다.",
      "Cross-feedback: agree",
      "첫 라운드라 coordinator reference만 있습니다."
    ].join("\n")
  });

  const coordinatorPrompt = buildRealtimeCoordinatorDiscussionPrompt(
    "## Current Draft\n초안",
    "",
    [],
    [],
    1,
    ledger
  ).text;
  const reviewerPrompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n초안",
    "",
    [],
    [],
    1,
    ledger,
    "reviewer-1"
  ).text;
  const drafterPrompt = buildRealtimeSectionDrafterPrompt(
    "## Current Draft\n초안",
    "",
    [],
    [],
    1,
    ledger
  ).text;
  const finalizerPrompt = buildRealtimeFinalDraftPrompt(
    "## Current Draft\n초안",
    "",
    [],
    [],
    [revisePacket, passPacket],
    {
      ...ledger,
      sectionDraft: "드래프터 초안입니다."
    }
  ).text;

  assert.match(coordinatorPrompt, /## 어조 규칙/);
  assert.match(coordinatorPrompt, /## Valid Section Keys/);
  assert.match(coordinatorPrompt, /why-banking/);
  assert.match(coordinatorPrompt, /future-impact/);
  assert.match(coordinatorPrompt, /챌린지 텍스트나 ID를 섹션 키로 사용하지 말 것/);
  assert.match(coordinatorPrompt, /## Section Role Boundary/);
  assert.match(coordinatorPrompt, /현재 섹션 담당:/);
  assert.match(coordinatorPrompt, /다음 섹션으로 위임:/);
  assert.match(reviewerPrompt, /## 어조 규칙/);
  assert.match(reviewerPrompt, /Status: PASS/);
  assert.match(drafterPrompt, /## 어조 규칙/);
  assert.match(drafterPrompt, /<coordinator-brief>/);
  assert.match(drafterPrompt, /의도: 직무 지원 이유를 먼저 닫습니다\./);
  assert.match(drafterPrompt, /재작성 방향: 정합성과 운영 안정성을 한 문단으로 압축합니다\./);
  assert.doesNotMatch(drafterPrompt, /<coordinator-context>/);
  assert.doesNotMatch(drafterPrompt, /## Coordinator Reference/);
  assert.doesNotMatch(drafterPrompt, /### Current Focus/);
  assert.doesNotMatch(drafterPrompt, /### Rewrite Direction/);
  assert.match(finalizerPrompt, /## Reviewer Feedback Packets/);
  assert.match(finalizerPrompt, /Codex evidence reviewer \(Status: REVISE\)/);
  assert.match(finalizerPrompt, /Gemini fit reviewer \(Status: PASS\)/);
  assert.match(finalizerPrompt, /생활금융 연결 문장을 한 단계 더 압축해 주세요\./);
  assert.match(finalizerPrompt, /드래프터 초안입니다\./);
});

test("realtime parses structured section outcome and challenge decisions while keeping legacy fallback", () => {
  const handoffLedger = extractDiscussionLedger(
    buildRealtimeLedgerResponse({
      currentFocus: "직무 지원 이유를 먼저 닫습니다.",
      targetSection: "직무 지원 이유",
      targetSectionKey: "why-banking",
      miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
      acceptedDecisions: ["정합성 문장은 유지한다"],
      openChallenges: ["왜 은행이어야 하는지 한 문장 더 보강한다"],
      deferredChallenges: ["입행 후 포부 문단을 더 구체화한다"],
      sectionOutcome: "handoff-next-section",
      challengeDecisionLines: [
        "- [new] add | sectionKey=future-impact | sectionLabel=입행 후 포부 | severity=advisory | text=마지막 문단에서 거래 안정성 기여를 더 구체화한다"
      ]
    }),
    1
  );
  const fallbackLedger = extractDiscussionLedger(
    buildRealtimeLedgerResponse({
      currentFocus: "포부 문단을 보강합니다.",
      targetSection: "입행 후 포부",
      targetSectionKey: "future-impact",
      miniDraft: "정합성과 운영 안정성을 함께 드러내는 문장으로 정리합니다.",
      acceptedDecisions: ["정합성 문장은 유지한다"],
      openChallenges: [],
      deferredChallenges: [],
      sectionOutcome: "write-final",
      challengeDecisionLines: ["- [new] add | malformed"]
    }),
    2
  );

  assert.ok(handoffLedger);
  assert.equal(handoffLedger?.targetSectionKey, "why-banking");
  assert.equal(handoffLedger?.sectionOutcome, "handoff-next-section");
  assert.ok(handoffLedger?.tickets?.some((ticket) => ticket.text === "마지막 문단에서 거래 안정성 기여를 더 구체화한다"));
  assert.ok(handoffLedger?.deferredChallenges.includes("마지막 문단에서 거래 안정성 기여를 더 구체화한다"));
  assert.ok(fallbackLedger);
  assert.equal(fallbackLedger?.sectionOutcome, "write-final");
  assert.deepEqual(fallbackLedger?.openChallenges, []);
});

test("validateSectionOutcome downgrades premature write-final into a next-section handoff", () => {
  assert.equal(
    validateSectionOutcome("write-final", {
      currentSectionReady: true,
      wholeDocumentReady: false,
      hasNextCluster: true
    }),
    "handoff-next-section"
  );
  assert.equal(
    validateSectionOutcome("write-final", {
      currentSectionReady: true,
      wholeDocumentReady: true,
      hasNextCluster: true
    }),
    "write-final"
  );
});

test("shouldRunWeakConsensusPolish allows one polish round per section key", () => {
  const activeReviewers = [
    { participantId: "reviewer-1", participantLabel: "r1", providerId: "codex", role: "reviewer", assignment: { role: "evidence_reviewer", providerId: "codex", useProviderDefaults: true } },
    { participantId: "reviewer-2", participantLabel: "r2", providerId: "gemini", role: "reviewer", assignment: { role: "fit_reviewer", providerId: "gemini", useProviderDefaults: true } },
    { participantId: "reviewer-3", participantLabel: "r3", providerId: "claude", role: "reviewer", assignment: { role: "voice_reviewer", providerId: "claude", useProviderDefaults: true } }
  ] as unknown as Parameters<typeof shouldRunWeakConsensusPolish>[0];
  const statuses = new Map([
    ["reviewer-1", "REVISE"],
    ["reviewer-2", "REVISE"],
    ["reviewer-3", "PASS"]
  ] as const);
  const polishRoundsUsed = new Set<string>();

  assert.equal(
    shouldRunWeakConsensusPolish(activeReviewers, statuses, "why-banking", polishRoundsUsed),
    true
  );
  polishRoundsUsed.add("why-banking");
  assert.equal(
    shouldRunWeakConsensusPolish(activeReviewers, statuses, "why-banking", polishRoundsUsed),
    false
  );
});

test("realtime reviewer prompt uses reference packets and excludes self references by participant id", () => {
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude coordinator",
      role: "coordinator",
      round: 1,
      prompt: "coord",
      response: buildRealtimeLedgerResponse({
        currentFocus: "직무 지원 이유를 먼저 닫습니다.",
        targetSection: "직무 지원 이유",
        targetSectionKey: "why-banking",
        miniDraft: "정합성과 운영 안정성을 함께 다루는 이유를 직무 언어로 정리합니다.",
        acceptedDecisions: ["MOA와 CAMPUNG을 함께 쓴다"],
        openChallenges: [],
        deferredChallenges: ["입행 후 포부를 더 구체화한다"]
      }),
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
      prompt: "reviewer-1",
      response: [
        "Mini Draft: 직무 언어는 적절합니다.",
        "Challenge: 남은 쟁점은 이제 닫아도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator note만 참고합니다.",
        "Status: PASS"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    },
    {
      providerId: "codex",
      participantId: "reviewer-2",
      participantLabel: "Codex fit reviewer",
      role: "reviewer",
      round: 1,
      prompt: "reviewer-2",
      response: [
        "Mini Draft: 결론 문장은 더 또렷하게 유지하세요.",
        "Challenge: 입행 후 포부는 후속 과제로 넘겨도 됩니다.",
        "Cross-feedback: 첫 라운드라 coordinator note만 참고합니다.",
        "Status: PASS"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];
  const ledger: DiscussionLedger = {
    currentFocus: "마지막 포부 문단으로 넘어갑니다.",
    currentObjective: "입행 후 포부를 구체화합니다.",
    rewriteDirection: "거래 안정성 기여를 더 또렷하게 씁니다.",
    miniDraft: "입행 후에는 거래 처리 안정성과 운영 품질 향상에 기여하고 싶습니다.",
    mustKeep: [],
    mustResolve: [],
    availableEvidence: [],
    exitCriteria: [],
    acceptedDecisions: ["MOA와 CAMPUNG을 함께 쓴다"],
    openChallenges: [],
    deferredChallenges: [],
    targetSection: "입행 후 포부",
    targetSectionKey: "future-impact",
    nextOwner: "fit_reviewer",
    updatedAtRound: 2
  };

  const prompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n초안",
    "",
    [],
    turns,
    2,
    ledger,
    "reviewer-1"
  ).text;

  assert.match(prompt, /## Coordinator Reference/);
  assert.match(prompt, /## Reviewer References/);
  assert.match(prompt, /coord-r1/);
  assert.match(prompt, /rev-r1-reviewer-2/);
  assert.doesNotMatch(prompt, /rev-r1-reviewer-1/);
  assert.match(prompt, /Cross-feedback: \[refId\] agree/);
  assert.match(prompt, /Cross-feedback: \[refId\] disagree/);
});

test("realtime reviewer references prioritize Challenge lines over Mini Draft lines", () => {
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude coordinator",
      role: "coordinator",
      round: 1,
      prompt: "coord",
      response: buildRealtimeLedgerResponse({
        currentFocus: "지원 이유를 닫습니다.",
        targetSection: "지원 이유",
        targetSectionKey: "why-toss",
        miniDraft: "정합성과 운영 경험을 연결합니다.",
        acceptedDecisions: ["정합성 문장을 유지한다"],
        openChallenges: [],
        deferredChallenges: ["포부를 더 구체화한다"]
      }),
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
      prompt: "reviewer-1",
      response: [
        "Mini Draft: 이 문장은 유지하세요.",
        "Challenge: 마지막 포부를 더 구체화해야 합니다.",
        "Cross-feedback: 첫 라운드라 coordinator reference만 있습니다.",
        "Status: PASS"
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];
  const ledger: DiscussionLedger = {
    currentFocus: "포부를 닫습니다.",
    currentObjective: "입행 후 포부를 더 구체화합니다.",
    rewriteDirection: "포부 문장을 한 단계 더 또렷하게 씁니다.",
    miniDraft: "포부는 한 문장 더 구체화하세요.",
    mustKeep: [],
    mustResolve: [],
    availableEvidence: [],
    exitCriteria: [],
    acceptedDecisions: ["정합성 문장을 유지한다"],
    openChallenges: [],
    deferredChallenges: [],
    targetSection: "포부",
    targetSectionKey: "future-impact",
    nextOwner: "fit_reviewer",
    updatedAtRound: 2
  };

  const prompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n초안",
    "",
    [],
    turns,
    2,
    ledger,
    "reviewer-2"
  ).text;

  assert.match(prompt, /포부를 더 구체화해야 합니다/);
  assert.doesNotMatch(prompt, /이 문장은 유지하세요\./);
});

test("realtime reviewer references normalize structured Challenge grammar before summarizing", () => {
  const turns: ReviewTurn[] = [
    {
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude coordinator",
      role: "coordinator",
      round: 1,
      prompt: "coord",
      response: buildRealtimeLedgerResponse({
        currentFocus: "직무 지원 이유를 닫습니다.",
        targetSection: "직무 지원 이유",
        targetSectionKey: "why-banking",
        miniDraft: "정합성과 운영 안정성을 뱅킹 직무 언어로 정리합니다.",
        acceptedDecisions: ["정합성 문장은 유지한다"],
        openChallenges: [],
        deferredChallenges: ["왜 신한인가 연결을 더 구체화한다"]
      }),
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
      prompt: "reviewer-1",
      response: [
        "Status: REVISE",
        "Mini Draft:",
        "정합성 문장은 유지하세요.",
        "Challenge: [t-why-company-a1b2c3]   KEEP-OPEN  ",
        "왜 신한인가와의 연결이 한 단계 더 필요합니다.  ",
        "Cross-feedback: agree",
        "첫 라운드라 coordinator reference만 있습니다."
      ].join("\n"),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed"
    }
  ];
  const ledger: DiscussionLedger = {
    currentFocus: "왜 신한인가 문단으로 넘어갑니다.",
    currentObjective: "회사 적합도 연결을 다음 문단에서 정리합니다.",
    rewriteDirection: "왜 신한인가와의 연결 문장을 보강합니다.",
    miniDraft: "다음 섹션 방향은 적절합니다.",
    mustKeep: [],
    mustResolve: [],
    availableEvidence: [],
    exitCriteria: [],
    acceptedDecisions: ["정합성 문장은 유지한다"],
    openChallenges: [],
    deferredChallenges: [],
    targetSection: "왜 신한인가",
    targetSectionKey: "why-company",
    nextOwner: "fit_reviewer",
    updatedAtRound: 2
  };

  const prompt = buildRealtimeReviewerPrompt(
    "## Current Draft\n초안",
    "",
    [],
    turns,
    2,
    ledger,
    "reviewer-2"
  ).text;

  assert.match(prompt, /\[t-why-company-a1b2c3\] keep-open because 왜 신한인가와의 연결이 한 단계 더 필요합니다\./);
  assert.doesNotMatch(prompt, /KEEP-OPEN\s+because/);
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
    "Status: PASS"
  ].join("\n");

  assert.deepEqual(parseReviewerCardContent(response), {
    miniDraft: "방향은 유지해도 됩니다.",
    challenges: [],
    crossFeedback: [],
    status: "PASS"
  });
});

test("realtime BLOCK runs coordinator synthesis and escalates to awaiting-user-input without finalizing", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly");
  const compiler = new ContextCompiler(storage);
  const events: RunEvent[] = [];
  const observedStatuses: string[] = [];
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, round, options) => {
    if (/realtime-round-1-coordinator-block-synthesis/.test(options?.messageScope ?? "")) {
      return [
        "## Blocking Summary",
        "리뷰어들이 협업 사례와 서비스 임팩트 중 어느 축을 우선할지 결정이 필요하다고 판단했습니다.",
        "",
        "## User Question",
        "협업 사례와 서비스 임팩트 중 어느 축을 먼저 강조할지 한 문장으로 알려 주세요."
      ].join("\n");
    }

    if (options?.speakerRole === "coordinator") {
      if (round === 1) {
        return buildRealtimeLedgerResponse({
          currentFocus: "핵심 성과와 협업 사례 중 무엇을 먼저 강조할지 정리합니다.",
          targetSection: "지원 동기 문단",
          targetSectionKey: "why-kurly",
          miniDraft: "결제 안정화 성과를 먼저 둘지 협업 장면을 먼저 둘지 정리합니다.",
          acceptedDecisions: ["결제 안정화 경험은 유지한다"],
          openChallenges: [],
          deferredChallenges: []
        });
      }
      return "예상하지 못한 coordinator 호출";
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Section Draft",
        "결제 안정화 경험과 협업 장면을 함께 보여주는 드래프터 초안입니다.",
        "",
        "## Change Rationale",
        "성과와 협업을 모두 남겨 두었습니다."
      ].join("\n");
    }

    if (options?.participantId === "reviewer-1") {
      return [
        "Status: BLOCK",
        "Mini Draft:",
        "방향 자체는 나쁘지 않지만 우선순위가 필요합니다.",
        "Challenge: [new] keep-open",
        "협업 사례와 서비스 임팩트 중 어느 축을 먼저 둘지 사용자가 정해야 합니다.",
        "Cross-feedback: agree",
        "현재 정보만으로는 reviewer끼리 우선순위를 확정할 수 없습니다."
      ].join("\n");
    }

    return [
      "Status: PASS",
      "Mini Draft:",
      "결제 안정화 성과는 유지해 주세요.",
      "Challenge: close",
      "제가 보기엔 나머지 쟁점은 없습니다.",
      "Cross-feedback: agree",
      "BLOCK reviewer가 요청한 사용자 우선순위 확인에는 동의합니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "왜 컬리인가?",
      draft: "초안",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
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

  assert.equal(result.artifacts.revisedDraft, "초안");
  assert.ok(gateway.calls.some((call) => /realtime-round-1-coordinator-initial-brief/.test(call.messageScope ?? "")));
  const blockSynthesisCall = gateway.calls.find(
    (call) => /realtime-round-1-coordinator-block-synthesis/.test(call.messageScope ?? "")
  );
  assert.ok(blockSynthesisCall);
  assert.match(blockSynthesisCall.prompt, /결제 안정화 경험과 협업 장면을 함께 보여주는 드래프터 초안입니다\./);
  assert.match(blockSynthesisCall.prompt, /협업 사례와 서비스 임팩트 중 어느 축을 먼저 둘지 사용자가 정해야 합니다\./);
  assert.equal(
    gateway.calls.filter((call) => call.participantId === "finalizer").length,
    0
  );
  assert.equal(result.run.status, "awaiting-user-input");
  assert.ok(events.some((event) => event.type === "awaiting-user-input" && /어느 축을 먼저 강조할지/.test(event.message ?? "")));
  assert.ok(observedStatuses.includes("awaiting-user-input"));
});

test("realtime BLOCK falls back to reviewer blocking reasons when coordinator synthesis fails", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Baemin");
  const compiler = new ContextCompiler(storage);
  const events: RunEvent[] = [];
  const gateway = new FakeGateway(healthyStates(), (_providerId, _prompt, round, options) => {
    if (/realtime-round-1-coordinator-block-synthesis/.test(options?.messageScope ?? "")) {
      return new Error("synthetic coordinator failure");
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "지원 동기 문단의 우선순위를 정리합니다.",
        targetSection: "지원 동기 문단",
        targetSectionKey: "why-baemin",
        miniDraft: "사용자 우선순위 확인 전까지는 강조 축을 확정하지 않습니다.",
        acceptedDecisions: ["배달 도메인 관심 자체는 유지한다"],
        openChallenges: [],
        deferredChallenges: []
      });
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Section Draft",
        "도메인 관심과 협업 경험을 함께 남겨 둔 드래프터 초안입니다.",
        "",
        "## Change Rationale",
        "사용자 우선순위가 정해지기 전이라 양쪽 축을 모두 남겨 두었습니다."
      ].join("\n");
    }

    if (options?.participantId === "reviewer-1") {
      return [
        "Status: BLOCK",
        "Mini Draft:",
        "협업 경험을 더 앞세울지 결정이 필요합니다.",
        "Challenge: [new] keep-open",
        "협업 사례와 운영 성과 중 어느 축을 먼저 둘지 사용자가 정해야 합니다.",
        "Cross-feedback: agree",
        "현재 정보만으로는 reviewer끼리 우선순위를 확정할 수 없습니다."
      ].join("\n");
    }

    return [
      "Status: BLOCK",
      "Mini Draft:",
      "근거는 충분하지만 강조 순서를 못 정했습니다.",
      "Challenge: [new] keep-open",
      "",
      "Cross-feedback: agree",
      "추가 근거가 없어서 reviewer끼리 우선순위를 결정할 수 없습니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run(
    {
      projectSlug: project.slug,
      question: "왜 배민인가?",
      draft: "초안",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      rounds: 1,
      selectedDocumentIds: []
    },
    async (event) => {
      events.push(event);
    },
    async () => "/done"
  );

  assert.equal(result.run.status, "awaiting-user-input");
  assert.equal(
    gateway.calls.filter((call) => call.participantId === "finalizer").length,
    0
  );
  const awaitingEvent = events.find((event) => event.type === "awaiting-user-input");
  assert.ok(awaitingEvent);
  assert.match(awaitingEvent.message ?? "", /^다음 항목에 대한 추가 정보가 필요합니다:/);
  assert.match(awaitingEvent.message ?? "", /Codex evidence reviewer: 협업 사례와 운영 성과 중 어느 축을 먼저 둘지 사용자가 정해야 합니다\./);
  assert.match(awaitingEvent.message ?? "", /Gemini fit reviewer: 추가 검토가 필요합니다\./);
  assert.match(awaitingEvent.message ?? "", /Codex voice reviewer: 추가 검토가 필요합니다\./);
});

test("realtime PASS and REVISE verdicts call the finalizer once without a coordinator convergence rerun", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Musinsa");
  const compiler = new ContextCompiler(storage);
  const gateway = new FakeGateway(healthyStates(), (_providerId, prompt, _round, options) => {
    if (options?.participantId === "finalizer" || /closing a realtime multi-model essay review session/i.test(prompt)) {
      return "최종 지원서";
    }

    if (options?.speakerRole === "coordinator") {
      return buildRealtimeLedgerResponse({
        currentFocus: "성과와 무신사 연결 문장을 한 문단으로 정리합니다.",
        targetSection: "지원 동기 문단",
        targetSectionKey: "why-musinsa",
        currentObjective: "성과와 브랜드 적합도를 한 문단에서 읽히게 합니다.",
        rewriteDirection: "성과를 먼저 두고 브랜드 연결을 뒤에 붙입니다.",
        mustResolve: ["브랜드 연결 문장을 한 단계 더 압축합니다."],
        miniDraft: "검색 품질 개선 성과 뒤에 무신사 탐색 경험 연결을 붙입니다.",
        acceptedDecisions: ["성과는 첫 문장에 둔다"],
        openChallenges: [],
        deferredChallenges: []
      });
    }

    if (options?.speakerRole === "drafter") {
      return [
        "## Section Draft",
        "검색 품질 개선 경험을 먼저 제시한 뒤, 그 경험이 무신사의 탐색 경험과 연결된다고 설명하는 드래프터 초안입니다.",
        "",
        "## Change Rationale",
        "성과 근거와 회사 연결을 한 문단으로 묶었습니다."
      ].join("\n");
    }

    if (options?.participantId === "reviewer-1") {
      return [
        "Status: REVISE",
        "Mini Draft:",
        "브랜드 연결 문장을 한 문장만 더 압축해 주세요.",
        "Challenge: close",
        "치명적인 blocker는 아니고 finalizer가 수렴할 수 있는 수준입니다.",
        "Cross-feedback: agree",
        "성과 배치는 유지해도 좋습니다."
      ].join("\n");
    }

    return [
      "Status: PASS",
      "Mini Draft:",
      "성과 수치는 유지해 주세요.",
      "Challenge: close",
      "남은 blocker는 없습니다.",
      "Cross-feedback: agree",
      "현재 구조는 finalizer로 넘겨도 됩니다."
    ].join("\n");
  });

  const orchestrator = new ReviewOrchestrator(storage, compiler, gateway);
  const result = await orchestrator.run({
    projectSlug: project.slug,
    question: "왜 무신사인가?",
    draft: "초안",
    reviewMode: "realtime",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "gemini"],
    rounds: 1,
    selectedDocumentIds: []
  });

  assert.equal(result.artifacts.revisedDraft, "최종 지원서");
  const finalizerCalls = gateway.calls.filter((call) => call.participantId === "finalizer");
  assert.equal(finalizerCalls.length, 1);
  assert.match(finalizerCalls[0]?.messageScope ?? "", /realtime-round-1-finalizer-final/);
  assert.match(finalizerCalls[0]?.prompt ?? "", /드래프터 초안입니다\./);
  assert.match(finalizerCalls[0]?.prompt ?? "", /브랜드 연결 문장을 한 문장만 더 압축해 주세요\./);
  assert.match(finalizerCalls[0]?.prompt ?? "", /성과 수치는 유지해 주세요\./);
  assert.equal(
    gateway.calls.filter((call) => /realtime-round-1-coordinator-block-synthesis/.test(call.messageScope ?? "")).length,
    0
  );
  assert.equal(
    gateway.calls.filter((call) => call.participantId === "coordinator").length,
    1
  );
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
  assert.equal(result.run.rounds, 1);
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
  const gateway = new FakeGateway(healthyStates(), (providerId, _prompt, round, options) => {
    if (/realtime-round-1-coordinator-block-synthesis/.test(options?.messageScope ?? "")) {
      return [
        "## Blocking Summary",
        "근거 보강 방향을 정하려면 사용자 우선순위가 필요합니다.",
        "",
        "## User Question",
        "서비스 친숙함 대신 어떤 직접 경험을 앞세울지 한 문장으로 지정해 주세요."
      ].join("\n");
    }

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

  assert.equal(result.run.status, "awaiting-user-input");
  assert.equal(result.run.rounds, 1);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "summary.md"), undefined);
  assert.equal(await storage.readOptionalRunArtifact(project.slug, result.run.id, "improvement-plan.md"), undefined);
  assert.match(
    await storage.readOptionalRunArtifact(project.slug, result.run.id, "revised-draft.md") ?? "",
    /서비스 친숙함만 말하지 말고, 직접 만든 개선 경험과 연결합니다\./
  );
  const ledgerArtifact = await storage.readOptionalRunArtifact(project.slug, result.run.id, "discussion-ledger.md");
  assert.ok(ledgerArtifact);
  assert.match(ledgerArtifact, /## Open Challenges/);
  assert.ok(events.some((event) => event.type === "awaiting-user-input" && /어떤 직접 경험을 앞세울지/.test(event.message ?? "")));
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
