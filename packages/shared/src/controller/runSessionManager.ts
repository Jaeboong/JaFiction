import { UserInterventionRequest } from "../core/orchestrator";
import { ReviewMode, RunAbortedError, RunInterventionAbortError } from "../core/types";
import { createId } from "../core/utils";
import { RunSessionState } from "../core/viewModels";

interface ActiveRunSession {
  sessionId: string;
  state: RunSessionState;
  queuedMessages: string[];
  abortController: AbortController;
  executionAbortController?: AbortController;
  resolveIntervention?: (value: string | undefined) => void;
  pendingInterventionRequest?: UserInterventionRequest;
}

function runningMessage(projectSlug: string): string {
  return `Run in progress for ${projectSlug}.`;
}

function pausedMessage(request: UserInterventionRequest): string {
  const unit = request.reviewMode === "realtime" ? "round" : "cycle";
  return `Run paused after ${unit} ${request.round}.`;
}

function abortingMessage(projectSlug: string): string {
  return `Stopping active run for ${projectSlug}.`;
}

function roundCompleteMessage(projectSlug: string): string {
  return `Run completed a round for ${projectSlug}. Continue, pin, or abort.`;
}

export class AddressedRunMismatchError extends Error {
  constructor(readonly activeRunId?: string) {
    super("This run is no longer the active session.");
  }
}

export class RunSessionManager {
  private activeSession?: ActiveRunSession;

  assertCanStart(projectSlug: string): void {
    if (!this.activeSession) {
      return;
    }

    const current = this.activeSession.state;
    const sameProject = current.projectSlug === projectSlug;
    if (current.status === "aborting") {
      throw new Error(
        sameProject
          ? "This run is still aborting. Wait for it to stop before starting again."
          : "Another run is still aborting. Wait for it to stop before starting a new run."
      );
    }
    if (current.status === "paused") {
      throw new Error(
        sameProject
          ? "This run is paused and still waiting for intervention. Continue or finish it before starting again."
          : "Another run is paused and still waiting for intervention. Continue or finish it before starting a new run."
      );
    }

    throw new Error(
      sameProject
        ? "A run is already active for this project."
        : "Another run is already active. Only one run can be active at a time."
    );
  }

  start(projectSlug: string, reviewMode: ReviewMode): string {
    this.assertCanStart(projectSlug);
    const sessionId = createId();
    this.activeSession = {
      sessionId,
      state: {
        status: "running",
        projectSlug,
        reviewMode,
        message: runningMessage(projectSlug)
      },
      queuedMessages: [],
      abortController: new AbortController()
    };
    return sessionId;
  }

