import { PromptExecutionOptions, ProviderId, RunEvent } from "./types";
import { nowIso } from "./utils";

export interface ProviderStreamProcessor {
  handleStdout(text: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void>;
  finalize(stdout: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void>;
}

export function createProviderStreamProcessor(
  providerId: ProviderId,
  round?: number,
  speakerRole: PromptExecutionOptions["speakerRole"] = "reviewer",
  messageScope?: string,
  participantId?: string,
  participantLabel?: string
): ProviderStreamProcessor {
  return new StreamProcessor(providerId, round, speakerRole, messageScope, participantId, participantLabel);
}

export function parseProviderFinalText(providerId: ProviderId, stdout: string): string {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) {
    return "";
  }

  if (providerId === "claude") {
    return cleaned;
  }

  const wholeDocument = tryParseJson(cleaned);
  if (wholeDocument !== undefined) {
    const extracted = extractPreferredText(providerId, wholeDocument);
    if (extracted) {
      return extracted;
    }
  }

  const linewiseJson = parseJsonLines(cleaned);
  if (linewiseJson.length > 0) {
    if (providerId === "gemini") {
      const geminiStreamText = extractGeminiStreamJsonText(linewiseJson);
      if (geminiStreamText !== undefined) {
        return geminiStreamText;
      }
    }

    const extracted = linewiseJson
      .map((entry) => extractPreferredText(providerId, entry))
      .filter((value): value is string => Boolean(value));
    const merged = dedupePreservingOrder(extracted).join("\n\n").trim();
    if (merged) {
      return merged;
    }
  }

  const fallback = extractGenericText(wholeDocument);
  return fallback || cleaned;
}

class StreamProcessor implements ProviderStreamProcessor {
  private readonly activeMessageIds = new Set<string>();
  private readonly completedMessageIds = new Set<string>();
  private readonly streamedMessageText = new Map<string, string>();
  private emittedAnyChat = false;
  private codexBuffer = "";
  private geminiBuffer = "";
  private plainStreamStarted = false;

  constructor(
    private readonly providerId: ProviderId,
    private readonly round?: number,
    private readonly speakerRole: PromptExecutionOptions["speakerRole"] = "reviewer",
    private readonly messageScope?: string,
    private readonly participantId?: string,
    private readonly participantLabel?: string
  ) {}

  private get syntheticMessageId(): string {
    return this.scopeCodexMessageId("message");
  }

  async handleStdout(text: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void> {
    if (this.providerId === "codex") {
      this.codexBuffer += text;
      let newlineIndex = this.codexBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.codexBuffer.slice(0, newlineIndex).trim();
        this.codexBuffer = this.codexBuffer.slice(newlineIndex + 1);
        if (line) {
          await this.handleCodexLine(line, emit);
        }
        newlineIndex = this.codexBuffer.indexOf("\n");
      }
      return;
    }

    if (this.providerId === "gemini") {
      this.geminiBuffer += text;
      let newlineIndex = this.geminiBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.geminiBuffer.slice(0, newlineIndex).trim();
        this.geminiBuffer = this.geminiBuffer.slice(newlineIndex + 1);
        if (line) {
          await this.handleGeminiLine(line, emit);
        }
        newlineIndex = this.geminiBuffer.indexOf("\n");
      }
      return;
    }

    if (this.providerId === "claude") {
      const cleaned = stripAnsi(text);
      if (!this.plainStreamStarted) {
        this.plainStreamStarted = true;
        await this.emitChatEvent("chat-message-started", this.syntheticMessageId, "", emit);
        if (!cleaned.trim()) {
          return;
        }
      }

      if (cleaned.trim()) {
        await this.emitChatEvent("chat-message-delta", this.syntheticMessageId, cleaned, emit);
      }
    }
  }

