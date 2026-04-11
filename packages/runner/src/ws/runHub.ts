import { RunEvent } from "@jafiction/shared";
import { WebSocket } from "ws";

export class RunHub {
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly eventBuffer = new Map<string, string[]>();
  private readonly observers = new Set<(runId: string, event: RunEvent) => void>();

  /**
   * Subscribe to all run events across all runs. Returns an unsubscribe function.
   * Does not affect existing WebSocket clients.
   */
  onEvent(handler: (runId: string, event: RunEvent) => void): () => void {
    this.observers.add(handler);
    return () => { this.observers.delete(handler); };
  }

  addClient(runId: string, socket: WebSocket): void {
    const bucket = this.clients.get(runId) ?? new Set<WebSocket>();
    bucket.add(socket);
    this.clients.set(runId, bucket);

    const buffered = this.eventBuffer.get(runId);
    if (buffered?.length) {
      const replay = () => {
        for (const msg of buffered) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(msg);
          }
        }
      };
      if (socket.readyState === WebSocket.OPEN) {
        replay();
      } else {
        socket.once("open", replay);
      }
    }

    socket.on("close", () => {
      bucket.delete(socket);
      if (bucket.size === 0) {
        this.clients.delete(runId);
      }
    });
  }

  emit(runId: string, event: RunEvent): void {
    const payload = JSON.stringify({ runId, event });

    const buffer = this.eventBuffer.get(runId) ?? [];
    buffer.push(payload);
    this.eventBuffer.set(runId, buffer);

    for (const client of this.clients.get(runId) ?? []) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }

    for (const observer of this.observers) {
      observer(runId, event);
    }
  }

  clearBuffer(runId: string): void {
    this.eventBuffer.delete(runId);
  }
}
