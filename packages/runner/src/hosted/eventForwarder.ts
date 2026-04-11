/**
 * eventForwarder.ts
 *
 * Bridges the runner's internal StateHub / RunHub event streams to the hosted
 * outbound WebSocket client so the backend can fan out events to browsers.
 *
 * Usage:
 *   const dispose = startEventForwarding(client, ctx);
 *   // ... runner runs ...
 *   dispose(); // unsubscribe on shutdown
 */

import type { OutboundClientHandle } from "./outboundClient";
import type { RunnerContext } from "../runnerContext";

/**
 * Subscribe to StateHub and RunHub events and forward them as EventEnvelope
 * frames through the outbound WS client.
 *
 * Returns a disposer that unsubscribes from both hubs.
 */
export function startEventForwarding(
  client: OutboundClientHandle,
  ctx: RunnerContext
): () => void {
  // Forward state snapshots — StateHub already owns the snapshot value.
  const unsubscribeState = ctx.stateHub.onSnapshot((state) => {
    client.sendEvent({
      v: 1,
      event: "state_snapshot",
      payload: { state }
    });
  });

  // Forward per-run events — RunHub emits (runId, RunEvent) pairs.
  const unsubscribeRun = ctx.runHub.onEvent((runId, event) => {
    client.sendEvent({
      v: 1,
      event: "run_event",
      payload: { runId, event }
    });
  });

  return () => {
    unsubscribeState();
    unsubscribeRun();
  };
}