  async finalize(stdout: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void> {
    if (this.providerId === "codex" && this.codexBuffer.trim()) {
      await this.handleCodexLine(this.codexBuffer.trim(), emit);
      this.codexBuffer = "";
    }

    if (this.providerId === "gemini" && this.geminiBuffer.trim()) {
      await this.handleGeminiLine(this.geminiBuffer.trim(), emit);
      this.geminiBuffer = "";
    }

    if (this.plainStreamStarted && !this.completedMessageIds.has(this.syntheticMessageId)) {
      await this.emitChatEvent("chat-message-completed", this.syntheticMessageId, "", emit);
      return;
    }

    if (!this.emittedAnyChat) {
      const finalText = parseProviderFinalText(this.providerId, stdout);
      if (finalText) {
        await this.emitChatEvent("chat-message-started", this.syntheticMessageId, "", emit);
        await this.emitChatEvent("chat-message-delta", this.syntheticMessageId, finalText, emit);
        await this.emitChatEvent("chat-message-completed", this.syntheticMessageId, "", emit);
      }
    } else {
      for (const messageId of this.activeMessageIds) {
        if (!this.completedMessageIds.has(messageId)) {
          await this.emitChatEvent("chat-message-completed", messageId, "", emit);
        }
      }
    }
  }

  private async handleCodexLine(line: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const record = parsed as Record<string, unknown>;
    const eventType = typeof record.type === "string" ? record.type : "";
    const item = isObject(record.item) ? record.item : undefined;

    if (eventType === "turn.started") {
      await this.ensureStarted(this.syntheticMessageId, emit);
      return;
    }

    if (eventType === "item.started" && item?.type === "agent_message") {
      await this.ensureStarted(this.scopeCodexMessageId(item.id), emit);
      return;
    }

    if (eventType === "item.completed" && item?.type === "agent_message") {
      // Prefer the synthetic ID if it was already started via turn.started
      const messageId = this.activeMessageIds.has(this.syntheticMessageId)
        ? this.syntheticMessageId
        : this.scopeCodexMessageId(item.id);
      await this.ensureStarted(messageId, emit);
      if (typeof item.text === "string" && item.text.trim()) {
        await this.emitMissingMessageText(messageId, item.text, emit);
      }
      await this.emitChatEvent("chat-message-completed", messageId, "", emit);
      return;
    }

    if (eventType.endsWith("output_text.delta") && typeof record.delta === "string") {
      const messageId = this.scopeCodexMessageId(inferCodexMessageId(record));
      await this.ensureStarted(messageId, emit);
      await this.emitChatEvent("chat-message-delta", messageId, record.delta, emit);
      return;
    }

    if ((eventType.endsWith("output_text.done") || eventType.endsWith("message.completed")) && typeof record.text === "string") {
      const messageId = this.scopeCodexMessageId(inferCodexMessageId(record));
      await this.ensureStarted(messageId, emit);
      if (record.text.trim()) {
        await this.emitMissingMessageText(messageId, record.text, emit);
      }
      await this.emitChatEvent("chat-message-completed", messageId, "", emit);
    }
  }

  private async handleGeminiLine(line: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (!isObject(parsed)) {
      return;
    }

    const eventType = typeof parsed.type === "string" ? parsed.type : "";
    if (eventType === "message" && parsed.role === "assistant" && typeof parsed.content === "string") {
      await this.ensureStarted(this.syntheticMessageId, emit);
      if (parsed.content) {
        if (parsed.delta === true) {
          await this.emitChatEvent("chat-message-delta", this.syntheticMessageId, parsed.content, emit);
        } else {
          await this.emitMissingMessageText(this.syntheticMessageId, parsed.content, emit);
        }
      }
      return;
    }

    if (eventType === "result" && this.activeMessageIds.has(this.syntheticMessageId)) {
      await this.emitChatEvent("chat-message-completed", this.syntheticMessageId, "", emit);
    }
  }

  private scopeCodexMessageId(rawMessageId: unknown): string {
    const raw = typeof rawMessageId === "string" || typeof rawMessageId === "number"
      ? String(rawMessageId)
      : "message";
    const scope = this.messageScope || `round-${this.round ?? 0}`;
    return `${this.providerId}-${this.speakerRole ?? "reviewer"}-${scope}-${raw}`;
  }

  private async ensureStarted(messageId: string, emit: (event: RunEvent) => Promise<void> | void): Promise<void> {
    if (this.activeMessageIds.has(messageId) || this.completedMessageIds.has(messageId)) {
      return;
    }

    await this.emitChatEvent("chat-message-started", messageId, "", emit);
  }

  private async emitMissingMessageText(
    messageId: string,
    message: string,
    emit: (event: RunEvent) => Promise<void> | void
  ): Promise<void> {
    const current = this.streamedMessageText.get(messageId) ?? "";
    const suffix = computeMessageSuffix(current, message);
    if (!suffix) {
      return;
    }

    await this.emitChatEvent("chat-message-delta", messageId, suffix, emit);
  }

  private async emitChatEvent(
    type: "chat-message-started" | "chat-message-delta" | "chat-message-completed",
    messageId: string,
    message: string,
    emit: (event: RunEvent) => Promise<void> | void
  ): Promise<void> {
    this.emittedAnyChat = true;
    if (type === "chat-message-started") {
      this.activeMessageIds.add(messageId);
      if (!this.streamedMessageText.has(messageId)) {
        this.streamedMessageText.set(messageId, "");
      }
    } else if (type === "chat-message-delta") {
      const current = this.streamedMessageText.get(messageId) ?? "";
      this.streamedMessageText.set(messageId, current + message);
    } else if (type === "chat-message-completed") {
      this.activeMessageIds.delete(messageId);
      this.completedMessageIds.add(messageId);
    }

    await emit({
      timestamp: nowIso(),
      type,
      providerId: this.providerId,
      participantId: this.participantId,
      participantLabel: this.participantLabel,
      round: this.round,
      messageId,
      speakerRole: this.speakerRole ?? "reviewer",
      recipient: "All",
      message,
    });
  }
}

function inferCodexMessageId(record: Record<string, unknown>): string | undefined {
  const candidates = [record.item_id, record.itemId, record.id, record.output_index];
  const candidate = candidates.find((value) => typeof value === "string" || typeof value === "number");
  return candidate ? String(candidate) : undefined;
}

function extractPreferredText(providerId: ProviderId, value: unknown): string | undefined {
  switch (providerId) {
    case "gemini":
      return extractGeminiText(value) ?? extractGenericText(value);
    case "codex":
      return extractCodexText(value) ?? extractGenericText(value);
    default:
      return extractGenericText(value);
  }
}

function extractGeminiText(value: unknown): string | undefined {
  if (!isObject(value)) {
    return typeof value === "string" ? value.trim() || undefined : undefined;
  }

  const direct = firstNonEmptyText([
    value.response,
    value.text,
    isObject(value.output) ? value.output.text : undefined,
    isObject(value.result) ? value.result.response : undefined
  ]);
  if (direct) {
    return direct;
  }

  const candidatesText = extractGeminiCandidateParts(value.candidates);
  if (candidatesText) {
    return candidatesText;
  }

  return undefined;
}

function extractGeminiStreamJsonText(values: unknown[]): string | undefined {
  let sawStreamJsonEvent = false;
  let output = "";

  for (const value of values) {
    if (!isObject(value)) {
      continue;
    }

    const eventType = typeof value.type === "string" ? value.type : "";
    if (["init", "message", "tool_use", "tool_result", "error", "result"].includes(eventType)) {
      sawStreamJsonEvent = true;
    }

    if (eventType !== "message" || value.role !== "assistant" || typeof value.content !== "string") {
      continue;
    }

    output += value.delta === true ? value.content : computeMessageSuffix(output, value.content);
  }

  if (!sawStreamJsonEvent) {
    return undefined;
  }

  return output.trim();
}

function extractGeminiCandidateParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const texts: string[] = [];
  for (const candidate of value) {
    if (!isObject(candidate) || !isObject(candidate.content) || !Array.isArray(candidate.content.parts)) {
      continue;
    }

    for (const part of candidate.content.parts) {
      if (isObject(part) && typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text.trim());
      }
    }
  }

  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

