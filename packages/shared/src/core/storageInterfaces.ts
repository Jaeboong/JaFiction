import {
  AppPreferences,
  ContextDocument,
  ProjectEssayAnswerState,
  ProjectRecord,
  ProviderId,
  ProviderRuntimeState,
  ProviderStatus,
  RunChatMessage,
  RunLedgerEntry,
  RunEvent,
  RunRecord,
  ReviewTurn
} from "./types";
import { RunContinuationContext } from "./storage";

/**
 * Narrow interface for ProviderRegistry: only provider status persistence.
 */
export interface ProviderStore {
  readonly storageRoot: string;
  loadProviderStatuses(): Promise<Record<ProviderId, ProviderStatus | undefined>>;
  saveProviderStatus(status: ProviderStatus): Promise<void>;
}

/**
 * Narrow interface for state aggregators that only need provider runtime reads.
 */
export interface ProviderStateReader {
  listRuntimeStates(options?: { refresh?: boolean }): Promise<ProviderRuntimeState[]>;
  refreshRuntimeState(providerId: ProviderId): Promise<ProviderRuntimeState>;
}

/**
 * Narrow interface for ContextCompiler: only normalized document content reading.
 */
export interface DocumentContentReader {
  readDocumentNormalizedContent(document: ContextDocument): Promise<string | undefined>;
}

/**
 * Narrow interface for SidebarStateStore: state aggregation queries.
 */
export interface StateStoreStorage {
  readonly storageRoot: string;
  ensureInitialized(): Promise<void>;
  getPreferences(): Promise<AppPreferences>;
  listProfileDocuments(): Promise<ContextDocument[]>;
  listProjects(): Promise<ProjectRecord[]>;
  getProject(projectSlug: string): Promise<ProjectRecord>;
  listProjectDocuments(projectSlug: string): Promise<ContextDocument[]>;
  readDocumentRawContent(document: ContextDocument): Promise<string | undefined>;
  listRuns(projectSlug: string): Promise<RunRecord[]>;
  readOptionalRunArtifact(projectSlug: string, runId: string, fileName: string): Promise<string | undefined>;
}

/**
 * Narrow interface for ReviewOrchestrator: run lifecycle operations.
 */
export interface RunStore {
  readonly storageRoot: string;
  getProject(projectSlug: string): Promise<ProjectRecord>;
  listProfileDocuments(): Promise<ContextDocument[]>;
  listProjectDocuments(projectSlug: string): Promise<ContextDocument[]>;
  loadRunContinuationContext(projectSlug: string, runId: string): Promise<RunContinuationContext>;
  createRun(record: RunRecord): Promise<string>;
  updateRun(projectSlug: string, runId: string, updates: Partial<RunRecord>): Promise<RunRecord>;
  setLastCoordinatorProvider(providerId: ProviderId): Promise<void>;
  setLastReviewMode(reviewMode: AppPreferences["lastReviewMode"]): Promise<void>;
  saveRunTextArtifact(projectSlug: string, runId: string, fileName: string, content: string): Promise<string>;
  saveCompletedEssayAnswer(
    projectSlug: string,
    questionIndex: number,
    question: string,
    answer: string,
    runId?: string
  ): Promise<{ document: ContextDocument; project: ProjectRecord; state: ProjectEssayAnswerState }>;
  reopenEssayAnswer(projectSlug: string, questionIndex: number): Promise<ProjectRecord>;
  appendRunEvent(projectSlug: string, runId: string, event: RunEvent): Promise<void>;
  loadReviewTurns(projectSlug: string, runId: string): Promise<ReviewTurn[] | undefined>;
  saveReviewTurns(projectSlug: string, runId: string, turns: ReviewTurn[]): Promise<void>;
  saveRunChatMessages(projectSlug: string, runId: string, messages: RunChatMessage[]): Promise<void>;
  loadRunChatMessages(projectSlug: string, runId: string): Promise<RunChatMessage[] | undefined>;
  saveRunLedgers(projectSlug: string, runId: string, ledgers: RunLedgerEntry[]): Promise<void>;
  loadRunLedgers(projectSlug: string, runId: string): Promise<RunLedgerEntry[] | undefined>;
}
