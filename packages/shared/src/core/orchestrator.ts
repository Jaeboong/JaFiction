import { ContextCompiler } from "./contextCompiler";
import { applyChatEvent, providerLabel } from "./orchestrator/chatEvents";
import { appendContinuationContext } from "./orchestrator/continuation";
import {
  forceSectionClosureOutcome,
  hasAllApprovingRealtimeReviewers,
  isCurrentSectionReady,
  isWholeDocumentReady,
  normalizeMaxRoundsPerSection,
  RealtimeReviewerVerdictSummary,
  shouldRunWeakConsensusPolish,
  summarizeRealtimeReviewerVerdicts,
  validateSectionOutcome
} from "./orchestrator/discussion/convergenceEvaluator";
import {
  buildDiscussionLedgerArtifact,
  dedupeStrings,
  forceAcceptCurrentSection,
  getLedgerTargetSectionKey,
  getLedgerTickets,
  hasForceCloseDirective,
  InterventionCoordinatorDecision,
  InterventionPartialSnapshot,
  normalizeRealtimeInterventionMessages,
  pickNextTargetSectionCluster,
  transitionDiscussionLedgerAfterDeferredClose,
  transitionDiscussionLedgerToNextCluster
} from "./orchestrator/discussion/discussionLedger";
import {
  NotionRequestDescriptor,
  compressNotionBrief,
  buildAutoNotionRequest,
  deriveImplicitNotionRequest,
  normalizeNotionRequest,
  resolveNotionRequestDescriptor
} from "./orchestrator/notionRequest";
import {
  collectRealtimeReviewerStatuses,
  CoordinatorDecisionOutput,
  extractCoordinatorEscalationQuestion,
  extractDiscussionLedger,
  extractInterventionCoordinatorDecision,
  extractNotionBrief,
  extractSectionDraft,
  FinalizerOutput,
  SectionCoordinationBrief,
  SectionDraftOutput,
  splitCoordinatorDecisionOutput,
  splitCoordinatorSections,
  splitFinalizerOutput,
  splitSectionCoordinationBrief,
  splitSectionDraftOutput
} from "./orchestrator/parsing/responseParsers";
import {
  buildCoordinatorParticipant,
  buildDrafterParticipant,
  buildFinalizerParticipant,
  buildResearchParticipant,
  buildReviewerParticipants,
  ReviewParticipant,
  turnLabel
} from "./orchestrator/participants";
import {
  buildDeepCoordinatorDecisionPrompt,
  buildDeepFinalizerPrompt,
  buildDeepReviewerPrompt,
  buildDeepSectionCoordinatorPrompt,
  buildSectionDrafterPrompt
} from "./orchestrator/prompts/deepFeedbackPrompts";
import {
  BuiltPrompt,
  escapeRegExp,
  finalizePromptMetrics
} from "./orchestrator/prompts/promptBlocks";
import {
  buildDevilsAdvocatePrompt,
  buildInterventionCoordinatorPrompt,
  buildNotionPrePassPrompt,
  buildRealtimeCoordinatorDiscussionPrompt,
  buildRealtimeCoordinatorRedirectPrompt,
  buildRealtimeFinalDraftPrompt,
  buildRealtimeReviewerPrompt,
  buildRealtimeSectionDrafterPrompt,
  buildWeakConsensusPolishPrompt
} from "./orchestrator/prompts/realtimePrompts";
import { resolveRoleAssignments } from "./roleAssignments";
import { logDrafterDebug } from "./debugLogger";
import { RunContinuationContext } from "./storage";
import { RunStore } from "./storageInterfaces";
import {
  CompileContextProfile,
  DiscussionLedger,
  isAbortError,
  isRunAbortedError,
  isRunInterventionAbortError,
  ProviderId,
  PromptMetrics,
  RunChatMessage,
  ProviderRuntimeState,
  ReviewMode,
  ReviewerPerspective,
  RoleAssignment,
  ReviewTurn,
  RunArtifacts,
  RunAbortedError,
  RunEvent,
  RunInterventionAbortError,
  RunRequest,
  RunRecord,
} from "./types";
import { createId, nowIso } from "./utils";

export interface OrchestratorGateway {
  listRuntimeStates(): Promise<ProviderRuntimeState[]>;
  execute(
    providerId: ProviderId,
    prompt: string,
    options: {
      cwd: string;
      authMode: ProviderRuntimeState["authMode"];
      apiKey?: string;
      round?: number;
      speakerRole?: ReviewTurn["role"];
      messageScope?: string;
      participantId?: string;
      participantLabel?: string;
      modelOverride?: string;
      effortOverride?: string;
      onEvent?: (event: RunEvent) => Promise<void> | void;
      abortSignal?: AbortSignal;
    }
  ): Promise<{ text: string; stdout: string; stderr: string; exitCode: number }>;
  getApiKey(providerId: ProviderId): Promise<string | undefined>;
}

export interface UserInterventionRequest {
  projectSlug: string;
  runId: string;
  round: number;
  reviewMode: ReviewMode;
  coordinatorProvider: ProviderId;
}

function sanitizeStoredDrafterTurn(turn: ReviewTurn, parsedDraft?: SectionDraftOutput): ReviewTurn {
  if (turn.role !== "drafter" || turn.status !== "completed") {
    return turn;
  }

  const sanitizedResponse = parsedDraft?.sectionDraft?.trim();
  if (!sanitizedResponse) {
    return turn;
  }

  return {
    ...turn,
    response: sanitizedResponse
  };
}

function sanitizeStoredDrafterChatMessage(message: RunChatMessage): RunChatMessage {
  if (message.speakerRole !== "drafter" || message.status !== "completed") {
    return message;
  }

  const sanitizedContent = extractSectionDraft(message.content)?.sectionDraft?.trim();
  logDrafterDebug("chat_message.sanitize", {
    inputContent: message.content?.slice(0, 2000),
    outputContent: sanitizedContent?.slice(0, 2000)
  });
  if (!sanitizedContent) {
    return {
      ...message,
      content: ""
    };
  }

  return {
    ...message,
    content: sanitizedContent
  };
}

interface SectionBrief {
  currentSection: string;
  currentObjective: string;
  mustKeep: string[];
  mustResolve: string[];
  availableEvidence: string[];
  exitCriteria: string[];
  nextOwner: string;
}

interface SectionDraftResult {
  sectionDraft: string;
  changeRationale: string;
}

export class ReviewOrchestrator {
  constructor(
    private readonly storage: RunStore,
    private readonly compiler: ContextCompiler,
    private readonly gateway: OrchestratorGateway
  ) {}

