# 2026-05-26 — 러너 invalid_or_revoked_token 자동 복구 (self-heal)

> **상태**: ✅ 완료 (2026-05-26)
> **커밋**: `f688014` feat(runner): invalid_or_revoked_token 자동 self-heal 추가
> **CI**: deploy-dev run [26414447386](https://github.com/Jaeboong/Jasojeon/actions/runs/26414447386) — success (2m24s)

## 완료 보고

### 변경 사항
- `packages/runner/src/hosted/outboundClient.ts` — `OutboundClientOptions` 에 `onAuthFailure` 추가, `auth_err` 핸들러에 `invalid_or_revoked_token` 전용 분기 (재연결 루프 진입 차단 후 controller 에 escalate)
- `packages/runner/src/index.ts` — `pairAndPersist` / `startInnerClient` 함수 추출, `connectToBackend` wrapper 패턴 재작성, `selfHealAttempted` 로 무한 루프 방지
- `packages/runner/src/test/outboundClient.test.ts` — unit test 2개 신규 (invalid_or_revoked_token 전용 경로 + 다른 reason 의 기존 authFailureCount 경로 유지)
- 변경 라인: +408 / -23 (plan 파일 포함)

### 검증
- check.sh: outboundClient 테스트 9개 (기존 7 + 신규 2) 전부 통과
- 베이스라인 EBUSY 실패 7건 (`insightsHandlers.lowConfidence.test.js` / `insightsHandlers.skipDart.test.js`) 은 Windows 환경 파일 잠금 기존 문제로 이번 변경과 무관 (git stash 베이스라인 비교로 확인)
- CI deploy-dev workflow: 자소전.shop 자동 배포 성공

### 사용자가 일어나서 할 행동
1. 자소전.shop 웹 UI 의 download 페이지에서 새 `-local` 바이너리(Windows) 다운로드
2. 기존 `jasojeon-runner-windows.exe` 종료 후 새 바이너리로 교체 실행
3. 새 바이너리가 stale 토큰을 감지하면 콘솔에 `device token revoked — clearing and re-pairing` 로그 출력 후 페어링 instructions 노출
4. 웹 UI 에서 `Connect` 클릭 한 번 → 새 토큰 발급 → `self-heal complete` 로그 후 정상 운영
- 시크릿스토어 수동 삭제 불필요. provider API key 등 다른 시크릿도 보존됨.

### 남은 후속
- prod 바이너리(`.com` embed) 는 main 휴면 상태라 자동 배포 안 됨. 사용자가 prod 도 self-heal 적용을 원하면 별도 plan 으로 develop → main 머지 시점 결정 필요.

---

## 배경

`packages/backend/src/ws/runnerSocket.ts:135` 가 토큰 해시 미일치 / `revoked_at` 있을 때 `auth_err reason=invalid_or_revoked_token` 으로 응답하면 현재 runner 는 동일 stale 토큰으로 `maxAuthFailures=3` 까지 재시도 후 give up 한다 (`packages/runner/src/hosted/outboundClient.ts:246-257`). DB drop/재초기화나 device 레코드 revoke 시 사용자는 바이너리를 재실행해도 영구히 끊긴 채로 남는다. self-heal 은 outboundClient 가 controller 에 신호를 던지고 controller 가 토큰 클리어 + 페어링 재진입 + outboundClient 재기동을 수행한다.

## 확정된 설계 결정

- **D-A**: handle identity 안정성을 위해 `connectToBackend` 가 외부 wrapper `OutboundClientHandle` 을 반환, 내부 `client` 참조를 swap. `main()` 의 `clients` 배열 시그니처 불변.
- **D-B**: outboundClient 의 trigger 분기는 `invalid_or_revoked_token` reason 에 한해 `options.onAuthFailure?.(reason)` 호출 + `closed=true` + `socket.close()`. 재연결 루프 진입 금지. 그 외 모든 reason (`invalid_json`, `missing_device_token`, `expected_auth_frame`, 기타) 은 기존 `authFailureCount` 누적 경로 유지.
- **D-C**: 루프 방지는 controller 레벨 단일 boolean `selfHealAttempted` per backend. self-heal 후 재기동된 인스턴스에서 또 `invalid_or_revoked_token` 발생 시 callback 무시 + fatal log + 해당 backend 건너뜀. outboundClient 내부 `authFailureCount` 와 의미를 섞지 않음.
- **D-D**: callback 진입 후 순서 — (1) `selfHealAttempted` 검사·세팅 → (2) `clearDeviceToken(backendUrl)` await → (3) 기존 inner client `close()` await → (4) 페어링 함수 재실행 → (5) 새 inner client 생성 + wrapper 의 inner 참조 swap + eventForwarder 재구독. 순서 어김 = stale 토큰 재로드 또는 이벤트 누락.

---

## 1. 변경 파일 목록

| 경로 | 변경 요지 |
|------|----------|
| `packages/runner/src/hosted/outboundClient.ts` | `OutboundClientOptions` 에 `onAuthFailure?: (reason: string) => void` 추가. `auth_err` 핸들러에서 `reason==="invalid_or_revoked_token"` 분기 → callback 호출 + closed=true + 재연결 중단. |
| `packages/runner/src/index.ts` | (a) `connectToBackend` 내부의 페어링 로직을 별도 함수 `pairAndPersist({backendUrl, ctx, logger, forceReclaim})` 로 추출. (b) `startInnerClient(...)` helper 함수 추출 — outboundClient 기동 + eventForwarder 구독을 묶음. (c) wrapper `OutboundClientHandle` 도입: inner 참조를 closure 변수로 유지하고 swap 가능. (d) `onAuthFailure` 콜백에서 self-heal 수행. `clearDeviceToken` import 추가. |
| `packages/runner/src/test/outboundClient.test.ts` | 신규 테스트 2개: (1) `invalid_or_revoked_token` 수신 시 `onAuthFailure` 콜백 호출 + 재연결 안 됨 검증. (2) 다른 reason 일 때 `onAuthFailure` 호출 안 됨 + 기존 `authFailureCount` 경로 유지. |

**신규 파일**: 없음 (selfHeal 풀 flow 통합 테스트는 dev-stack 시나리오로 위임).

**변경 없음**:
- `packages/runner/src/hosted/deviceTokenStore.ts` — `clearDeviceToken` 이미 존재, 그대로 사용.
- `packages/backend/src/ws/runnerSocket.ts` — wire format 변화 없음.
- `.github/workflows/deploy-dev.yml` — 별도 수정 없음. develop push 자동 트리거.

---

## 2. 단계별 구현 순서

### Step 1 — outboundClient 에 `onAuthFailure` callback 추가

파일: `packages/runner/src/hosted/outboundClient.ts`

- 시그니처 변경: `OutboundClientOptions` 에 옵셔널 필드 추가
  ```ts
  onAuthFailure?: (reason: string) => void;
  ```
  기존 호출처 영향 없음 (optional).
- `auth_err` 핸들러(현 `outboundClient.ts:246-257`) 분기 수정:
  - 새 분기 우선 — `reason==="invalid_or_revoked_token"` 이면:
    1. `log.error("[outboundClient] device token invalid or revoked — escalating to controller", { reason })`
    2. `closed = true; connected = false;`
    3. `clearHeartbeat();`
    4. `socket.close();`
    5. `resolveClose?.();`
    6. `options.onAuthFailure?.(reason);`
    7. `return;`
  - 그 외 reason 은 기존 `authFailureCount` 누적 로직 유지 (변경 없음).
- 의존성 방향: outboundClient → (callback 으로) controller. 역방향 import 없음.

### Step 2 — index.ts 페어링 흐름 함수 추출

파일: `packages/runner/src/index.ts`

현 `connectToBackend` (line 87–189) 의 페어링 분기 (line 94–158) 를 두 함수로 추출:

```ts
async function pairAndPersist(opts: {
  backendUrl: string;
  logger: Logger;
  forceReclaim?: boolean;
}): Promise<{ deviceToken: string; deviceId: string }>
```

- 책임:
  1. `forceReclaim` 이 true 면 시작부에 토큰/ID 로드 스킵, 곧장 `registerClaim` + `pollClaim` 흐름 (현 line 123–147 의 first-pair path) 진입.
  2. `forceReclaim` 이 false (정상 부팅) 면 현 line 94–158 로직 그대로 — load → resolve → registerClaim → 토큰 없으면 pollClaim, 있으면 `pollClaimNonBlocking` background.
  3. 성공 시 `saveDeviceToken` + `saveDeviceId` 호출 후 `{deviceToken, deviceId}` 반환.

```ts
function startInnerClient(opts: {
  backendUrl: string;
  deviceToken: string;
  ctx: RunnerContext;
  logger: Logger;
  onAuthFailure: (reason: string) => void;
}): { inner: OutboundClientHandle; dispose: () => void }
```

- 책임:
  1. `dispatcher = createRpcDispatcher(...)` (현 line 167)
  2. `startHostedOutboundClient({..., onRpc: dispatcher, onAuthFailure, logger})` (현 line 169)
  3. `disposeForwarding = startEventForwarding(inner, ctx)` (현 line 177)
  4. 반환 객체: `{ inner, dispose: () => { disposeForwarding(); } }` — inner.close 는 호출자가 별도 책임.

### Step 3 — `connectToBackend` 를 wrapper 패턴으로 재작성

파일: `packages/runner/src/index.ts`

- 함수 시그니처 불변 — 여전히 `Promise<OutboundClientHandle>` 반환. `main()` 의 호출자 영향 없음.
- 내부 구조:
  ```ts
  async function connectToBackend(opts): Promise<OutboundClientHandle> {
    let selfHealAttempted = false;
    let currentInner: OutboundClientHandle;
    let currentDispose: () => void;
    let permanentlyClosed = false;

    const initialPair = await pairAndPersist({ backendUrl, logger, forceReclaim: false });
    const initialDeviceToken = initialPair.deviceToken;

    await fetchAndCacheDartApiKey(backendUrl, initialDeviceToken).catch(...);

    const onAuthFailure = (reason: string) => {
      void handleSelfHeal(reason);
    };

    async function handleSelfHeal(reason: string): Promise<void> {
      if (permanentlyClosed) return;
      if (selfHealAttempted) {
        logger.error(`[runner][${backendUrl}] self-heal failed twice (reason=${reason}) — giving up on this backend`);
        permanentlyClosed = true;
        currentDispose();
        return;
      }
      selfHealAttempted = true;
      logger.warn(`[runner][${backendUrl}] device token revoked — clearing and re-pairing`);
      await clearDeviceToken(backendUrl);
      currentDispose();
      await currentInner.close().catch(() => {});
      let repaired: { deviceToken: string; deviceId: string };
      try {
        repaired = await pairAndPersist({ backendUrl, logger, forceReclaim: true });
      } catch (err) {
        logger.error(`[runner][${backendUrl}] re-pairing failed`, { error: String(err) });
        permanentlyClosed = true;
        return;
      }
      await fetchAndCacheDartApiKey(backendUrl, repaired.deviceToken).catch(() => {});
      const next = startInnerClient({
        backendUrl, deviceToken: repaired.deviceToken, ctx, logger, onAuthFailure
      });
      currentInner = next.inner;
      currentDispose = next.dispose;
      logger.info(`[runner][${backendUrl}] self-heal complete — new outbound client started`);
    }

    const first = startInnerClient({
      backendUrl, deviceToken: initialDeviceToken, ctx, logger, onAuthFailure
    });
    currentInner = first.inner;
    currentDispose = first.dispose;

    const wrapper: OutboundClientHandle = {
      close: async () => {
        permanentlyClosed = true;
        currentDispose();
        await currentInner.close();
      },
      isConnected: () => currentInner.isConnected(),
      sendEvent: (env) => currentInner.sendEvent(env),
    };
    return wrapper;
  }
  ```
- 의존성 방향: `index.ts → outboundClient.ts (startHostedOutboundClient, OutboundClientHandle)`, `index.ts → deviceTokenStore.ts (clearDeviceToken — 신규 import)`, `index.ts → pairingClient.ts (변경 없음)`.

### Step 4 — outboundClient unit 테스트 추가

파일: `packages/runner/src/test/outboundClient.test.ts`

- 테스트 1: `"invalid_or_revoked_token triggers onAuthFailure and stops reconnect"`
  - fake backend 가 1회 `{type:"auth_err", reason:"invalid_or_revoked_token"}` 송신.
  - `onAuthFailure` mock 콜백이 정확히 1회, reason 인자로 호출되는지 검증.
  - 클라이언트가 재연결 시도 안 함 확인.
  - `client.close()` 가 hang 없이 resolve 되는지.
- 테스트 2: `"other auth_err reasons keep existing authFailureCount path"`
  - reason 을 `"invalid_json"` 등으로 송신, `onAuthFailure` mock 호출되지 않음 검증.

---

## 3. 회귀 검증 시나리오

| 시나리오 | 기대 동작 | 검증 방법 |
|---------|----------|----------|
| 정상 페어링/연결 | 기존 flow 그대로. wrapper 도입해도 isConnected/sendEvent/close 동일 의미. | 기존 `outboundClient.test.ts` pass + dev-stack web UI Connect 확인. |
| 토큰 처음부터 없음 | `pairAndPersist({forceReclaim:false})` 가 first-pair 분기 진입, Connect 클릭 대기. | secrets.enc 삭제 후 runner 실행, web UI Connect. |
| 토큰 있지만 stale → self-heal | (a) outboundClient 가 reason 수신 → `onAuthFailure`. (b) controller 가 clearDeviceToken → 재페어링 → 새 client 기동. (c) 사용자 = web UI Connect 한 번. | dev-stack 통합: backend DB 에서 `UPDATE devices SET revoked_at = NOW()`. 로그에서 `device token revoked — clearing and re-pairing` + `self-heal complete` 확인. |
| self-heal 후에도 또 stale | `selfHealAttempted=true` 상태에서 두 번째 reason 수신 → `self-heal failed twice ... giving up` + `permanentlyClosed=true`. | unit 으로 두 번째 호출 무시 검증 가능, 또는 dev-stack 시나리오. |
| backend protocol error | `onAuthFailure` 호출 안 됨. 기존 `authFailureCount` 누적 경로 유지. | Step 4 의 테스트 2 로 단위 검증. |

---

## 4. 빌드/배포 흐름

- **트리거**: `develop` 브랜치 push → `.github/workflows/deploy-dev.yml` 자동.
- **빌드 산출물**: `packages/runner/dist-bin/` 4 플랫폼 바이너리. `-local` suffix, `BACKEND_URL=https://xn--9l4b13i8j.shop` embed.
- **사용자 배포 경로**: 자소전.shop web UI download 페이지가 `runnerDownload.ts` 의 `LOCAL_FILE_MAP` 으로 `-local` 바이너리 서빙.
- **첫 실행 시 자동 복구**:
  1. 사용자 기존 바이너리 종료
  2. 새 바이너리 다운로드 → 실행
  3. stale 토큰 감지 → `invalid_or_revoked_token` 수신 → 자동 clearDeviceToken + 페어링 흐름
  4. Runner 콘솔 `Open the web UI, log in, and click Connect` 출력
  5. 사용자 Connect 클릭 → 새 토큰 저장 → 새 outboundClient auth_ok → 정상
- **사용자 행동**: 새 바이너리 실행 + Connect 클릭 1회. 시크릿 수동 삭제 불필요.

---

## 5. 리스크 및 미해결 질문

| 항목 | 결정/대응 |
|------|----------|
| `pollClaim` 의 10분 timeout 동안 outboundClient 가 살아있어야 하는가? | 살아있을 필요 없음. self-heal 진입 시 `currentDispose() + currentInner.close()` 로 정리. `isConnected()` 일시적으로 false. Connect 후 복구. |
| `pairAndPersist` 가 `forceReclaim:true` 일 때 deviceId 처리 | `clearDeviceToken` 이 token + id 둘 다 삭제. backend 가 새 device row 생성. |
| `connectToBackend` shutdown race | `permanentlyClosed=true` 가드. 진행 중인 `pairAndPersist` long-poll 의 즉시 중단은 다음 plan. |
| `clearDeviceToken` 후 `pairAndPersist` 실패 | 토큰 영구 손실. acceptable — stale 토큰은 어차피 재사용 불가. |
| `resolveClose` idempotency | Promise resolve 는 두 번째 호출 무시. `closed=true` 게이트로 보호. |
| 멀티 backend 독립성 | `selfHealAttempted`/`permanentlyClosed` 가 closure 변수, backend 별 독립. `Promise.all` catch 로 격리. |

**미해결**: 없음.

---

## 부록: 핵심 코드 위치 참조

- outboundClient auth_err 분기점: `packages/runner/src/hosted/outboundClient.ts:246-257`
- runner index 페어링 분기: `packages/runner/src/index.ts:94-158`
- clearDeviceToken: `packages/runner/src/hosted/deviceTokenStore.ts:48`
- backend reason 종류: `packages/backend/src/ws/runnerSocket.ts:109,119,126,131-138`
- deploy-dev workflow: `.github/workflows/deploy-dev.yml:5-8` (트리거), `:57-62` (BACKEND_URL embed)