function extractCodexText(value: unknown): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const item = isObject(value.item) ? value.item : undefined;
  if (item?.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
    return item.text.trim();
  }

  const eventType = typeof value.type === "string" ? value.type : "";
  if (
    (eventType.endsWith("output_text.done") || eventType.endsWith("message.completed")) &&
    typeof value.text === "string" &&
    value.text.trim()
  ) {
    return value.text.trim();
  }

  return undefined;
}

function extractGenericText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const texts = value
      .map((item) => extractGenericText(item))
      .filter((item): item is string => Boolean(item));
    return texts.length > 0 ? dedupePreservingOrder(texts).join("\n\n") : undefined;
  }

  if (!isObject(value)) {
    return undefined;
  }

  const preferredKeys = ["content", "message", "output", "result", "text"];
  for (const key of preferredKeys) {
    const extracted = extractGenericText(value[key]);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function firstNonEmptyText(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseJsonLines(text: string): unknown[] {
  const parsed: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const value = tryParseJson(trimmed);
    if (value !== undefined) {
      parsed.push(value);
    }
  }
  return parsed;
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function computeMessageSuffix(current: string, next: string): string {
  if (!next) {
    return "";
  }

  if (!current) {
    return next;
  }

  if (next === current || current.startsWith(next)) {
    return "";
  }

  if (next.startsWith(current)) {
    return next.slice(current.length);
  }

  return next.slice(sharedPrefixLength(current, next));
}

function sharedPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}
