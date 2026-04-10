import { SidebarState } from "@jafiction/shared";
import { WebSocket } from "ws";

export class StateHub {
  private readonly clients = new Set<WebSocket>();

  addClient(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on("close", () => {
      this.clients.delete(socket);
    });
  }

  broadcast(snapshot: SidebarState): void {
    const payload = JSON.stringify(snapshot);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
