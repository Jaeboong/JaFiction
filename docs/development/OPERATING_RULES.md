# Jasojeon Development Harness Operating Rules

## Dev Automation

One command brings up the full hosted dev loop (Postgres, Redis, backend, runner, web):

```bash
./scripts/dev-stack.sh
```

One command tears it all down (add `--all` to also stop containers):

```bash
./scripts/stop-dev-stack.sh
```

**First-run pairing flow**: On a clean checkout, `dev-stack.sh` will:
1. Create `packages/backend/.env.dev` from the template and exit — fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `COOKIE_SECRET`, then re-run.
2. On the next run, detect no device token and prompt for a pairing code. Open the backend URL, sign in, go to Settings → Devices → Add device, and paste the 8-character code. The runner pairs once and subsequent runs are non-interactive.

To skip individual components: `--no-backend`, `--no-runner`, `--no-web`, `--no-infra`. To skip the type-check gate: `--skip-check`.

---

## Deterministic Checks vs Live Dev Apply

### Deterministic Checks

Required deterministic checks must be:

- repeatable on a clean checkout
- credential-free
- non-interactive
- stable across local sessions

In this repository, the baseline deterministic command is:

```bash
./scripts/check.sh
```

This command covers:

- shared tests
- runner tests
- web build
- documentation link validation

### Live Dev Apply

Live dev apply means bringing the local web + runner stack into a usable state for manual verification.

Since Stage 11.7 (hosted-mode retirement of local mode) the runner no longer
runs an inbound HTTP server. The canonical entrypoint is:

```bash
./scripts/dev-stack.sh        # runner in hosted outbound mode + web vite
./scripts/status-dev-stack.sh
```

`./scripts/apply-dev-stack.sh` remains as a web-only restart helper; it
assumes the backend and runner are already running.

Do not treat live dev apply as a deterministic CI gate.

## WSL Node/NPM Rules

If you are in WSL, assume raw `npm` may be broken even when `node` works.

Preferred command order:

1. direct `./scripts/*.sh` entrypoints
2. `./scripts/with-npm.sh run ...`
3. raw `npm run ...` only when you already know that shell is healthy

Do not introduce new repo instructions that depend exclusively on raw `npm`.

## Runtime Metadata

Never commit runtime metadata from the dev harness.

Ignore:

- `.harness/**`
- local logs
- pid files
- machine-specific temporary output

## When To Run Which Command

Run this after every non-trivial change:

```bash
./scripts/check.sh
```

Run this when runner/web entrypoints, routing, sockets, or dev boot flow changed:

```bash
./scripts/dev-stack.sh
```

Run this to inspect current local status:

```bash
./scripts/status-dev-stack.sh
```

Run this to cleanly stop the local stack:

```bash
./scripts/stop-dev-stack.sh
```

## Human Review Is Mandatory When

- `packages/shared/src/core/orchestrator.ts` changes
- provider execution/auth behavior changes
- `packages/runner/src/index.ts` changes
- `packages/runner/src/hosted/**` changes
- WebSocket or runner session/auth boundary changes
- `scripts/**` changes execution semantics
- `package.json` changes validation or workflow entrypoints

## Review Checklist

- Did the change stay in the intended plane?
- Are deterministic checks sufficient for the change?
- Was live dev apply run when runtime entrypoints changed?
- Did the hosted outbound runner reconnect cleanly after a backend restart?
- Did the change make WSL execution safer or more fragile?
- Were README and harness docs updated when entrypoints changed?

## WebSocket 장애 대응 체크리스트

### 증상
- 브라우저 콘솔: `WebSocket connection to 'wss://.../ws/events' failed: WebSocket is closed before the connection is established.`
- 사용자 증상: 에이전트 대화 실행 시 이벤트가 도달하지 않음, 화면이 멈춤

### 재현 결정 트리
1. `./scripts/dev-stack.sh --skip-check` 로 로컬 부트
2. 브라우저 로그아웃 상태에서 `/ws/events` 접속 → 401 재현되는지
3. 재현되면 → 세션 쿠키/만료 경로 문제 (SocketHub 가 auth_expired 로 전이되어야 함)
4. 재현 실패면 → Nginx 프록시 헤더, 운영 전용 쿠키 도메인 scope, 백엔드 포트 등 환경 차이 점검

### 로그 grep 키워드 (운영 백엔드)
- `docker logs jasojeon-backend-1 | grep -E "/ws/events.*401|/api/ws-probe.*401|session_error"`
- `session_error` 필드는 `missing | expired | unknown` 중 하나 — 원인 분류에 사용
- `FST_ERR_CTP_BODY_TOO_LARGE` 가 나오면 bodyLimit 상향 필요 (현재 20MB)

### 클라이언트 상태 확인
- DevTools Application → Cookies: `jf_sid` 존재 여부
- DevTools Network → `/api/ws-probe`: 200 정상, 401 세션 만료, 500 서버 재기동 중
- SocketHub 상태머신: `idle → probing → connecting → open → reconnecting → auth_expired | network_error | closed`
- 재시도 상한 **5회** — 그 이상 호출이 반복되면 버그

### 운영 배포 주의
- `docker compose` 실행 시 **반드시 `--env-file .env.production` 플래그 포함**. 누락 시 postgres 환경변수가 빈 값이 되어 backend restart loop 발생 이력 있음.
- `DART_API_KEY` 등 필수 env 는 zod 스키마에 `min(1)` 로 강제되어 있어 누락 시 부팅 즉시 실패 (의도적).
