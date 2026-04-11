import { SidebarState } from "@jasojeon/shared";
import { WebSocket } from "ws";

export class StateHub {
  private readonly clients = new Set<WebSocket>();
  private readonly observers = new Set<(snapshot: SidebarState) => void>();

  addClient(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on("close", () => {
      this.clients.delete(socket);
    });
  }

  /**
   * Subscribe to snapshot broadcasts. Returns an unsubscribe function.
   * Does not affect existing WebSocket clients.
   */
  onSnapshot(handler: (snapshot: SidebarState) => void): () => void {
    this.observers.add(handler);
    return () => { this.observers.delete(handler); };
  }

  broadcast(snapshot: SidebarState): void {
    const payload = JSON.stringify(snapshot);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
    for (const observer of this.observers) {
      observer(snapshot);
    }
  }
}
