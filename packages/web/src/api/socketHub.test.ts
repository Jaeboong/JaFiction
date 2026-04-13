/**
 * socketHub.test.ts — SocketHub 상태머신 + fan-out 테스트
 *
 * vi.useFakeTimers() 로 백오프 타이머를 제어하고,
 * global.WebSocket 을 mock 클래스로 대체해 소켓 이벤트를 시뮬레이션한다.
 */
import { describe, it, beforeEach, afterEach, vi, expect, type Mock } from "vitest";
import { SocketHub } from "./socketHub";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WsEventType = "open" | "message" | "close" | "error";

interface MockWsCloseInit {
  code?: number;
  reason?: string;
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  binaryType: string = "blob";

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private _closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  triggerOpen() {
    this.onopen?.(new Event("open"));
  }

  triggerMessage(data: unknown) {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: raw }));
  }

  triggerClose(init: MockWsCloseInit = {}) {
    const ev = new CloseEvent("close", { code: init.code ?? 1006, reason: init.reason ?? "" });
    this.onclose?.(ev);
  }

  triggerError() {
    this.onerror?.(new Event("error"));
  }

  close() {
    if (!this._closed) {
      this._closed = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Probe fetch mock helpers
// ---------------------------------------------------------------------------

function makeProbeOk(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function makeProbe401(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
}

function makeProbeNetworkError(): never {
  throw new TypeError("Failed to fetch");
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const BASE_URL = "https://example.com";

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: flush microtasks (await probe fetch resolution)
// ---------------------------------------------------------------------------
async function flush() {
  // Promise.resolve() x4 는 대부분의 async/await 체인을 드레인한다
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocketHub", () => {
  // 1. probe 200 → connect 성공 → state === "open"
  it("probe 200 → WS open → state becomes open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeProbeOk()));

    const hub = new SocketHub();
    hub.connect(BASE_URL);

    // probe 단계
    expect(hub.getState()).toBe("probing");

    await flush();

    // WS 연결 중
    expect(hub.getState()).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].triggerOpen();
    expect(hub.getState()).toBe("open");

    hub.dispose();
  });

  // 2. probe 401 → state === "auth_expired", WebSocket 생성자 호출 안 됨
  it("probe 401 → auth_expired, WebSocket never created", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeProbe401()));

    const hub = new SocketHub();
    const stateChanges: string[] = [];
    hub.onStateChange((s) => stateChanges.push(s));

    hub.connect(BASE_URL);
    await flush();

    expect(hub.getState()).toBe("auth_expired");
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(stateChanges).toContain("auth_expired");

    hub.dispose();
  });

  // 3. WS close 1006 → probe 200 → state === "reconnecting" → 백오프 후 재시도
  it("WS close 1006 + probe 200 → reconnecting then retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeProbeOk())  // 첫 번째 probe → open
      .mockResolvedValueOnce(makeProbeOk())  // close 후 probeAfterClose → reconnecting
      .mockResolvedValueOnce(makeProbeOk()); // 재시도 probe → 두 번째 WS 생성

    vi.stubGlobal("fetch", fetchMock);

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();

    MockWebSocket.instances[0].triggerOpen();
    expect(hub.getState()).toBe("open");

    // WS 비정상 종료
    MockWebSocket.instances[0].triggerClose({ code: 1006 });
    await flush();

    expect(hub.getState()).toBe("reconnecting");

    // 백오프 타이머 소진 → 재probe 발생
    await vi.runAllTimersAsync();
    await flush();
    // 두 번째 probe 완료 후 WS 생성
    await flush();

    // 두 번째 WS 생성
    expect(MockWebSocket.instances).toHaveLength(2);

    hub.dispose();
  });

  // 4. WS close 1006 → probe 401 → state === "auth_expired" 확정
  it("WS close 1006 + probe 401 → auth_expired, no retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeProbeOk())   // 첫 probe → open
      .mockResolvedValueOnce(makeProbe401()); // close 후 probe → auth_expired

    vi.stubGlobal("fetch", fetchMock);

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();

    MockWebSocket.instances[0].triggerOpen();
    MockWebSocket.instances[0].triggerClose({ code: 1006 });
    await flush();

    expect(hub.getState()).toBe("auth_expired");
    // 재시도 타이머 없음 → 타이머 소진해도 WS 추가 생성 없음
    await vi.runAllTimersAsync();
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);

    hub.dispose();
  });

  // 5. 5회 재시도 초과 → state === "network_error", 더 이상 재시도 안 함
  it("5 failed probes → network_error, stops retrying", async () => {
    // 모든 probe 네트워크 실패로 시뮬레이션
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const hub = new SocketHub();
    hub.connect(BASE_URL);

    // 5회 반복: probe 실패 → reconnecting → 타이머 → 다음 probe
    for (let i = 0; i < 5; i++) {
      await flush();
      await vi.runAllTimersAsync();
    }
    await flush();

    expect(hub.getState()).toBe("network_error");

    const instancesAfterStop = MockWebSocket.instances.length;
    // 추가 타이머를 소진해도 더 이상 시도 없음
    await vi.runAllTimersAsync();
    await flush();
    expect(MockWebSocket.instances).toHaveLength(instancesAfterStop);

    hub.dispose();
  });

  // 6. subscribe fan-out: 두 구독자에게 모두 프레임 전달
  it("fan-out delivers frame to all subscribers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeProbeOk()));

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();
    MockWebSocket.instances[0].triggerOpen();

    const received1: unknown[] = [];
    const received2: unknown[] = [];
    hub.subscribe(() => true, (f) => received1.push(f));
    hub.subscribe(() => true, (f) => received2.push(f));

    const frame = { event: "state_snapshot", payload: { state: {} } };
    MockWebSocket.instances[0].triggerMessage(frame);
    await flush();

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);

    hub.dispose();
  });

  // 7. subscribe 중 다른 구독자가 unsubscribe 해도 순회 안전
  it("unsubscribe during dispatch does not throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeProbeOk()));

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();
    MockWebSocket.instances[0].triggerOpen();

    const received: unknown[] = [];
    let unsub2: (() => void) | undefined;

    // sub1: 수신 시 sub2를 unsubscribe
    hub.subscribe(() => true, () => {
      unsub2?.();
    });
    unsub2 = hub.subscribe(() => true, (f) => received.push(f));

    // 예외 없이 처리되어야 함
    expect(() => {
      MockWebSocket.instances[0].triggerMessage({ event: "ping" });
    }).not.toThrow();

    hub.dispose();
  });

  // 8. P2-3: reconnecting 상태에서 connect() 재호출 → 중복 소켓 생성 없음
  it("connect() in reconnecting state resets and creates only one new WS", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeProbeOk())  // 첫 probe → open
      .mockResolvedValueOnce(makeProbeOk())  // close 후 probeAfterClose → reconnecting
      .mockResolvedValueOnce(makeProbeOk()); // 재connect 후 probe → new WS

    vi.stubGlobal("fetch", fetchMock);

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();

    MockWebSocket.instances[0].triggerOpen();
    expect(hub.getState()).toBe("open");

    // WS 비정상 종료 → reconnecting
    MockWebSocket.instances[0].triggerClose({ code: 1006 });
    await flush();
    expect(hub.getState()).toBe("reconnecting");

    // reconnecting 상태에서 connect() 재호출
    hub.connect(BASE_URL);
    await flush();

    // WS 인스턴스는 2개 (첫 번째 + 새로운 하나): 중복 없음
    expect(MockWebSocket.instances).toHaveLength(2);

    hub.dispose();
  });

  // 9. P2-3: auth_expired 상태에서 connect() 재호출 → probing 으로 리셋, 새 probe 시도
  it("connect() in auth_expired state resets to probing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeProbe401())  // 첫 probe → auth_expired
      .mockResolvedValueOnce(makeProbeOk());  // 재connect probe → open

    vi.stubGlobal("fetch", fetchMock);

    const hub = new SocketHub();
    hub.connect(BASE_URL);
    await flush();

    expect(hub.getState()).toBe("auth_expired");

    // auth_expired 에서 connect() 재호출 → probing 으로 전이해야 함
    hub.connect(BASE_URL);
    expect(hub.getState()).toBe("probing");

    await flush();

    // probe 200 성공 → connecting 상태로 진행
    expect(hub.getState()).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    hub.dispose();
  });

  // 10. dispose() → 모든 재연결 중단, 구독자 제거
  it("dispose stops reconnection and clears subscribers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const hub = new SocketHub();
    const stateChanges: string[] = [];
    hub.onStateChange((s) => stateChanges.push(s));

    let subCalled = false;
    hub.subscribe(() => true, () => { subCalled = true; });

    hub.connect(BASE_URL);
    await flush();

    hub.dispose();

    expect(hub.getState()).toBe("closed");

    // 타이머를 소진해도 추가 상태 변화 없음
    stateChanges.length = 0;
    await vi.runAllTimersAsync();
    await flush();
    expect(stateChanges).toHaveLength(0);
    expect(subCalled).toBe(false);
  });
});
