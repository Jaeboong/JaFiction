import * as assert from "node:assert/strict";
import test from "node:test";
import { AddressedRunMismatchError, RunSessionManager } from "../controller/runSessionManager";
import { RunInterventionAbortError } from "../core/types";

test("run session manager blocks reentry while a run is active", () => {
  const manager = new RunSessionManager();

  const sessionId = manager.start("alpha", "realtime");

  assert.equal(manager.snapshot().status, "running");
  assert.equal(manager.snapshot().projectSlug, "alpha");
  assert.match(sessionId, /.+/);
  assert.throws(() => manager.assertCanStart("alpha"), /already active/i);
  assert.throws(() => manager.assertCanStart("beta"), /only one run can be active/i);
});

test("paused run keeps its original intervention resolver until resumed", async () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "deepFeedback");

  const intervention = manager.waitForIntervention(sessionId, {
    projectSlug: "alpha",
    runId: "run-1",
    round: 2,
    reviewMode: "deepFeedback",
    coordinatorProvider: "codex"
  });

  assert.equal(manager.snapshot().status, "paused");
  assert.equal(manager.snapshot().runId, "run-1");
  assert.equal(manager.snapshot().round, 2);
  assert.throws(() => manager.assertCanStart("alpha"), /paused/i);
  assert.throws(
    () => manager.waitForIntervention(sessionId, { projectSlug: "alpha", runId: "run-2", round: 3, reviewMode: "deepFeedback", coordinatorProvider: "claude" }),
    /already waiting/i
  );

  assert.equal(manager.submitIntervention("run-1", "keep going"), "resumed");

  assert.equal(await intervention, "keep going");
  assert.equal(manager.snapshot().status, "running");
  assert.equal(manager.snapshot().runId, "run-1");
  assert.equal(manager.snapshot().reviewMode, "deepFeedback");

  manager.finish(sessionId);
  assert.deepEqual(manager.snapshot(), { status: "idle" });
});

test("running realtime session queues user messages until the current writer finishes", () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");

  manager.setRunId(sessionId, "run-1");

  assert.equal(manager.submitIntervention("run-1", "이 방향 말고 협업 중심으로 가자"), "queued");
  assert.deepEqual(manager.drainQueuedMessages(sessionId), ["이 방향 말고 협업 중심으로 가자"]);
  assert.deepEqual(manager.drainQueuedMessages(sessionId), []);
});

test("running realtime session aborts the active execution when intervention is submitted", () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");
  const executionController = new AbortController();

  manager.setRunId(sessionId, "run-1");
  manager.bindExecutionAbortController(sessionId, executionController);

  assert.equal(manager.submitIntervention("run-1", "이 문단은 넘기고 다음 섹션으로 가자"), "queued");
  assert.equal(executionController.signal.aborted, true);
  assert.equal(manager.abortSignal(sessionId).aborted, false);
  assert.ok(executionController.signal.reason instanceof RunInterventionAbortError);
  assert.deepEqual(manager.drainQueuedMessages(sessionId), ["이 문단은 넘기고 다음 섹션으로 가자"]);
});

test("running deep feedback session keeps intervention queued without aborting the active execution", () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "deepFeedback");
  const executionController = new AbortController();

  manager.setRunId(sessionId, "run-1");
  manager.bindExecutionAbortController(sessionId, executionController);

  assert.equal(manager.submitIntervention("run-1", "다음 사이클에서 협업을 더 강조해줘"), "queued");
  assert.equal(executionController.signal.aborted, false);
  assert.deepEqual(manager.drainQueuedMessages(sessionId), ["다음 사이클에서 협업을 더 강조해줘"]);
});

test("stale tabs cannot resume a paused run that belongs to a different run id", async () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");

  const intervention = manager.waitForIntervention(sessionId, {
    projectSlug: "alpha",
    runId: "run-1",
    round: 1,
    reviewMode: "realtime",
    coordinatorProvider: "codex"
  });

  assert.throws(
    () => manager.submitIntervention("run-2", "stale tab message"),
    (error: unknown) => error instanceof AddressedRunMismatchError && error.activeRunId === "run-1"
  );

  assert.equal(manager.snapshot().status, "paused");
  assert.equal(manager.submitIntervention("run-1", "fresh tab message"), "resumed");
  assert.equal(await intervention, "fresh tab message");
});

test("stale tabs cannot queue messages into a different active run", () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");
  manager.setRunId(sessionId, "run-1");

  assert.throws(
    () => manager.submitIntervention("run-2", "stale tab message"),
    (error: unknown) => error instanceof AddressedRunMismatchError && error.activeRunId === "run-1"
  );

  assert.deepEqual(manager.drainQueuedMessages(sessionId), []);
});

test("stale finish calls do not clear a newer session", () => {
  const manager = new RunSessionManager();
  const firstSessionId = manager.start("alpha", "realtime");

  manager.finish(firstSessionId);

  const secondSessionId = manager.start("beta", "deepFeedback");
  manager.finish(firstSessionId);

  assert.equal(manager.snapshot().status, "running");
  assert.equal(manager.snapshot().projectSlug, "beta");

  manager.finish(secondSessionId);
  assert.deepEqual(manager.snapshot(), { status: "idle" });
});

test("aborting a paused session resumes the waiter with an abort sentinel", async () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");

  const intervention = manager.waitForIntervention(sessionId, {
    projectSlug: "alpha",
    runId: "run-1",
    round: 4,
    reviewMode: "realtime",
    coordinatorProvider: "codex"
  });

  manager.abort("run-1");

  assert.equal(manager.snapshot().status, "aborting");
  assert.equal(manager.snapshot().runId, "run-1");
  assert.throws(() => manager.assertCanStart("alpha"), /aborting/i);
  assert.equal(await intervention, "/abort");
});

test("aborting a running session aborts its active signal", () => {
  const manager = new RunSessionManager();
  const sessionId = manager.start("alpha", "realtime");
  const signal = manager.abortSignal(sessionId);

  assert.equal(signal.aborted, false);

  manager.abort();

  assert.equal(manager.snapshot().status, "aborting");
  assert.throws(() => manager.assertCanStart("alpha"), /aborting/i);
  assert.equal(signal.aborted, true);
});