  async run(
    request: RunRequest,
    onEvent?: (event: RunEvent) => Promise<void> | void,
    requestUserIntervention?: (request: UserInterventionRequest) => Promise<string | undefined>,
    consumeQueuedMessages?: () => string[],
    abortSignal?: AbortSignal,
    bindExecutionAbortController?: (controller?: AbortController) => void
  ): Promise<{ run: RunRecord; turns: ReviewTurn[]; artifacts: RunArtifacts }> {
    const states = await this.gateway.listRuntimeStates();
    const stateMap = new Map(states.map((state) => [state.providerId, state]));
    const maxRoundsPerSection = normalizeMaxRoundsPerSection(request.maxRoundsPerSection);
    const resolvedRoles = resolveRoleAssignments(request.roleAssignments, request.coordinatorProvider, request.reviewerProviders);
    const researcher = buildResearchParticipant(resolvedRoles.byRole.context_researcher);
    const coordinator = buildCoordinatorParticipant(resolvedRoles.byRole.section_coordinator);
    const drafter = buildDrafterParticipant(resolvedRoles.byRole.section_drafter);
    const finalizer = buildFinalizerParticipant(resolvedRoles.byRole.finalizer);
    const requestedReviewers = buildReviewerParticipants(resolvedRoles.byRole);
    if (requestedReviewers.length < 1) {
      throw new Error("At least one reviewer is required to run a review.");
    }

    const selectedProviders = [...new Set(resolvedRoles.all.map((assignment) => assignment.providerId))];
    const unavailableProviders = [...new Set(selectedProviders.filter((providerId) => stateMap.get(providerId)?.authStatus !== "healthy"))];
    if (unavailableProviders.length > 0) {
      throw new Error(`Selected providers are not healthy: ${unavailableProviders.join(", ")}`);
    }

    const project = await this.storage.getProject(request.projectSlug);
    const profileDocuments = await this.storage.listProfileDocuments();
    const projectDocuments = await this.storage.listProjectDocuments(request.projectSlug);
    const initialCompiled = await this.compiler.compile({
      project,
      profileDocuments,
      projectDocuments,
      selectedDocumentIds: request.selectedDocumentIds,
      question: request.question,
      draft: request.draft,
      charLimit: request.charLimit ?? project.charLimit,
      profile: "full"
    });
    const trimmedContinuationNote = request.continuationNote?.trim() || undefined;
    const notionRequestDescriptor = resolveNotionRequestDescriptor(
      request.notionRequest,
      trimmedContinuationNote,
      project.notionPageIds
    );
    const effectiveNotionRequest = notionRequestDescriptor?.text;
    const continuationContext = request.continuationFromRunId
      ? await this.storage.loadRunContinuationContext(request.projectSlug, request.continuationFromRunId)
      : undefined;
    const initialContextMarkdown = appendContinuationContext(
      initialCompiled.markdown,
      continuationContext,
      trimmedContinuationNote
    );

    const runId = createId();
    let run: RunRecord = {
      id: runId,
      projectSlug: request.projectSlug,
      projectQuestionIndex: request.projectQuestionIndex,
      question: request.question,
      draft: request.draft,
      reviewMode: request.reviewMode,
      notionRequest: effectiveNotionRequest,
      roleAssignments: resolvedRoles.all,
      coordinatorProvider: coordinator.providerId,
      reviewerProviders: requestedReviewers.map((reviewer) => reviewer.providerId),
      continuationFromRunId: request.continuationFromRunId?.trim() || undefined,
      continuationNote: trimmedContinuationNote,
      rounds: 0,
      maxRoundsPerSection,
      selectedDocumentIds: request.selectedDocumentIds,
      status: "running",
      startedAt: nowIso()
    };

    await this.storage.createRun(run);
    await this.storage.setLastCoordinatorProvider(coordinator.providerId);
    await this.storage.setLastReviewMode(request.reviewMode);
    await this.storage.saveRunTextArtifact(request.projectSlug, runId, "compiled-context.md", initialContextMarkdown);
    const chatMessages = new Map<string, RunChatMessage>();
    const drafterEventBuffer = new Map<string, RunEvent[]>();
    const sanitizeCompletedChatMessage = (messageId: string): boolean => {
      const storedMessage = chatMessages.get(messageId);
      if (storedMessage?.speakerRole === "drafter") {
        logDrafterDebug("chat_message.before_sanitize", {
          messageId,
          speakerRole: storedMessage.speakerRole,
          contentPreview: storedMessage.content?.slice(0, 2000)
        });
      }
      if (!storedMessage) {
        return false;
      }

      const sanitized = sanitizeStoredDrafterChatMessage(storedMessage);
      chatMessages.set(messageId, sanitized);
      return sanitized.speakerRole === "drafter" && sanitized.content === "";
    };
    const eventSink = async (event: RunEvent) => {
      applyChatEvent(chatMessages, event);
      if (event.messageId) {
        const storedMessage = chatMessages.get(event.messageId);
        const isDrafterMessage = storedMessage?.speakerRole === "drafter" || event.speakerRole === "drafter";

        if (event.type === "chat-message-started" && isDrafterMessage) {
          drafterEventBuffer.set(event.messageId, [event]);
          await this.storage.appendRunEvent(request.projectSlug, runId, event);
          return;
        }

        if (event.type === "chat-message-delta" && drafterEventBuffer.has(event.messageId)) {
          drafterEventBuffer.get(event.messageId)?.push(event);
          await this.storage.appendRunEvent(request.projectSlug, runId, event);
          return;
        }

        if (event.type === "chat-message-completed" && drafterEventBuffer.has(event.messageId)) {
          const suppressEvent = sanitizeCompletedChatMessage(event.messageId);
          const bufferedEvents = drafterEventBuffer.get(event.messageId) ?? [];
          await this.storage.appendRunEvent(request.projectSlug, runId, event);
          if (onEvent && !suppressEvent) {
            for (const bufferedEvent of bufferedEvents) {
              await onEvent(bufferedEvent);
            }
            await onEvent(event);
          }
          drafterEventBuffer.delete(event.messageId);
          return;
        }
      }

      let suppressEvent = false;
      if (event.type === "chat-message-completed" && event.messageId) {
        suppressEvent = sanitizeCompletedChatMessage(event.messageId);
      }
      await this.storage.appendRunEvent(request.projectSlug, runId, event);
      if (onEvent && !suppressEvent) {
        await onEvent(event);
      }
    };
    await eventSink({ timestamp: nowIso(), type: "run-started", message: "Run started" });
    await eventSink({ timestamp: nowIso(), type: "compiled-context", message: "Compiled context saved" });

    const turns: ReviewTurn[] = [];
    const activeReviewers = requestedReviewers.filter((reviewer) => stateMap.get(reviewer.providerId)?.authStatus === "healthy");
    const compiledContextCache = new Map<string, string>();
    let notionBriefFull = "";
    const userInterventions: Array<{ round: number; text: string }> = [];
    let discussionLedger: DiscussionLedger | undefined;
    const polishRoundsUsed = new Set<string>();
    const throwIfAborted = () => {
      if (abortSignal?.aborted) {
        throw new RunAbortedError();
      }
    };

    try {
      throwIfAborted();
      const coordinatorState = stateMap.get(coordinator.providerId);
      if (!coordinatorState) {
        throw new Error("Coordinator provider is unavailable.");
      }
      const researcherState = stateMap.get(researcher.providerId);
      const drafterState = stateMap.get(drafter.providerId);
      const finalizerState = stateMap.get(finalizer.providerId);

      if (effectiveNotionRequest) {
        const notionCompiled = await this.compiler.compile({
          project,
          profileDocuments,
          projectDocuments,
          selectedDocumentIds: request.selectedDocumentIds,
          question: request.question,
          draft: request.draft,
          charLimit: request.charLimit ?? project.charLimit,
          profile: "minimal"
        });
        const notionContextMarkdown = appendContinuationContext(
          notionCompiled.markdown,
          continuationContext,
          trimmedContinuationNote
        );
        const notionPrompt = buildNotionPrePassPrompt(notionContextMarkdown, notionRequestDescriptor);
        const notionTurn = await this.executeTurn(
          request.projectSlug,
          runId,
          researcher,
          0,
          notionPrompt,
          researcherState ?? coordinatorState,
          eventSink,
          undefined,
          abortSignal,
          bindExecutionAbortController
        );
        turns.push(notionTurn);

        if (notionTurn.status !== "completed") {
          throw new Error(notionTurn.error ?? "Coordinator failed to resolve the Notion request.");
        }

        notionBriefFull = extractNotionBrief(notionTurn.response);
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "notion-brief.md", notionTurn.response);
        run = await this.storage.updateRun(request.projectSlug, runId, {
          notionBrief: compressNotionBrief(notionBriefFull, "compact")
        });
      }

      const interactiveMode = Boolean(requestUserIntervention);
      const autoCycleLimit = Math.max(1, request.rounds || 1);
      const savePromptMetricsArtifact = async () => {
        const promptMetrics = turns
          .map((turn) => turn.promptMetrics)
          .filter((metrics): metrics is PromptMetrics => Boolean(metrics));
        if (promptMetrics.length === 0) {
          return;
        }

        await this.storage.saveRunTextArtifact(
          request.projectSlug,
          runId,
          "prompt-metrics.json",
          JSON.stringify(promptMetrics, null, 2)
        );
      };
      const persistTurnsAndChat = async () => {
        await this.storage.saveReviewTurns(request.projectSlug, runId, turns);
        await savePromptMetricsArtifact();
        const persistedChatMessages = [...chatMessages.values()].filter((message) => message.status === "completed");
        if (persistedChatMessages.length > 0) {
          await this.storage.saveRunChatMessages(request.projectSlug, runId, persistedChatMessages);
        }
      };
      const saveDeepArtifacts = async (artifacts: RunArtifacts) => {
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "summary.md", artifacts.summary);
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "improvement-plan.md", artifacts.improvementPlan);
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "revised-draft.md", artifacts.revisedDraft);
        if (artifacts.finalChecks?.trim()) {
          await this.storage.saveRunTextArtifact(request.projectSlug, runId, "final-checks.md", artifacts.finalChecks);
        }
      };
      const saveRealtimeDraftCheckpoint = async (draft: string) => {
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "revised-draft.md", draft);
      };
      const saveInterventionPartialSnapshot = async (snapshot: InterventionPartialSnapshot) => {
        await this.storage.saveRunTextArtifact(
          request.projectSlug,
          runId,
          "intervention-partial-snapshot.json",
          JSON.stringify(snapshot, null, 2)
        );
      };
      const buildCompiledContextMarkdown = async (
        draft: string,
        round: number,
        unitLabel: "cycle" | "round",
        profile: CompileContextProfile,
        options: { saveArtifact?: boolean } = {}
      ) => {
        const cacheKey = `${profile}::${draft}`;
        let compiledContextMarkdown = compiledContextCache.get(cacheKey);
        if (!compiledContextMarkdown) {
          const compiled = await this.compiler.compile({
            project,
            profileDocuments,
            projectDocuments,
            selectedDocumentIds: request.selectedDocumentIds,
            question: request.question,
            draft,
            charLimit: request.charLimit ?? project.charLimit,
            profile
          });
          compiledContextMarkdown = appendContinuationContext(
            compiled.markdown,
            continuationContext,
            trimmedContinuationNote
          );
          compiledContextCache.set(cacheKey, compiledContextMarkdown);
        }

        if (options.saveArtifact ?? profile !== "minimal") {
          await this.storage.saveRunTextArtifact(request.projectSlug, runId, "compiled-context.md", compiledContextMarkdown);
          if (round > 1) {
            await eventSink({
              timestamp: nowIso(),
              type: "compiled-context",
              round,
              message: `Compiled context refreshed for ${unitLabel} ${round} (${profile})`
            });
          }
        }

        return compiledContextMarkdown;
      };
      const emitUserIntervention = async (round: number, intervention: string) => {
        userInterventions.push({ round, text: intervention });
        const messageId = `user-round-${round}-${createId()}`;
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-started",
          round: round + 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: ""
        });
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-delta",
          round: round + 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: intervention
        });
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-completed",
          round: round + 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: ""
        });
      };
      const emitContinuationMessage = async (message: string) => {
        const trimmed = message.trim();
        if (!trimmed) {
          return;
        }

        const messageId = `user-continuation-${createId()}`;
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-started",
          round: 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: ""
        });
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-delta",
          round: 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: trimmed
        });
        await eventSink({
          timestamp: nowIso(),
          type: "chat-message-completed",
          round: 1,
          messageId,
          speakerRole: "user",
          recipient: "Coordinator",
          message: ""
        });
      };
      const consumeCurrentUserMessages = () =>
        (consumeQueuedMessages?.() ?? [])
          .map((message) => message.trim())
          .filter(Boolean);
      const emitUserMessages = async (round: number, messages: string[]) => {
        for (const message of messages) {
          await emitUserIntervention(round, message);
        }
      };
      const updateDiscussionLedger = async (sourceTurn: ReviewTurn, nextLedger?: DiscussionLedger) => {
        if (!nextLedger) {
          return;
        }

        discussionLedger = nextLedger;
        await eventSink({
          timestamp: nowIso(),
          type: "discussion-ledger-updated",
          providerId: sourceTurn.providerId,
          participantId: sourceTurn.participantId,
          participantLabel: sourceTurn.participantLabel,
          round: nextLedger.updatedAtRound,
          speakerRole: sourceTurn.role,
          message: nextLedger.currentFocus,
          discussionLedger: nextLedger
        });
      };
      const saveDiscussionLedgerArtifact = async () => {
        if (!discussionLedger) {
          return;
        }

        try {
          await this.storage.saveRunTextArtifact(
            request.projectSlug,
            runId,
            "discussion-ledger.md",
            buildDiscussionLedgerArtifact(discussionLedger)
          );
        } catch {
          // Keep ledger persistence best-effort so a save failure does not fail the run.
        }
      };
      const getNotionBriefForProfile = (profile: CompileContextProfile) =>
        notionBriefFull ? compressNotionBrief(notionBriefFull, profile) : "";

      if (trimmedContinuationNote) {
        userInterventions.push({ round: 0, text: trimmedContinuationNote });
        await emitContinuationMessage(trimmedContinuationNote);
      }

      let artifacts: RunArtifacts = {
        summary: "No summary was generated.",
        improvementPlan: "No improvement plan was generated.",
        revisedDraft: request.draft
      };
      let finalizedRealtimeDraft = false;
      let completedRounds = 0;

      if (request.reviewMode === "deepFeedback") {
        let currentDraft = request.draft;
        let cycle = 1;
        let latestArtifacts: RunArtifacts | undefined;

        while (true) {
          throwIfAborted();
          const compiledContextMarkdown = await buildCompiledContextMarkdown(currentDraft, cycle, "cycle", "full");
          const completedReviewerTurns = turns.filter((turn) => turn.status === "completed" && turn.role === "reviewer");
          const coordinatorPrompt = buildDeepSectionCoordinatorPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("full"),
            userInterventions,
            latestArtifacts,
            turns.filter((turn) => turn.status === "completed")
          );
          const coordinatorBriefTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            coordinator,
            cycle,
            coordinatorPrompt,
            coordinatorState,
            eventSink,
            `deep-cycle-${cycle}-coordinator-brief`,
            abortSignal,
            bindExecutionAbortController
          );
          turns.push(coordinatorBriefTurn);

          if (coordinatorBriefTurn.status !== "completed") {
            throw new Error(coordinatorBriefTurn.error ?? "Coordinator failed to prepare the section brief.");
          }

          const sectionBrief = splitSectionCoordinationBrief(coordinatorBriefTurn.response);
          const drafterPrompt = buildSectionDrafterPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("full"),
            userInterventions,
            sectionBrief,
            latestArtifacts
          );
          logDrafterDebug("drafter.prompt", {
            promptKind: "deep-cycle",
            round: cycle,
            promptText: drafterPrompt.text ?? JSON.stringify(drafterPrompt)
          });
          const drafterTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            drafter,
            cycle,
            drafterPrompt,
            drafterState ?? coordinatorState,
            eventSink,
            `deep-cycle-${cycle}-drafter`,
            abortSignal,
            bindExecutionAbortController
          );
          logDrafterDebug("drafter.raw_response", {
            round: cycle,
            status: drafterTurn.status,
            responseLength: drafterTurn.response?.length,
            responsePreview: drafterTurn.response?.slice(0, 2000)
          });
          const parsedDraftOutput = drafterTurn.status === "completed"
            ? splitSectionDraftOutput(drafterTurn.response, currentDraft)
            : undefined;
          logDrafterDebug("drafter.parsed", {
            round: cycle,
            sectionDraft: parsedDraftOutput?.sectionDraft?.slice(0, 2000),
            changeRationale: parsedDraftOutput?.changeRationale?.slice(0, 500)
          });
          turns.push(sanitizeStoredDrafterTurn(drafterTurn, parsedDraftOutput));
          if (drafterTurn.status !== "completed") {
            throw new Error(drafterTurn.error ?? "Section drafter failed to write the section draft.");
          }
          const draftOutput = parsedDraftOutput ?? {
            sectionDraft: currentDraft,
            changeRationale: ""
          };
          const currentCycleReviewerTurns: ReviewTurn[] = [];

          for (const reviewer of [...activeReviewers]) {
            const state = stateMap.get(reviewer.providerId);
            if (!state) {
              continue;
            }

            const prompt = buildDeepReviewerPrompt(
              compiledContextMarkdown,
              getNotionBriefForProfile("full"),
              completedReviewerTurns,
              cycle,
              reviewer.participantId,
              latestArtifacts,
              userInterventions,
              reviewer.perspective,
              sectionBrief,
              draftOutput
            );
            const turn = await this.executeTurn(
              request.projectSlug,
              runId,
              reviewer,
              cycle,
              prompt,
              state,
              eventSink,
              `deep-cycle-${cycle}-reviewer`,
              abortSignal,
              bindExecutionAbortController
            );

            turns.push(turn);
            if (turn.status === "completed") {
              currentCycleReviewerTurns.push(turn);
            }
            if (turn.status === "failed") {
              const index = activeReviewers.findIndex((participant) => participant.participantId === reviewer.participantId);
              if (index >= 0) {
                activeReviewers.splice(index, 1);
              }
              if (activeReviewers.length < 1) {
                throw new Error("The run cannot continue because every reviewer failed.");
              }
            }
          }

          const coordinatorDecisionPrompt = buildDeepCoordinatorDecisionPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("full"),
            userInterventions,
            currentCycleReviewerTurns,
            latestArtifacts,
            sectionBrief,
            draftOutput
          );
          const coordinatorDecisionTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            coordinator,
            cycle,
            coordinatorDecisionPrompt,
            coordinatorState,
            eventSink,
            `deep-cycle-${cycle}-coordinator-decision`,
            abortSignal,
            bindExecutionAbortController
          );
          turns.push(coordinatorDecisionTurn);

          if (coordinatorDecisionTurn.status !== "completed") {
            throw new Error(coordinatorDecisionTurn.error ?? "Coordinator failed to decide the next owner.");
          }

          const coordinatorDecision = splitCoordinatorDecisionOutput(coordinatorDecisionTurn.response);
          const finalizerPrompt = buildDeepFinalizerPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("full"),
            userInterventions,
            latestArtifacts,
            sectionBrief,
            draftOutput,
            currentCycleReviewerTurns,
            coordinatorDecision
          );
          const finalizerTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            finalizer,
            cycle,
            finalizerPrompt,
            finalizerState ?? coordinatorState,
            eventSink,
            `deep-cycle-${cycle}-finalizer`,
            abortSignal,
            bindExecutionAbortController
          );
          turns.push(finalizerTurn);

          if (finalizerTurn.status !== "completed") {
            throw new Error(finalizerTurn.error ?? "Finalizer failed to update the session.");
          }

          const finalizerOutput = splitFinalizerOutput(finalizerTurn.response, currentDraft);
          latestArtifacts = {
            summary: coordinatorDecision.summary,
            improvementPlan: coordinatorDecision.improvementPlan,
            revisedDraft: finalizerOutput.finalDraft,
            finalChecks: finalizerOutput.finalChecks
          };
          currentDraft = latestArtifacts.revisedDraft;
          await persistTurnsAndChat();
          await saveDeepArtifacts(latestArtifacts);

          completedRounds = cycle;
          run = await this.storage.updateRun(request.projectSlug, runId, {
            rounds: cycle
          });

          if (!interactiveMode) {
            if (cycle >= autoCycleLimit) {
              break;
            }
            cycle += 1;
            continue;
          }

          await eventSink({
            timestamp: nowIso(),
            type: "awaiting-user-input",
            round: cycle,
            message: `Cycle ${cycle} complete. Press Enter to continue or add a note for the next cycle. Use the Essay tab's 완료 button to mark the current question done; /done is still available if you need to stop this discussion.`
          });

          const intervention = (await requestUserIntervention?.({
              projectSlug: request.projectSlug,
              runId,
              round: cycle,
              reviewMode: request.reviewMode,
              coordinatorProvider: coordinator.providerId
            }))?.trim();

          if (intervention?.toLowerCase() === "/abort") {
            throw new RunAbortedError();
          }

          if (intervention?.toLowerCase() === "/done" || intervention?.toLowerCase() === "/stop") {
            await eventSink({
              timestamp: nowIso(),
              type: "user-input-received",
              round: cycle,
              message: "Session marked complete."
            });
            break;
          }

          if (intervention) {
            await emitUserIntervention(cycle, intervention);
          }

          await eventSink({
            timestamp: nowIso(),
            type: "user-input-received",
            round: cycle,
            message: intervention ? "Next cycle guidance saved." : "Continuing to the next cycle."
          });
          cycle += 1;
        }

        artifacts = latestArtifacts ?? {
          summary: "No summary was generated.",
          improvementPlan: "No improvement plan was generated.",
          revisedDraft: currentDraft
        };
      } else {
        let currentDraft = request.draft;
        let round = 1;
        let currentSectionStartedAtRound = 1;
        let seededCoordinatorTurn: ReviewTurn | undefined;
        let pendingReviewerVerdictSummary: RealtimeReviewerVerdictSummary | undefined;
        let pendingConvergenceNoticeRounds: number | undefined;
        let consecutiveReviseRoundsForSection = 0;

        const runRealtimeRedirectCoordinatorTurn = async (
          nextRound: number,
          compiledContextMarkdown: string,
          messages: string[]
        ): Promise<ReviewTurn> => {
          const redirectPrompt = buildRealtimeCoordinatorRedirectPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("compact"),
            userInterventions,
            turns.filter((turn) => turn.status === "completed"),
            nextRound,
            messages,
            discussionLedger,
            {
              reviewerVerdictSummary: pendingReviewerVerdictSummary,
              convergenceNoticeRounds: pendingConvergenceNoticeRounds
            }
          );
          const redirectTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            coordinator,
            nextRound,
            redirectPrompt,
            coordinatorState,
            eventSink,
            `realtime-round-${nextRound}-coordinator-redirect`,
            abortSignal,
            bindExecutionAbortController
          );
          turns.push(redirectTurn);
          if (redirectTurn.status !== "completed") {
            throw new Error(redirectTurn.error ?? "Coordinator failed to redirect the discussion.");
          }
          await updateDiscussionLedger(redirectTurn, extractDiscussionLedger(redirectTurn.response, nextRound));
          return redirectTurn;
        };

        const handleRealtimeAwaitingUserInput = async (
          awaitingRound: number,
          message: string,
          options?: { markAwaitingStatus?: boolean }
        ): Promise<"continue" | "done"> => {
          await saveRealtimeDraftCheckpoint(
            discussionLedger?.sectionDraft?.trim()
            || discussionLedger?.miniDraft?.trim()
            || currentDraft
          );
          if (options?.markAwaitingStatus) {
            run = await this.storage.updateRun(request.projectSlug, runId, {
              status: "awaiting-user-input",
              rounds: awaitingRound
            });
          }
          await eventSink({
            timestamp: nowIso(),
            type: "awaiting-user-input",
            round: awaitingRound,
            message
          });

          if (!requestUserIntervention) {
            throw new Error("Realtime discussion is awaiting user input but no user callback is available.");
          }

          const intervention = (await requestUserIntervention({
            projectSlug: request.projectSlug,
            runId,
            round: awaitingRound,
            reviewMode: request.reviewMode,
            coordinatorProvider: coordinator.providerId
          }))?.trim();

          if (intervention?.toLowerCase() === "/abort") {
            throw new RunAbortedError();
          }

          if (intervention?.toLowerCase() === "/done" || intervention?.toLowerCase() === "/stop") {
            await eventSink({
              timestamp: nowIso(),
              type: "user-input-received",
              round: awaitingRound,
              message: "Realtime session marked complete without a final draft."
            });
            return "done";
          }

          if (intervention) {
            await emitUserIntervention(awaitingRound, intervention);
          }

          await eventSink({
            timestamp: nowIso(),
            type: "user-input-received",
            round: awaitingRound,
            message: intervention ? "Realtime guidance saved." : "Continuing realtime discussion."
          });
          if (options?.markAwaitingStatus) {
            run = await this.storage.updateRun(request.projectSlug, runId, {
              status: "running"
            });
          }
          return "continue";
        };

        const buildRealtimeInterventionSnapshot = (messages: string[]): InterventionPartialSnapshot => ({
          round,
          currentDraft,
          directiveMessages: messages,
          completedTurns: turns.filter((turn) => turn.status === "completed"),
          completedChatMessages: [...chatMessages.values()].filter((message) => message.status === "completed"),
          currentSection: discussionLedger
            ? {
                targetSection: discussionLedger.targetSection,
                targetSectionKey: getLedgerTargetSectionKey(discussionLedger),
                currentFocus: discussionLedger.currentFocus,
                currentObjective: discussionLedger.currentObjective,
                rewriteDirection: discussionLedger.rewriteDirection,
                sectionOutcome: discussionLedger.sectionOutcome,
                openChallenges: [...discussionLedger.openChallenges],
                deferredChallenges: [...discussionLedger.deferredChallenges],
                mustResolve: [...(discussionLedger.mustResolve ?? [])]
              }
            : undefined
        });

        const runInterventionCoordinatorTurn = async (
          nextRound: number,
          messages: string[],
          snapshot: InterventionPartialSnapshot
        ): Promise<{ turn: ReviewTurn; decision: InterventionCoordinatorDecision }> => {
          const compiledContextMarkdown = await buildCompiledContextMarkdown(currentDraft, nextRound, "round", "compact");
          const interventionPrompt = buildInterventionCoordinatorPrompt(
            compiledContextMarkdown,
            getNotionBriefForProfile("compact"),
            userInterventions,
            turns.filter((turn) => turn.status === "completed"),
            nextRound,
            messages,
            snapshot,
            discussionLedger
          );
          const interventionTurn = await this.executeTurn(
            request.projectSlug,
            runId,
            coordinator,
            nextRound,
            interventionPrompt,
            coordinatorState,
            eventSink,
            `realtime-round-${nextRound}-coordinator-intervention`,
            abortSignal,
            bindExecutionAbortController
          );
          turns.push(interventionTurn);
          if (interventionTurn.status !== "completed") {
            throw new Error(interventionTurn.error ?? "Coordinator failed to handle the realtime intervention.");
          }

          return {
            turn: interventionTurn,
            decision: extractInterventionCoordinatorDecision(interventionTurn.response, nextRound)
          };
        };

        const handleImmediateRealtimeIntervention = async (error: RunInterventionAbortError): Promise<"continue" | "done"> => {
          let messages = normalizeRealtimeInterventionMessages(consumeCurrentUserMessages(), error.directive);
          if (messages.length === 0) {
            throw new RunAbortedError();
          }

          await emitUserMessages(round, messages);
          await eventSink({
            timestamp: nowIso(),
            type: "user-input-received",
            round,
            message: "Immediate realtime intervention received."
          });

          let snapshot = buildRealtimeInterventionSnapshot(messages);
          await saveInterventionPartialSnapshot(snapshot);
          await persistTurnsAndChat();

          if (hasForceCloseDirective(messages)) {
            if (discussionLedger) {
              discussionLedger = forceAcceptCurrentSection(discussionLedger, round + 1);
              await eventSink({
                timestamp: nowIso(),
                type: "discussion-ledger-updated",
                round: round + 1,
                speakerRole: "system",
                message: discussionLedger.sectionOutcome === "handoff-next-section"
                  ? `Forced current section closed and handed off to ${discussionLedger.targetSection}.`
                  : "Forced current section closed by user directive.",
                discussionLedger
              });
            }
            round += 1;
            currentSectionStartedAtRound = round;
            consecutiveReviseRoundsForSection = 0;
            pendingReviewerVerdictSummary = undefined;
            pendingConvergenceNoticeRounds = undefined;
            seededCoordinatorTurn = undefined;
            return "continue";
          }

          let pendingMessages = [...messages];
          while (true) {
            const nextRound = round + 1;
            const { turn, decision } = await runInterventionCoordinatorTurn(nextRound, pendingMessages, snapshot);
            await persistTurnsAndChat();
            if (decision.decision === "clarify") {
              const clarifyingQuestion = decision.clarifyingQuestion?.trim() || "추가 지시를 한 문장으로 알려 주세요.";
              await eventSink({
                timestamp: nowIso(),
                type: "awaiting-user-input",
                round,
                message: clarifyingQuestion
              });
              if (!requestUserIntervention) {
                throw new Error("Realtime intervention requested clarification without a user callback.");
              }
              const followUp = (await requestUserIntervention({
                projectSlug: request.projectSlug,
                runId,
                round,
                reviewMode: request.reviewMode,
                coordinatorProvider: coordinator.providerId
              }))?.trim();

              if (followUp?.toLowerCase() === "/abort") {
                throw new RunAbortedError();
              }

              if (followUp?.toLowerCase() === "/done" || followUp?.toLowerCase() === "/stop") {
                await eventSink({
                  timestamp: nowIso(),
                  type: "user-input-received",
                  round,
                  message: "Realtime session marked complete without a final draft."
                });
                return "done";
              }

              if (!followUp) {
                continue;
              }

              await emitUserIntervention(round, followUp);
              await eventSink({
                timestamp: nowIso(),
                type: "user-input-received",
                round,
                message: "Realtime clarification received."
              });
              pendingMessages = [...pendingMessages, followUp];
              snapshot = buildRealtimeInterventionSnapshot(pendingMessages);
              await saveInterventionPartialSnapshot(snapshot);
              continue;
            }

            if (decision.decision === "accept") {
              if (discussionLedger) {
                discussionLedger = forceAcceptCurrentSection(discussionLedger, nextRound);
                await eventSink({
                  timestamp: nowIso(),
                  type: "discussion-ledger-updated",
                  round: nextRound,
                  speakerRole: "system",
                  message: decision.reason || "Current section accepted by intervention coordinator.",
                  discussionLedger
                });
              }
              await eventSink({
                timestamp: nowIso(),
                type: "user-input-received",
                round,
                message: "Realtime intervention accepted the current section."
              });
              round = nextRound;
              currentSectionStartedAtRound = round;
              consecutiveReviseRoundsForSection = 0;
              pendingReviewerVerdictSummary = undefined;
              pendingConvergenceNoticeRounds = undefined;
              seededCoordinatorTurn = undefined;
              return "continue";
            }

            if (!decision.ledger) {
              throw new Error("Intervention coordinator did not produce a replacement section state.");
            }

            discussionLedger = decision.ledger;
            await eventSink({
              timestamp: nowIso(),
              type: "discussion-ledger-updated",
              providerId: turn.providerId,
              participantId: turn.participantId,
              participantLabel: turn.participantLabel,
              round: nextRound,
              speakerRole: turn.role,
              message: decision.reason || decision.ledger.currentFocus,
              discussionLedger
            });
            await eventSink({
              timestamp: nowIso(),
              type: "user-input-received",
              round,
              message: "Realtime intervention redirected the discussion."
            });
            seededCoordinatorTurn = turn;
            round = nextRound;
            currentSectionStartedAtRound = round;
            consecutiveReviseRoundsForSection = 0;
            pendingReviewerVerdictSummary = undefined;
            pendingConvergenceNoticeRounds = undefined;
            return "continue";
          }
        };

        roundLoop:
        while (true) {
          try {
            throwIfAborted();
            const compiledContextMarkdown = await buildCompiledContextMarkdown(currentDraft, round, "round", "compact");
            let coordinatorTurn = seededCoordinatorTurn;
            seededCoordinatorTurn = undefined;
            const reviewerVerdictForPrompt = pendingReviewerVerdictSummary;
            const convergenceNoticeForPrompt = pendingConvergenceNoticeRounds;
            pendingReviewerVerdictSummary = undefined;
            pendingConvergenceNoticeRounds = undefined;
            if (!coordinatorTurn) {
              const completedTurns = turns.filter((turn) => turn.status === "completed");
              const coordinatorPrompt = buildRealtimeCoordinatorDiscussionPrompt(
                compiledContextMarkdown,
                getNotionBriefForProfile("compact"),
                userInterventions,
                completedTurns,
                round,
                discussionLedger,
                {
                  reviewerVerdictSummary: reviewerVerdictForPrompt,
                  convergenceNoticeRounds: convergenceNoticeForPrompt
                }
              );
              coordinatorTurn = await this.executeTurn(
                request.projectSlug,
                runId,
                coordinator,
                round,
                coordinatorPrompt,
                coordinatorState,
                eventSink,
                `realtime-round-${round}-coordinator-open`,
                abortSignal,
                bindExecutionAbortController
              );
              turns.push(coordinatorTurn);
            }

            if (coordinatorTurn.status !== "completed") {
              throw new Error(coordinatorTurn.error ?? "Coordinator failed to guide the realtime discussion.");
            }
            await updateDiscussionLedger(coordinatorTurn, extractDiscussionLedger(coordinatorTurn.response, round));
            const escalationQuestion = extractCoordinatorEscalationQuestion(discussionLedger);
            if (escalationQuestion) {
              const escalationOutcome = await handleRealtimeAwaitingUserInput(round, escalationQuestion, {
                markAwaitingStatus: true
              });
              if (escalationOutcome === "done") {
                break;
              }
              consecutiveReviseRoundsForSection = 0;
              round += 1;
              continue;
            }
            if (discussionLedger) {
              const drafterPrompt = buildRealtimeSectionDrafterPrompt(
                compiledContextMarkdown,
                getNotionBriefForProfile("compact"),
                userInterventions,
                turns.filter((turn) => turn.status === "completed"),
                round,
                discussionLedger
              );
              logDrafterDebug("drafter.prompt", {
                promptKind: "realtime",
                round,
                promptText: drafterPrompt.text ?? JSON.stringify(drafterPrompt)
              });
              const drafterTurn = await this.executeTurn(
                request.projectSlug,
                runId,
                drafter,
                round,
                drafterPrompt,
                drafterState ?? coordinatorState,
                eventSink,
                `realtime-round-${round}-drafter`,
                abortSignal,
                bindExecutionAbortController
              );
              logDrafterDebug("drafter.raw_response", {
                round,
                status: drafterTurn.status,
                responseLength: drafterTurn.response?.length,
                responsePreview: drafterTurn.response?.slice(0, 2000)
              });
              const sectionDraft = drafterTurn.status === "completed"
                ? extractSectionDraft(drafterTurn.response)
                : undefined;
              logDrafterDebug("drafter.parsed", {
                round,
                sectionDraft: sectionDraft?.sectionDraft?.slice(0, 2000),
                changeRationale: sectionDraft?.changeRationale?.slice(0, 500)
              });
              turns.push(sanitizeStoredDrafterTurn(drafterTurn, sectionDraft));
              if (drafterTurn.status === "completed") {
                discussionLedger = {
                  ...discussionLedger,
                  miniDraft: sectionDraft?.sectionDraft || discussionLedger.miniDraft,
                  sectionDraft: sectionDraft?.sectionDraft || discussionLedger.sectionDraft,
                  changeRationale: sectionDraft?.changeRationale || discussionLedger.changeRationale,
                  nextOwner: "fit_reviewer",
                  updatedAtRound: round
                };
                await eventSink({
                  timestamp: nowIso(),
                  type: "discussion-ledger-updated",
                  providerId: drafter.providerId,
                  participantId: drafter.participantId,
                  participantLabel: drafter.participantLabel,
                  round,
                  speakerRole: drafter.role,
                  message: `Section draft prepared for ${discussionLedger.targetSection}`,
                  discussionLedger
                });
              }
            }

            let queuedMessages = consumeCurrentUserMessages();
            if (queuedMessages.length > 0) {
              await emitUserMessages(round, queuedMessages);
              round += 1;
              const redirectContextMarkdown = await buildCompiledContextMarkdown(currentDraft, round, "round", "compact");
              seededCoordinatorTurn = await runRealtimeRedirectCoordinatorTurn(round, redirectContextMarkdown, queuedMessages);
              await persistTurnsAndChat();
              continue;
            }

            const reviewerContextMarkdown = await buildCompiledContextMarkdown(
              currentDraft,
              round,
              "round",
              "minimal",
              { saveArtifact: false }
            );
            const currentRoundReviewerTurns: ReviewTurn[] = [];
            for (const reviewer of [...activeReviewers]) {
              const state = stateMap.get(reviewer.providerId);
              if (!state) {
                continue;
              }

              const prompt = buildRealtimeReviewerPrompt(
                reviewerContextMarkdown,
                getNotionBriefForProfile("minimal"),
                userInterventions,
                turns.filter((turn) => turn.status === "completed"),
                round,
                discussionLedger,
                reviewer.participantId,
                reviewer.perspective
              );
              const turn = await this.executeTurn(
                request.projectSlug,
                runId,
                reviewer,
                round,
                prompt,
                state,
                eventSink,
                `realtime-round-${round}-reviewer`,
                abortSignal,
                bindExecutionAbortController
              );

              turns.push(turn);
              if (turn.status === "completed") {
                currentRoundReviewerTurns.push(turn);
              }
              if (turn.status === "failed") {
                const index = activeReviewers.findIndex((participant) => participant.participantId === reviewer.participantId);
                if (index >= 0) {
                  activeReviewers.splice(index, 1);
                }
                if (activeReviewers.length < 1) {
                  throw new Error("The run cannot continue because every reviewer failed.");
                }
              }

              queuedMessages = consumeCurrentUserMessages();
              if (queuedMessages.length > 0) {
                await emitUserMessages(round, queuedMessages);
                round += 1;
                const redirectContextMarkdown = await buildCompiledContextMarkdown(currentDraft, round, "round", "compact");
                seededCoordinatorTurn = await runRealtimeRedirectCoordinatorTurn(round, redirectContextMarkdown, queuedMessages);
                await persistTurnsAndChat();
                continue roundLoop;
              }
            }

            await persistTurnsAndChat();
            completedRounds = round;
            run = await this.storage.updateRun(request.projectSlug, runId, {
              rounds: round
            });

          const MIN_ROUNDS_BEFORE_CONSENSUS = 2;
          const reviewerStatuses = collectRealtimeReviewerStatuses(currentRoundReviewerTurns, activeReviewers);
          const reviewerVerdictSummary = summarizeRealtimeReviewerVerdicts(currentRoundReviewerTurns, activeReviewers);
          pendingReviewerVerdictSummary = reviewerVerdictSummary;
          if (reviewerVerdictSummary.majorityReviseNeedsHold) {
            consecutiveReviseRoundsForSection += 1;
          } else {
            consecutiveReviseRoundsForSection = 0;
          }
          pendingConvergenceNoticeRounds = consecutiveReviseRoundsForSection >= 3
            ? consecutiveReviseRoundsForSection
            : undefined;
          const allReviewersApprove = hasAllApprovingRealtimeReviewers(activeReviewers, reviewerStatuses);
          const requestedSectionOutcome = discussionLedger?.sectionOutcome;
          const currentSectionReady = isCurrentSectionReady(discussionLedger, activeReviewers, reviewerStatuses);
          const wholeDocumentReady = isWholeDocumentReady(
            discussionLedger,
            activeReviewers,
            reviewerStatuses,
            {
              requestedSectionOutcome,
              allReviewersApprove
            }
          );
          const nextCluster = pickNextTargetSectionCluster(discussionLedger);
          const baseResolvedSectionOutcome = validateSectionOutcome(requestedSectionOutcome, {
            currentSectionReady,
            wholeDocumentReady,
            hasNextCluster: Boolean(nextCluster)
          });
          const resolvedSectionOutcome = reviewerVerdictSummary.majorityReviseNeedsHold
            && baseResolvedSectionOutcome !== "handoff-next-section"
            && baseResolvedSectionOutcome !== "deferred-close"
            ? "keep-open"
            : baseResolvedSectionOutcome;
          const currentSectionRoundCount = round - currentSectionStartedAtRound + 1;
          const reachedSectionRoundLimit = currentSectionRoundCount >= maxRoundsPerSection;
          const effectiveSectionOutcome = reachedSectionRoundLimit && currentSectionReady && !reviewerVerdictSummary.majorityReviseNeedsHold
            ? forceSectionClosureOutcome({
                wholeDocumentReady,
                hasNextCluster: Boolean(nextCluster)
              })
            : resolvedSectionOutcome;
          const currentSectionKey = getLedgerTargetSectionKey(discussionLedger);
            if (allReviewersApprove && round < MIN_ROUNDS_BEFORE_CONSENSUS) {
            // 너무 이른 합의 — devil's advocate 발동
            const challengePrompt = buildDevilsAdvocatePrompt(
              compiledContextMarkdown,
              getNotionBriefForProfile("compact"),
              userInterventions,
              turns.filter((t) => t.status === "completed"),
              round,
              discussionLedger
            );
            const challengeTurn = await this.executeTurn(
              request.projectSlug,
              runId,
              coordinator,
              round,
              challengePrompt,
              coordinatorState,
              eventSink,
              `realtime-round-${round}-coordinator-challenge`,
              abortSignal,
              bindExecutionAbortController
            );
            turns.push(challengeTurn);
            if (challengeTurn.status === "completed") {
              await updateDiscussionLedger(challengeTurn, extractDiscussionLedger(challengeTurn.response, round));
            }
            await persistTurnsAndChat();
            round += 1;
            continue;
          }

            if (
              discussionLedger &&
              currentSectionReady &&
              reviewerVerdictSummary.majorityReviseNeedsHold &&
              shouldRunWeakConsensusPolish(activeReviewers, reviewerStatuses, currentSectionKey, polishRoundsUsed)
            ) {
            polishRoundsUsed.add(currentSectionKey);
            const polishPrompt = buildWeakConsensusPolishPrompt(
              compiledContextMarkdown,
              getNotionBriefForProfile("compact"),
              userInterventions,
              turns.filter((turn) => turn.status === "completed"),
              round,
              discussionLedger
            );
            const polishTurn = await this.executeTurn(
              request.projectSlug,
              runId,
              coordinator,
              round,
              polishPrompt,
              coordinatorState,
              eventSink,
              `realtime-round-${round}-coordinator-polish`,
              abortSignal,
              bindExecutionAbortController
            );
            turns.push(polishTurn);
            if (polishTurn.status === "completed") {
              await updateDiscussionLedger(polishTurn, extractDiscussionLedger(polishTurn.response, round));
            }
            await persistTurnsAndChat();
            round += 1;
            continue;
          }

            if (effectiveSectionOutcome === "write-final" && wholeDocumentReady) {
            const finalContextMarkdown = await buildCompiledContextMarkdown(currentDraft, round, "round", "full");
            const finalPrompt = buildRealtimeFinalDraftPrompt(
              finalContextMarkdown,
              getNotionBriefForProfile("full"),
              userInterventions,
              turns.filter((turn) => turn.status === "completed"),
              discussionLedger
            );
            const finalTurn = await this.executeTurn(
              request.projectSlug,
              runId,
              finalizer,
              round,
              finalPrompt,
              finalizerState ?? coordinatorState,
              eventSink,
              `realtime-round-${round}-finalizer-final`,
              abortSignal,
              bindExecutionAbortController
            );
            turns.push(finalTurn);

            if (finalTurn.status !== "completed") {
              throw new Error(finalTurn.error ?? "Coordinator failed to write the final realtime draft.");
            }

            currentDraft = finalTurn.response.trim() || currentDraft;
            queuedMessages = consumeCurrentUserMessages();
            if (queuedMessages.length > 0) {
              await emitUserMessages(round, queuedMessages);
              round += 1;
              const redirectContextMarkdown = await buildCompiledContextMarkdown(currentDraft, round, "round", "compact");
              seededCoordinatorTurn = await runRealtimeRedirectCoordinatorTurn(round, redirectContextMarkdown, queuedMessages);
              await persistTurnsAndChat();
              continue;
            }

            finalizedRealtimeDraft = true;
            artifacts = {
              summary: "Realtime mode does not generate a summary artifact.",
              improvementPlan: "Realtime mode does not generate an improvement plan artifact.",
              revisedDraft: currentDraft
            };
            await persistTurnsAndChat();
            break;
          }

            if (effectiveSectionOutcome === "deferred-close" && discussionLedger && nextCluster) {
              discussionLedger = transitionDiscussionLedgerAfterDeferredClose(discussionLedger, nextCluster, round);
              await eventSink({
                timestamp: nowIso(),
                type: "discussion-ledger-updated",
                round,
                speakerRole: "system",
                message: `Deferred current-section advisory issues and handed off to ${nextCluster.sectionLabel}.`,
                discussionLedger
              });
              round += 1;
              currentSectionStartedAtRound = round;
              consecutiveReviseRoundsForSection = 0;
              continue;
            }

            if (effectiveSectionOutcome === "handoff-next-section" && discussionLedger && nextCluster) {
              discussionLedger = transitionDiscussionLedgerToNextCluster(discussionLedger, nextCluster, round);
              await eventSink({
                timestamp: nowIso(),
                type: "discussion-ledger-updated",
                round,
                speakerRole: "system",
                message: `Prepared the next target section handoff: ${nextCluster.sectionLabel}`,
                discussionLedger
              });
              round += 1;
              currentSectionStartedAtRound = round;
              consecutiveReviseRoundsForSection = 0;
              continue;
            }

            if (reachedSectionRoundLimit) {
              const roundLimitOutcome = await handleRealtimeAwaitingUserInput(
                round,
                `Round ${round} ended without a document-ready conclusion. Press Enter to continue or add guidance. Use the Essay tab's 완료 button for question completion; /done is still available if you need to stop without a final draft.`
              );
              if (roundLimitOutcome === "done") {
                break;
              }
            }

            round += 1;
          } catch (error) {
            if (isRunInterventionAbortError(error)) {
              const outcome = await handleImmediateRealtimeIntervention(error);
              if (outcome === "done") {
                break;
              }
              continue;
            }
            throw error;
          }
        }

        if (!finalizedRealtimeDraft) {
          artifacts = {
            summary: "Realtime mode does not generate a summary artifact.",
            improvementPlan: "Realtime mode does not generate an improvement plan artifact.",
            revisedDraft: currentDraft
          };
        }
      }

      await persistTurnsAndChat();
      if (request.reviewMode === "deepFeedback") {
        await saveDeepArtifacts(artifacts);
      } else if (finalizedRealtimeDraft) {
        await this.storage.saveRunTextArtifact(request.projectSlug, runId, "revised-draft.md", artifacts.revisedDraft);
      }
      if (request.reviewMode === "realtime") {
        await saveDiscussionLedgerArtifact();
      }

      run = await this.storage.updateRun(request.projectSlug, runId, {
        rounds: completedRounds,
        status: "completed",
        finishedAt: nowIso()
      });
      await eventSink({ timestamp: nowIso(), type: "run-completed", message: "Session completed" });

      return { run, turns, artifacts };
    } catch (error) {
      await this.storage.saveReviewTurns(request.projectSlug, runId, turns);
      const persistedChatMessages = [...chatMessages.values()].filter((message) => message.status === "completed");
      if (persistedChatMessages.length > 0) {
        await this.storage.saveRunChatMessages(request.projectSlug, runId, persistedChatMessages);
      }
      if (request.reviewMode === "realtime") {
        try {
          if (discussionLedger) {
            await this.storage.saveRunTextArtifact(
              request.projectSlug,
              runId,
              "discussion-ledger.md",
              buildDiscussionLedgerArtifact(discussionLedger)
            );
          }
        } catch {
          // Preserve the original run failure if the ledger artifact cannot be written.
        }
      }
      if (isRunAbortedError(error)) {
        run = await this.storage.updateRun(request.projectSlug, runId, {
          status: "aborted",
          finishedAt: nowIso()
        });
        await eventSink({
          timestamp: nowIso(),
          type: "run-aborted",
          message: error.message
        });
        throw error;
      }

      run = await this.storage.updateRun(request.projectSlug, runId, {
        status: "failed",
        finishedAt: nowIso()
      });
      await eventSink({
        timestamp: nowIso(),
        type: "run-failed",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async executeTurn(
    projectSlug: string,
    runId: string,
    participant: ReviewParticipant,
    round: number,
    prompt: BuiltPrompt,
    state: ProviderRuntimeState,
    onEvent?: (event: RunEvent) => Promise<void> | void,
    messageScope?: string,
    abortSignal?: AbortSignal,
    bindExecutionAbortController?: (controller?: AbortController) => void
  ): Promise<ReviewTurn> {
    if (abortSignal?.aborted) {
      const abortReason = abortSignal.reason;
      if (isRunInterventionAbortError(abortReason)) {
        throw abortReason;
      }
      throw new RunAbortedError();
    }

    const startedAt = nowIso();
    const scopedMessageScope = `run-${runId}-${messageScope ?? `round-${round}-${participant.role}`}-${participant.participantId}`;
    const promptMetrics = finalizePromptMetrics(prompt);
    const { controller, dispose } = createLinkedAbortController(abortSignal);
    const turn: ReviewTurn = {
      providerId: participant.providerId,
      participantId: participant.participantId,
      participantLabel: participant.participantLabel,
      role: participant.role,
      round,
      prompt: prompt.text,
      promptMetrics,
      response: "",
      startedAt,
      status: "completed"
    };

    await this.recordEvent(projectSlug, runId, {
      timestamp: startedAt,
      type: "prompt-metrics",
      providerId: participant.providerId,
      participantId: participant.participantId,
      participantLabel: participant.participantLabel,
      round,
      speakerRole: participant.role,
      message: `${prompt.promptKind} prompt metrics recorded`,
      promptMetrics
    }, onEvent);
    await this.recordEvent(projectSlug, runId, {
      timestamp: startedAt,
      type: "turn-started",
      providerId: participant.providerId,
      participantId: participant.participantId,
      participantLabel: participant.participantLabel,
      round,
      speakerRole: participant.role,
      message: `${participant.role} turn started`,
      promptMetrics
    }, onEvent);

    try {
      bindExecutionAbortController?.(controller);
      const result = await this.gateway.execute(participant.providerId, prompt.text, {
        cwd: this.storage.storageRoot,
        authMode: state.authMode,
        apiKey: await this.gateway.getApiKey(participant.providerId),
        round,
        speakerRole: participant.role,
        messageScope: scopedMessageScope,
        participantId: participant.participantId,
        participantLabel: participant.participantLabel,
        modelOverride: participant.assignment.useProviderDefaults ? undefined : participant.assignment.modelOverride,
        effortOverride: participant.assignment.useProviderDefaults ? undefined : participant.assignment.effortOverride,
        onEvent,
        abortSignal: controller.signal
      });
      turn.response = result.text.trim();
      turn.finishedAt = nowIso();
      await this.recordEvent(projectSlug, runId, {
        timestamp: turn.finishedAt,
        type: "turn-completed",
        providerId: participant.providerId,
        participantId: participant.participantId,
        participantLabel: participant.participantLabel,
        round,
        speakerRole: participant.role,
        message: `${participant.role} turn completed`
      }, onEvent);
      return turn;
    } catch (error) {
      const abortReason = controller.signal.reason;
      if (isRunInterventionAbortError(abortReason)) {
        throw abortReason;
      }
      if (isAbortError(error)) {
        throw new RunAbortedError();
      }
      if (isRunAbortedError(error)) {
        throw error;
      }

      turn.status = "failed";
      turn.error = error instanceof Error ? error.message : String(error);
      turn.finishedAt = nowIso();
      await this.recordEvent(projectSlug, runId, {
        timestamp: turn.finishedAt,
        type: "turn-failed",
        providerId: participant.providerId,
        participantId: participant.participantId,
        participantLabel: participant.participantLabel,
        round,
        speakerRole: participant.role,
        message: turn.error
      }, onEvent);
      return turn;
    } finally {
      bindExecutionAbortController?.(undefined);
      dispose();
    }
  }

  private async recordEvent(
    projectSlug: string,
    runId: string,
    event: RunEvent,
    onEvent?: (event: RunEvent) => Promise<void> | void
  ): Promise<void> {
    if (onEvent) {
      await onEvent(event);
      return;
    }

    await this.storage.appendRunEvent(projectSlug, runId, event);
  }
}

function createLinkedAbortController(parentSignal?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  if (!parentSignal) {
    return { controller, dispose: () => undefined };
  }

  const abortWithParentReason = () => {
    const reason = parentSignal.reason;
    if (!controller.signal.aborted) {
      controller.abort(reason instanceof Error ? reason : new RunAbortedError());
    }
  };

  if (parentSignal.aborted) {
    abortWithParentReason();
    return { controller, dispose: () => undefined };
  }

  parentSignal.addEventListener("abort", abortWithParentReason, { once: true });
  return {
    controller,
    dispose: () => parentSignal.removeEventListener("abort", abortWithParentReason)
  };
}
