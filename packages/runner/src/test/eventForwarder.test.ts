/**
 * eventForwarder.test.ts
 *
 * Tests that startEventForwarding subscribes to StateHub and RunHub and
 * translates events into OutboundClientHandle.sendEvent calls.
 *
 * Uses real StateHub and RunHub (no mocks), since they are cheap to instantiate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StateHub } from "../ws/stateHub";
import { RunHub } from "../ws/runHub";
import { startEventForwarding } from "../hosted/eventForwarder";
import type { OutboundClientHandle } from "../hosted/outboundClient";
import type { RunnerContext } from "../runnerContext";
import { RunSessionManager } from "@jafiction/shared";
import type { EventEnvelope, SidebarState, RunEvent } from "@jafiction/shared";

// ---------------------------------------------------------------------------
// Minimal fake OutboundClientHandle
// ---------------------------------------------------------------------------
function makeFakeClient(): { client: OutboundClientHandle; sent: EventEnvelope[] } {
  const sent: EventEnvelope[] = [];
  const client: OutboundClientHandle = {
    close: async () => { /* no-op */ },
    isConnected: () => true,
    sendEvent: (envelope) => { sent.push(envelope); }
  };
  return { client, sent };
}

// ---------------------------------------------------------------------------
// Construct a minimal context with real hubs
// ---------------------------------------------------------------------------
function makeCtxWithHubs(): {
  ctx: RunnerContext;
  stateHub: StateHub;
  runHub: RunHub;
  runSessions: RunSessionManager;
} {
  const stateHub = new StateHub();
  const runHub = new RunHub();
  const runSessions = new RunSessionManager();
  // We only need stateHub, runHub, and runSessions on ctx for eventForwarder.
  const ctx = { stateHub, runHub, runSessions } as unknown as RunnerContext;
  return { ctx, stateHub, runHub, runSessions };
}

// ---------------------------------------------------------------------------
// A minimal SidebarState-shaped value (we cast — forwarder does not validate)
// ---------------------------------------------------------------------------
const fakeState = { workspaceOpened: false, extensionVersion: "0.0.0" } as unknown as SidebarState;
const fakeRunEvent = { type: "message_chunk", chunk: "hello" } as unknown as RunEvent;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("startEventForwarding", () => {
  it("forwards state_snapshot when StateHub broadcasts", () => {
    const { ctx, stateHub } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    stateHub.broadcast(fakeState);

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].event, "state_snapshot");
    assert.strictEqual(
      (sent[0] as Extract<EventEnvelope, { event: "state_snapshot" }>).payload.state,
      fakeState
    );
  });

  it("forwards run_event when RunHub emits", () => {
    const { ctx, runHub } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    runHub.emit("run-42", fakeRunEvent);

    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].event, "run_event");
    const payload = (sent[0] as Extract<EventEnvelope, { event: "run_event" }>).payload;
    assert.strictEqual(payload.runId, "run-42");
    assert.strictEqual(payload.event, fakeRunEvent);
  });

  it("stops forwarding after disposer is called", () => {
    const { ctx, stateHub, runHub, runSessions } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    const dispose = startEventForwarding(client, ctx);
    dispose();

    stateHub.broadcast(fakeState);
    runHub.emit("run-99", fakeRunEvent);

    const sessionId = runSessions.start("alpha", "realtime");
    runSessions.setRunId(sessionId, "run-99");
    void runSessions.waitForIntervention(sessionId, {
      projectSlug: "alpha",
      runId: "run-99",
      round: 1,
      reviewMode: "realtime",
      coordinatorProvider: "claude"
    });
    runSessions.finish(sessionId);

    assert.strictEqual(sent.length, 0, "no events should be sent after dispose");
  });

  it("handles multiple snapshots in sequence", () => {
    const { ctx, stateHub } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    stateHub.broadcast(fakeState);
    stateHub.broadcast({ ...fakeState, busyMessage: "working" } as unknown as SidebarState);

    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0].event, "state_snapshot");
    assert.strictEqual(sent[1].event, "state_snapshot");
  });

  it("handles run events across different run ids", () => {
    const { ctx, runHub } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    runHub.emit("run-1", fakeRunEvent);
    runHub.emit("run-2", fakeRunEvent);

    assert.strictEqual(sent.length, 2);
    const p0 = (sent[0] as Extract<EventEnvelope, { event: "run_event" }>).payload;
    const p1 = (sent[1] as Extract<EventEnvelope, { event: "run_event" }>).payload;
    assert.strictEqual(p0.runId, "run-1");
    assert.strictEqual(p1.runId, "run-2");
  });

  it("forwards intervention_request when RunSessionManager pauses for input", () => {
    const { ctx, runSessions } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    const sessionId = runSessions.start("alpha", "realtime");
    // fire-and-forget — the promise only resolves on intervention submission.
    void runSessions.waitForIntervention(sessionId, {
      projectSlug: "alpha",
      runId: "run-77",
      round: 2,
      reviewMode: "realtime",
      coordinatorProvider: "claude"
    });

    const interventionFrames = sent.filter((frame) => frame.event === "intervention_request");
    assert.strictEqual(interventionFrames.length, 1);
    const payload = (interventionFrames[0] as Extract<EventEnvelope, { event: "intervention_request" }>).payload;
    assert.strictEqual(payload.runId, "run-77");
    assert.match(payload.prompt, /round 2/);
  });

  it("forwards run_finished when RunSessionManager completes a run", () => {
    const { ctx, runSessions } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    const sessionId = runSessions.start("alpha", "realtime");
    runSessions.setRunId(sessionId, "run-88");
    runSessions.markRoundComplete(sessionId);
    runSessions.finishAddressedRun("run-88");

    const finishedFrames = sent.filter((frame) => frame.event === "run_finished");
    assert.strictEqual(finishedFrames.length, 1);
    const payload = (finishedFrames[0] as Extract<EventEnvelope, { event: "run_finished" }>).payload;
    assert.strictEqual(payload.runId, "run-88");
    assert.strictEqual(payload.status, "completed");
  });

  it("forwards run_finished with 'aborted' when a running session is aborted", () => {
    const { ctx, runSessions } = makeCtxWithHubs();
    const { client, sent } = makeFakeClient();

    startEventForwarding(client, ctx);

    const sessionId = runSessions.start("alpha", "realtime");
    runSessions.setRunId(sessionId, "run-99");
    runSessions.abort("run-99");
    // abort() transitions to "aborting" without clearing the session; finish()
    // is what actually clears it (mirrors the runsHandlers finally branch).
    runSessions.finish(sessionId);

    const finishedFrames = sent.filter((frame) => frame.event === "run_finished");
    assert.strictEqual(finishedFrames.length, 1);
    const payload = (finishedFrames[0] as Extract<EventEnvelope, { event: "run_finished" }>).payload;
    assert.strictEqual(payload.runId, "run-99");
    assert.strictEqual(payload.status, "aborted");
  });
});
