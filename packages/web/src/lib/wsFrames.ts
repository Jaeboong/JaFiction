import type { InterventionRequestPayload, RunEvent, SidebarState } from "@jasojeon/shared";

/**
 * Frame decoders that accept either the local WebSocket payload shape or the
 * hosted EventEnvelope shape (see packages/shared/src/core/hostedRpc.ts). The
 * web app uses a single socket (/ws/events) in hosted mode and two dedicated
 * sockets (/ws/state, /ws/runs/:runId) in local mode; both shapes should be
 * handled uniformly.
 *
 *   local /ws/state:       SidebarState
 *   local /ws/runs/:runId: { runId: string; event: RunEvent }
 *   hosted /ws/events:     EventEnvelope (discriminated on `event`)
 */

interface RunEventFramePayload {
  readonly runId: string;
  readonly event: RunEvent;
}

export function decodeRunEventFrame(raw: unknown): RunEventFramePayload | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const frame = raw as Record<string, unknown>;

  // Hosted envelope: { v, event: "run_event", payload: { runId, event } }
  if (frame["event"] === "run_event" && frame["payload"] && typeof frame["payload"] === "object") {
    const payload = frame["payload"] as Record<string, unknown>;
    const runId = payload["runId"];
    const event = payload["event"];
    if (typeof runId === "string" && event && typeof event === "object") {
      return { runId, event: event as RunEvent };
    }
    return undefined;
  }

  // Hosted envelope for other event kinds — not a run event.
  if ("event" in frame && typeof frame["event"] === "string" && "payload" in frame) {
    return undefined;
  }

  // Local shape: { runId, event }
  const runId = frame["runId"];
  const event = frame["event"];
  if (typeof runId === "string" && event && typeof event === "object") {
    return { runId, event: event as RunEvent };
  }
  return undefined;
}

export function decodeInterventionRequestFrame(raw: unknown): InterventionRequestPayload | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const frame = raw as Record<string, unknown>;

  // Hosted envelope: { v, event: "intervention_request", payload: { runId, prompt } }
  if (frame["event"] === "intervention_request" && frame["payload"] && typeof frame["payload"] === "object") {
    const payload = frame["payload"] as Record<string, unknown>;
    const runId = payload["runId"];
    const prompt = payload["prompt"];
    if (typeof runId === "string" && typeof prompt === "string") {
      return { runId, prompt };
    }
  }
  return undefined;
}

export function decodeSidebarStateFrame(raw: unknown): SidebarState | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const frame = raw as Record<string, unknown>;

  // Hosted envelope: state_snapshot
  if (frame["event"] === "state_snapshot" && frame["payload"] && typeof frame["payload"] === "object") {
    const payload = frame["payload"] as Record<string, unknown>;
    return payload["state"] as SidebarState | undefined;
  }

  // Other hosted envelope kinds — ignore for state hydration.
  if ("event" in frame && typeof frame["event"] === "string" && "payload" in frame) {
    return undefined;
  }

  // Local raw SidebarState.
  return raw as SidebarState;
}
