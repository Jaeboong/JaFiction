/**
 * SocketHub — PR-2 / WS 장애 복구
 *
 * 단일 WS 연결 + 구독자 fan-out 싱글턴.
 * 두 소켓(state + run)을 하나로 통합하고, probe → connect → reconnect 상태머신을
 * 내장해 401 감지·백오프·최대 재시도 상한을 강제한다.
 */

export type SocketHubState =
  | "idle"
  | "probing"
  | "connecting"
  | "open"
  | "reconnecting"
  | "auth_expired"
  | "network_error"
  | "closed";

export type Unsubscribe = () => void;

type FramePredicate = (frame: unknown) => boolean;
type FrameCallback = (frame: unknown) => void;
type StateListener = (state: SocketHubState) => void;

interface Subscriber {
  readonly predicate: FramePredicate;
  readonly callback: FrameCallback;
}

const MAX_ATTEMPTS = 5;

function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 300 * 2 ** attempt);
  const jitter = Math.random() * 300;
  return base + jitter;
}

export class SocketHub {
  private _state: SocketHubState = "idle";
  private _baseUrl = "";
  private _socket: WebSocket | undefined;
  private _attempts = 0;
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed = false;

  private readonly _subscribers: Subscriber[] = [];
  private readonly _stateListeners: StateListener[] = [];

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getState(): SocketHubState {
    return this._state;
  }

  connect(baseUrl: string): void {
    if (this._disposed) {
      return;
    }
    if (this._state === "connecting" || this._state === "open") {
      return;
    }
    // 재시도 중 새 connect() → attempt 카운터 리셋
    this._attempts = 0;
    this._baseUrl = baseUrl;
    this._clearRetryTimer();
    void this._probe();
  }

  subscribe(predicate: FramePredicate, callback: FrameCallback): Unsubscribe {
    const sub: Subscriber = { predicate, callback };
    this._subscribers.push(sub);
    return () => {
      const idx = this._subscribers.indexOf(sub);
      if (idx !== -1) {
        this._subscribers.splice(idx, 1);
      }
    };
  }

  onStateChange(listener: StateListener): Unsubscribe {
    this._stateListeners.push(listener);
    return () => {
      const idx = this._stateListeners.indexOf(listener);
      if (idx !== -1) {
        this._stateListeners.splice(idx, 1);
      }
    };
  }

  dispose(): void {
    this._disposed = true;
    this._clearRetryTimer();
    this._closeSocket();
    this._subscribers.length = 0;
    this._stateListeners.length = 0;
    this._setState("closed");
  }

  // -------------------------------------------------------------------------
  // Internal: probe → WS open
  // -------------------------------------------------------------------------

  private async _probe(): Promise<void> {
    if (this._disposed) {
      return;
    }
    this._setState("probing");

    let probeOk: boolean;
    let is401: boolean;
    try {
      const res = await fetch(`${this._baseUrl}/api/ws-probe`, { credentials: "include" });
      if (res.status === 401) {
        probeOk = false;
        is401 = true;
      } else {
        probeOk = res.ok;
        is401 = false;
      }
    } catch {
      // 네트워크 에러
      probeOk = false;
      is401 = false;
    }

    if (this._disposed) {
      return;
    }

    if (is401) {
      this._setState("auth_expired");
      return;
    }

    if (!probeOk) {
      this._scheduleRetry();
      return;
    }

    this._openSocket();
  }

  private _openSocket(): void {
    if (this._disposed) {
      return;
    }
    this._setState("connecting");

    const wsUrl = this._toWsUrl(this._baseUrl, "/ws/events");
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "blob";
    this._socket = socket;

    socket.onopen = () => {
      if (this._socket !== socket) {
        return;
      }
      this._attempts = 0;
      this._setState("open");
    };

    socket.onmessage = async (ev) => {
      if (this._socket !== socket || this._disposed) {
        return;
      }
      let raw: string;
      try {
        raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      } catch {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      this._dispatch(parsed);
    };

    socket.onerror = () => {
      // onerror 는 항상 onclose 직전에 발생 — onclose 에서 처리
    };

    socket.onclose = (ev) => {
      if (this._socket !== socket) {
        return;
      }
      this._socket = undefined;
      if (this._disposed) {
        return;
      }
      // 정상 종료(code 1000)는 재연결 안 함
      if (ev.code === 1000) {
        this._setState("closed");
        return;
      }
      // 비정상 종료 → probe 후 분기
      void this._probeAfterClose();
    };
  }

  private async _probeAfterClose(): Promise<void> {
    if (this._disposed) {
      return;
    }

    let is401: boolean;
    let probeOk: boolean;
    try {
      const res = await fetch(`${this._baseUrl}/api/ws-probe`, { credentials: "include" });
      if (res.status === 401) {
        is401 = true;
        probeOk = false;
      } else {
        is401 = false;
        probeOk = res.ok;
      }
    } catch {
      is401 = false;
      probeOk = false;
    }

    if (this._disposed) {
      return;
    }

    if (is401) {
      this._setState("auth_expired");
      return;
    }

    if (probeOk) {
      this._setState("reconnecting");
    }
    this._scheduleRetry();
  }

  private _scheduleRetry(): void {
    if (this._disposed) {
      return;
    }
    if (this._attempts >= MAX_ATTEMPTS) {
      this._setState("network_error");
      return;
    }
    this._setState("reconnecting");
    const delay = backoffMs(this._attempts);
    this._attempts++;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = undefined;
      if (this._disposed) {
        return;
      }
      void this._probe();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Internal: dispatch frames
  // -------------------------------------------------------------------------

  private _dispatch(frame: unknown): void {
    // 배열 스냅샷으로 순회 중 unsubscribe 안전하게 처리
    const snapshot = [...this._subscribers];
    for (const sub of snapshot) {
      try {
        if (sub.predicate(frame)) {
          sub.callback(frame);
        }
      } catch {
        // 구독자 에러가 다른 구독자에게 영향 주지 않도록 swallow
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal: helpers
  // -------------------------------------------------------------------------

  private _setState(next: SocketHubState): void {
    if (this._state === next) {
      return;
    }
    this._state = next;
    const snapshot = [...this._stateListeners];
    for (const listener of snapshot) {
      try {
        listener(next);
      } catch {
        // swallow
      }
    }
  }

  private _closeSocket(): void {
    const socket = this._socket;
    this._socket = undefined;
    if (socket) {
      try {
        socket.close();
      } catch {
        // swallow
      }
    }
  }

  private _clearRetryTimer(): void {
    if (this._retryTimer !== undefined) {
      clearTimeout(this._retryTimer);
      this._retryTimer = undefined;
    }
  }

  private _toWsUrl(baseUrl: string, pathname: string): string {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = pathname;
    url.search = "";
    return url.toString();
  }
}

/** 모듈 레벨 싱글턴 — App 전체가 공유하는 단일 WS 연결 */
export const socketHub = new SocketHub();
