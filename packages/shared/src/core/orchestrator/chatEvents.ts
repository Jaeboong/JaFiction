import { ProviderId, RunChatMessage, RunEvent } from "../types";

export function applyChatEvent(messages: Map<string, RunChatMessage>, event: RunEvent): void {
  if (!event.type.startsWith("chat-message-") || !event.messageId) {
    return;
  }

  const existing = messages.get(event.messageId);
  const message =
    existing ??
    {
      id: event.messageId,
      providerId: event.providerId,
      participantId: event.participantId,
      participantLabel: event.participantLabel,
      speaker: chatSpeakerLabel(event),
      speakerRole: event.speakerRole ?? "system",
      recipient: event.recipient,
      round: event.round,
      content: "",
      startedAt: event.timestamp,
      status: "streaming" as const
    };

  if (event.type === "chat-message-started") {
    message.startedAt = event.timestamp;
  }

  if (event.type === "chat-message-delta" && event.message) {
    message.content += event.message;
  }

  if (event.type === "chat-message-completed") {
    message.finishedAt = event.timestamp;
    message.status = "completed";
  }

  messages.set(event.messageId, message);
}

export function chatSpeakerLabel(event: RunEvent): string {
  if (event.speakerRole === "user") {
    return "You";
  }

  return event.participantLabel || providerLabel(event.providerId);
}

export function providerLabel(providerId?: ProviderId): string {
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