  setRunId(sessionId: string, runId: string): void {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return;
    }
    if (this.activeSession.state.status !== "running" && this.activeSession.state.status !== "paused") {
      return;
    }
    if (this.activeSession.state.runId) {
      return;
    }
    this.activeSession = {
      ...this.activeSession,
      state: { ...this.activeSession.state, runId }
    };
  }

  waitForIntervention(sessionId: string, request: UserInterventionRequest): Promise<string | undefined> {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      throw new Error("Cannot pause a run that has not started.");
    }

    if (this.activeSession.resolveIntervention) {
      throw new Error("A paused run is already waiting for intervention.");
    }

    return new Promise((resolve) => {
      this.activeSession = {
        sessionId,
      state: {
        status: "paused",
        projectSlug: request.projectSlug,
          runId: request.runId,
          round: request.round,
          reviewMode: request.reviewMode,
          message: pausedMessage(request)
      },
      queuedMessages: this.activeSession?.queuedMessages ?? [],
      abortController: this.activeSession?.abortController ?? new AbortController(),
      executionAbortController: undefined,
      pendingInterventionRequest: request,
      resolveIntervention: resolve
    };
    });
  }

  abortSignal(sessionId: string): AbortSignal {
    const session = this.requireActiveSession(sessionId);
    return session.abortController.signal;
  }

  bindExecutionAbortController(sessionId: string, controller?: AbortController): void {
    const session = this.requireActiveSession(sessionId);
    session.executionAbortController = controller;
  }

  abort(runId?: string): void {
    if (!this.activeSession) {
      if (runId) {
        throw new AddressedRunMismatchError(undefined);
      }
      throw new Error("There is no active session to abort.");
    }

    this.assertAddressedRun(runId);

    if (this.activeSession.state.status === "paused" && !this.activeSession.resolveIntervention) {
      this.activeSession = undefined;
      return;
    }

    if (this.activeSession.resolveIntervention && this.activeSession.pendingInterventionRequest) {
      const { resolveIntervention } = this.activeSession;
      this.activeSession = {
        ...this.activeSession,
        state: {
          ...this.activeSession.state,
          status: "aborting",
          message: abortingMessage(this.activeSession.state.projectSlug ?? "")
        },
        executionAbortController: undefined,
        pendingInterventionRequest: undefined,
        resolveIntervention: undefined
      };
      resolveIntervention("/abort");
      return;
    }

    this.activeSession = {
      ...this.activeSession,
      state: {
        ...this.activeSession.state,
        status: "aborting",
        message: abortingMessage(this.activeSession.state.projectSlug ?? "")
      }
    };
    this.activeSession.executionAbortController?.abort(new RunAbortedError());
    this.activeSession.abortController.abort(new RunAbortedError());
  }

  submitIntervention(addressedRunId: string | undefined, message: string | undefined): "queued" | "resumed" | "continuation" {
    if (!this.activeSession) {
      if (addressedRunId) {
        throw new AddressedRunMismatchError(undefined);
      }
      throw new Error("There is no active session waiting for input.");
    }

    this.assertAddressedRun(addressedRunId);

    if (!this.activeSession) {
      throw new Error("There is no active session waiting for input.");
    }
    if (this.activeSession.state.status === "aborting") {
      throw new Error("This run is already aborting.");
    }

    const trimmed = message?.trim() || "";
    if (this.activeSession.resolveIntervention && this.activeSession.pendingInterventionRequest) {
      const { resolveIntervention, pendingInterventionRequest, queuedMessages } = this.activeSession;
      this.activeSession = {
        sessionId: this.activeSession.sessionId,
        state: {
          status: "running",
          projectSlug: pendingInterventionRequest.projectSlug,
          runId: pendingInterventionRequest.runId,
          round: pendingInterventionRequest.round,
          reviewMode: pendingInterventionRequest.reviewMode,
          message: runningMessage(pendingInterventionRequest.projectSlug)
        },
        queuedMessages,
        abortController: this.activeSession.abortController,
        executionAbortController: undefined
      };
      resolveIntervention(trimmed);
      return "resumed";
    }

    if (this.activeSession.state.status === "paused") {
      if (!this.activeSession.state.runId) {
        throw new Error("There is no active run to continue.");
      }
      return "continuation";
    }

    if (this.activeSession.state.status !== "running") {
      throw new Error("There is no active session waiting for input.");
    }
    if (!trimmed) {
      throw new Error("Enter a message to join the discussion.");
    }

    this.activeSession.queuedMessages.push(trimmed);
    if (this.activeSession.state.reviewMode === "realtime" && this.activeSession.executionAbortController && !this.activeSession.executionAbortController.signal.aborted) {
      this.activeSession.executionAbortController.abort(new RunInterventionAbortError(trimmed));
    }
    return "queued";
  }

  drainQueuedMessages(sessionId: string): string[] {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId || this.activeSession.queuedMessages.length === 0) {
      return [];
    }

    const queued = [...this.activeSession.queuedMessages];
    this.activeSession.queuedMessages = [];
    return queued;
  }

  markRoundComplete(sessionId: string): void {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return;
    }
    if (this.activeSession.state.status === "aborting") {
      return;
    }

    const projectSlug = this.activeSession.state.projectSlug ?? "";
    this.activeSession = {
      ...this.activeSession,
      state: {
        ...this.activeSession.state,
        status: "paused",
        message: roundCompleteMessage(projectSlug)
      },
      executionAbortController: undefined,
      pendingInterventionRequest: undefined,
      resolveIntervention: undefined
    };
  }

  finishAddressedRun(addressedRunId?: string): void {
    if (!this.activeSession) {
      if (addressedRunId) {
        throw new AddressedRunMismatchError(undefined);
      }
      throw new Error("There is no active session to finish.");
    }
    this.assertAddressedRun(addressedRunId);
    this.activeSession = undefined;
  }

  finish(sessionId: string): void {
    if (this.activeSession?.sessionId !== sessionId) {
      return;
    }
    this.activeSession = undefined;
  }

  snapshot(): RunSessionState {
    return this.activeSession?.state ?? { status: "idle" };
  }

  private requireActiveSession(sessionId: string): ActiveRunSession {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      throw new Error("The active run session has changed.");
    }

    return this.activeSession;
  }

  private assertAddressedRun(addressedRunId?: string): void {
    if (!addressedRunId) {
      return;
    }
    if (!this.activeSession) {
      throw new AddressedRunMismatchError(undefined);
    }

    const activeRunId = this.activeSession.state.runId;
    if (activeRunId && activeRunId !== addressedRunId) {
      throw new AddressedRunMismatchError(activeRunId);
    }
  }
}
