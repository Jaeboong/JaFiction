import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import {
  RunChatMessage,
  RunLedgerEntry,
  ReviewTurn,
  RunEvent,
  RunRecord
} from "./types";
import { RunChatMessageSchema, RunLedgerEntrySchema, ReviewTurnSchema, RunRecordSchema } from "./schemas";
import type { StoragePaths } from "./storagePaths";
import { RunContinuationContext } from "./storage";
import { ensureDir, fileExists, readJsonFile, writeJsonFile } from "./utils";

const RUN_LOG_FILE_NAME = "run-log.txt";
const RUN_LOG_RETENTION_DAYS = 30;
const IGNORED_RUN_LOG_PATTERNS = [
  /failed to warm featured plugin ids cache/i,
  /ignoring interface\.defaultPrompt/i,
  /failed to read OAuth tokens from keyring/i,
  /org\.freedesktop\.secrets/i,
  /Failed to delete shell snapshot/i,
  /Failed to read MCP server stderr/i,
  /stream did not contain valid UTF-8/i,
  /Failed to kill MCP process group/i
];

interface BufferedRunChatLog {
  timestamp: string;
  speaker: string;
  recipient?: string;
  round?: number;
  content: string;
}

/**
 * Handles run lifecycle persistence: create, update, list, and read run artifacts.
 */
export class RunRepository {
  private readonly bufferedChatLogs = new Map<string, BufferedRunChatLog>();
  private readonly loggedChatMessageIds = new Set<string>();

  constructor(private readonly paths: StoragePaths) {}

  async createRun(record: RunRecord): Promise<string> {
    const runDir = this.paths.runDir(record.projectSlug, record.id);
    await ensureDir(runDir);
    await this.pruneExpiredRunLogs();
    await writeJsonFile(path.join(runDir, "input.json"), record);
    return runDir;
  }

  async updateRun(projectSlug: string, runId: string, updates: Partial<RunRecord>): Promise<RunRecord> {
    const existing = await this.getRun(projectSlug, runId);
    const merged = RunRecordSchema.parse({ ...existing, ...updates });
    await writeJsonFile(path.join(this.paths.runDir(projectSlug, runId), "input.json"), merged);
    return merged;
  }

  async getRun(projectSlug: string, runId: string): Promise<RunRecord> {
    const raw = await readJsonFile(path.join(this.paths.runDir(projectSlug, runId), "input.json"), {});
    return RunRecordSchema.parse(raw);
  }

  async deleteRun(projectSlug: string, runId: string): Promise<void> {
    await fs.rm(this.paths.runDir(projectSlug, runId), { recursive: true, force: true });
  }

  async listRuns(projectSlug: string): Promise<RunRecord[]> {
    try {
      const entries = await fs.readdir(this.paths.projectRunsDir(projectSlug), { withFileTypes: true });
      const runs: RunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const inputPath = path.join(this.paths.projectRunsDir(projectSlug), entry.name, "input.json");
        if (!(await fileExists(inputPath))) {
          continue;
        }

        const raw = await readJsonFile(inputPath, {});
        runs.push(RunRecordSchema.parse(raw));
      }

      return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async saveRunTextArtifact(projectSlug: string, runId: string, fileName: string, content: string): Promise<string> {
    const artifactPath = path.join(this.paths.runDir(projectSlug, runId), fileName);
    await fs.writeFile(artifactPath, content, "utf8");
    return artifactPath;
  }

  async saveProjectInsightJson(projectSlug: string, fileName: string, data: unknown): Promise<string> {
    const artifactPath = path.join(this.paths.projectInsightsDir(projectSlug), fileName);
    await ensureDir(this.paths.projectInsightsDir(projectSlug));
    await writeJsonFile(artifactPath, data);
    return artifactPath;
  }

  async readProjectInsightJson<T>(projectSlug: string, fileName: string): Promise<T | undefined> {
    const artifactPath = path.join(this.paths.projectInsightsDir(projectSlug), fileName);
    if (!(await fileExists(artifactPath))) {
      return undefined;
    }

    return readJsonFile<T>(artifactPath, {} as T);
  }

  async appendRunEvent(projectSlug: string, runId: string, event: RunEvent): Promise<void> {
    if (event.type.startsWith("chat-message-")) {
      await this.captureChatLogEvent(projectSlug, runId, event);
      return;
    }

    const block = this.formatRunLogBlock(event);
    if (block) {
      await this.appendRunLogBlock(projectSlug, runId, block);
    }

    if (event.type === "run-completed" || event.type === "run-aborted" || event.type === "run-failed") {
      await this.flushBufferedChatLogs(projectSlug, runId);
      this.clearRunChatState(projectSlug, runId);
    }
  }

  async saveReviewTurns(projectSlug: string, runId: string, turns: ReviewTurn[]): Promise<void> {
    ReviewTurnSchema.array().parse(turns);
    await writeJsonFile(path.join(this.paths.runDir(projectSlug, runId), "review-turns.json"), turns);
  }

  async saveRunChatMessages(projectSlug: string, runId: string, messages: RunChatMessage[]): Promise<void> {
    RunChatMessageSchema.array().parse(messages);
    await writeJsonFile(path.join(this.paths.runDir(projectSlug, runId), "chat-messages.json"), messages);
    await this.syncRunLogFromChatMessages(projectSlug, runId, messages);
  }

  async loadRunChatMessages(projectSlug: string, runId: string): Promise<RunChatMessage[] | undefined> {
    const raw = await this.readOptionalRunArtifact(projectSlug, runId, "chat-messages.json");
    if (!raw) {
      return undefined;
    }
    return RunChatMessageSchema.array().parse(JSON.parse(raw));
  }

  async saveRunLedgers(projectSlug: string, runId: string, ledgers: RunLedgerEntry[]): Promise<void> {
    RunLedgerEntrySchema.array().parse(ledgers);
    await writeJsonFile(path.join(this.paths.runDir(projectSlug, runId), "chat-ledgers.json"), ledgers);
  }

  async loadRunLedgers(projectSlug: string, runId: string): Promise<RunLedgerEntry[] | undefined> {
    const raw = await this.readOptionalRunArtifact(projectSlug, runId, "chat-ledgers.json");
    if (!raw) {
      return undefined;
    }
    return RunLedgerEntrySchema.array().parse(JSON.parse(raw));
  }

  async readOptionalRunArtifact(projectSlug: string, runId: string, fileName: string): Promise<string | undefined> {
    const artifactPath = path.join(this.paths.runDir(projectSlug, runId), fileName);
    if (!(await fileExists(artifactPath))) {
      return undefined;
    }

    return fs.readFile(artifactPath, "utf8");
  }

  async loadRunContinuationContext(projectSlug: string, runId: string): Promise<RunContinuationContext> {
    const [record, summary, improvementPlan, revisedDraft, notionBrief, chatMessagesRaw] = await Promise.all([
      this.getRun(projectSlug, runId),
      this.readOptionalRunArtifact(projectSlug, runId, "summary.md"),
      this.readOptionalRunArtifact(projectSlug, runId, "improvement-plan.md"),
      this.readOptionalRunArtifact(projectSlug, runId, "revised-draft.md"),
      this.readOptionalRunArtifact(projectSlug, runId, "notion-brief.md"),
      this.readOptionalRunArtifact(projectSlug, runId, "chat-messages.json")
    ]);

    let chatMessages: RunChatMessage[] | undefined;
    if (chatMessagesRaw) {
      chatMessages = RunChatMessageSchema.array().parse(JSON.parse(chatMessagesRaw));
    }

    return { record, summary, improvementPlan, revisedDraft, notionBrief, chatMessages };
  }

  getRunArtifactPath(projectSlug: string, runId: string, fileName: string): string {
    return path.join(this.paths.runDir(projectSlug, runId), fileName);
  }

  async pruneExpiredRunLogs(): Promise<void> {
    const cutoff = Date.now() - RUN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    let projectEntries: Dirent[];
    try {
      projectEntries = await fs.readdir(this.paths.projectsDir(), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) {
        continue;
      }

      const runsDir = this.paths.projectRunsDir(projectEntry.name);
      let runEntries: Dirent[];
      try {
        runEntries = await fs.readdir(runsDir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }

      for (const runEntry of runEntries) {
        if (!runEntry.isDirectory()) {
          continue;
        }

        const logPath = path.join(runsDir, runEntry.name, RUN_LOG_FILE_NAME);
        if (!(await fileExists(logPath))) {
          continue;
        }

        const stats = await fs.stat(logPath);
        if (stats.mtimeMs < cutoff) {
          await fs.rm(logPath, { force: true });
        }
      }
    }
  }

  private async captureChatLogEvent(projectSlug: string, runId: string, event: RunEvent): Promise<void> {
    if (!event.messageId) {
      return;
    }

    const key = this.chatLogKey(projectSlug, runId, event.messageId);
    const existing = this.bufferedChatLogs.get(key);

    if (event.type === "chat-message-started") {
      this.bufferedChatLogs.set(key, {
        timestamp: event.timestamp,
        speaker: formatRunLogSpeaker(event),
        recipient: event.recipient,
        round: event.round,
        content: existing?.content ?? ""
      });
      return;
    }

    if (event.type === "chat-message-delta") {
      const buffer = existing ?? {
        timestamp: event.timestamp,
        speaker: formatRunLogSpeaker(event),
        recipient: event.recipient,
        round: event.round,
        content: ""
      };
      buffer.content += event.message ?? "";
      this.bufferedChatLogs.set(key, buffer);
      return;
    }

    if (event.type === "chat-message-completed") {
      const buffer = existing;
      if (buffer && buffer.content.trim() && !this.loggedChatMessageIds.has(key)) {
        await this.appendRunLogBlock(projectSlug, runId, formatChatLogBlock(buffer));
        this.loggedChatMessageIds.add(key);
      }
      this.bufferedChatLogs.delete(key);
    }
  }

  private async syncRunLogFromChatMessages(projectSlug: string, runId: string, messages: RunChatMessage[]): Promise<void> {
    for (const message of messages) {
      const key = this.chatLogKey(projectSlug, runId, message.id);
      if (message.status === "completed" && message.content.trim() && !this.loggedChatMessageIds.has(key)) {
        await this.appendRunLogBlock(projectSlug, runId, formatChatLogBlock({
          timestamp: message.finishedAt ?? message.startedAt,
          speaker: message.speaker,
          recipient: message.recipient,
          round: message.round,
          content: message.content
        }));
        this.loggedChatMessageIds.add(key);
      }
    }
  }

  private async flushBufferedChatLogs(projectSlug: string, runId: string): Promise<void> {
    const prefix = `${projectSlug}/${runId}/`;
    for (const [key, buffer] of this.bufferedChatLogs.entries()) {
      if (!key.startsWith(prefix) || !buffer.content.trim() || this.loggedChatMessageIds.has(key)) {
        continue;
      }

      await this.appendRunLogBlock(projectSlug, runId, formatChatLogBlock(buffer, { partial: true }));
      this.loggedChatMessageIds.add(key);
    }
  }

  private clearRunChatState(projectSlug: string, runId: string): void {
    const prefix = `${projectSlug}/${runId}/`;
    for (const key of this.bufferedChatLogs.keys()) {
      if (key.startsWith(prefix)) {
        this.bufferedChatLogs.delete(key);
      }
    }
    for (const key of this.loggedChatMessageIds) {
      if (key.startsWith(prefix)) {
        this.loggedChatMessageIds.delete(key);
      }
    }
  }

  private async appendRunLogBlock(projectSlug: string, runId: string, block: string): Promise<void> {
    const artifactPath = path.join(this.paths.runDir(projectSlug, runId), RUN_LOG_FILE_NAME);
    await fs.appendFile(artifactPath, block.endsWith("\n") ? block : `${block}\n`, "utf8");
  }

  private formatRunLogBlock(event: RunEvent): string | undefined {
    switch (event.type) {
      case "run-started":
        return `[${event.timestamp}] Run started\n`;
      case "awaiting-user-input":
        return `[${event.timestamp}] Waiting for user input\n`;
      case "user-input-received":
        return `[${event.timestamp}] ${compactLogMessage(event.message) || "User input received"}\n`;
      case "provider-stderr": {
        const message = compactLogMessage(event.message);
        if (!message || shouldIgnoreRunLogMessage(message)) {
          return undefined;
        }
        return `[${event.timestamp}] Error: ${message}\n`;
      }
      case "turn-failed": {
        const message = compactLogMessage(event.message);
        if (shouldIgnoreRunLogMessage(message)) {
          return undefined;
        }
        return `[${event.timestamp}] Turn failed${message ? `: ${message}` : ""}\n`;
      }
      case "run-completed":
        return `[${event.timestamp}] Run completed\n`;
      case "run-aborted": {
        const message = compactLogMessage(event.message);
        return `[${event.timestamp}] Run aborted${message ? `: ${message}` : ""}\n`;
      }
      case "run-failed": {
        const message = compactLogMessage(event.message);
        if (shouldIgnoreRunLogMessage(message)) {
          return `[${event.timestamp}] Run failed\n`;
        }
        return `[${event.timestamp}] Run failed${message ? `: ${message}` : ""}\n`;
      }
      default:
        return undefined;
    }
  }

  private chatLogKey(projectSlug: string, runId: string, messageId: string): string {
    return `${projectSlug}/${runId}/${messageId}`;
  }
}

function formatChatLogBlock(buffer: BufferedRunChatLog, options: { partial?: boolean } = {}): string {
  const headerParts = [`[${buffer.timestamp}]`];
  if (typeof buffer.round === "number") {
    headerParts.push(`R${buffer.round}`);
  }
  headerParts.push(buffer.speaker);
  if (buffer.recipient?.trim()) {
    headerParts.push(`-> ${buffer.recipient.trim()}`);
  }
  if (options.partial) {
    headerParts.push("(partial)");
  }

  return `${headerParts.join(" ")}\n${buffer.content.trim()}\n\n`;
}

function formatRunLogSpeaker(event: Pick<RunEvent, "speakerRole" | "participantLabel" | "providerId">): string {
  const participantName = event.participantLabel?.trim() || providerNameForLog(event.providerId);
  switch (event.speakerRole) {
    case "reviewer":
      return `Reviewer: ${participantName}`;
    case "coordinator":
      return `Coordinator: ${participantName}`;
    case "drafter":
      return `Drafter: ${participantName}`;
    case "finalizer":
      return `Finalizer: ${participantName}`;
    case "user":
      return "User";
    default:
      return participantName;
  }
}

function providerNameForLog(providerId?: RunEvent["providerId"]): string {
  switch (providerId) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    default:
      return "System";
  }
}

function compactLogMessage(message?: string): string {
  const compact = message
    ?.replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return compact || "";
}

function shouldIgnoreRunLogMessage(message: string): boolean {
  return IGNORED_RUN_LOG_PATTERNS.some((pattern) => pattern.test(message));
}
