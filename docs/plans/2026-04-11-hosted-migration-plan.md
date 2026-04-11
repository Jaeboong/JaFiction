# 2026-04-11 Hosted Migration Plan

> 1인 self-host 검증 단계 한정. 멀티테넌시/과금/어드민은 비범위지만 스키마·라우팅은 확장 가능한 형태로 남긴다.

---

## 1. Overview

### 목표
- JaFiction 을 "호스티드 Web + 호스티드 Backend + 로컬 Runner" 하이브리드로 이전한다.
- 사용자는 브라우저로 호스티드 UI 에 Google 로그인하고, 자신의 로컬 머신에서 Runner 를 실행해 CLI 구독(`claude` / `codex` / `gemini`) 과 `~/.jafiction` 원고를 그대로 사용한다.
- 최종 상태: 웹 UI 는 로컬 러너 주소를 몰라도 되며, 백엔드가 `device_id` 기준으로 WS 릴레이를 수행한다.

### 비목표
- 멀티테넌시 운영(여러 유저 간 격리 UX, 과금, 쿼터).
- 관리자/감사 콘솔.
- Runner 자동 업데이트 파이프라인.
- LLM API 키의 서버 보관(키와 토큰은 전부 사용자 로컬에 머문다).
- 백엔드에서 LLM 직접 호출(백엔드는 CLI 를 실행하지 않는다).

### 최종 형상 요약
브라우저 ↔ 백엔드는 HTTPS + 쿠키 세션. 백엔드 ↔ 러너는 러너가 아웃바운드로 여는 단일 WSS. 브라우저가 내리는 모든 제품 API 요청은 백엔드가 화이트리스트 RPC 로 번역해 해당 유저의 러너로 포워딩하고, 러너의 런/상태 이벤트는 Redis pub/sub 를 거쳐 다시 브라우저 WS 로 팬아웃된다. Postgres 는 오직 메타데이터(유저, 세션, 디바이스, 프로젝트/런 인덱스)만 보유하며 원고 본문·리뷰 결과·API 키는 서버 디스크에 절대 쓰지 않는다.

---

## 2. Architecture

### 2.1 컴포넌트 다이어그램

```
Browser ──HTTPS──▶ Backend(Fastify) ──▶ Postgres (metadata only)
   ▲                    │  ▲
   │ WSS                │  │ Redis pub/sub  (user:{id}:events)
   │                    ▼  │
   └────────────── WS relay ◀──WSS outbound── Runner (hosted mode)
                                                │
                                                ├─ child_process: claude/codex/gemini
                                                └─ ForJobStorage (~/.jafiction)
```

- 브라우저는 백엔드 단 하나의 origin 만 안다.
- 러너는 인바운드 포트를 열지 않는다. 방화벽/NAT 뚫을 필요 없음.
- 로컬 모드(`packages/runner` 를 브라우저가 localhost 로 직접 붙던 기존 경로)는 플래그로 공존.

### 2.2 주요 플로우

**(A) 세션 부트스트랩**
1. 브라우저가 `/auth/google` 으로 OAuth 시작.
2. 백엔드가 `users` upsert → `sessions` 생성 → `HttpOnly` 쿠키(`jf_sid`) 발급.
3. 브라우저가 `/api/me` 를 호출해 현재 유저와 페어링된 `devices` 목록을 받는다.
4. 디바이스가 아직 없으면 페어링 플로우(Phase 5)로 진입.

**(B) 런 시작 + 스트림**
1. 브라우저: `POST /api/rpc` with `{ op: "start_run", payload }`.
2. 백엔드: 세션 쿠키 검증 → `user_id` 확인 → 해당 유저의 활성 디바이스 선택(단일 디바이스 가정) → 러너 WS 로 RPC envelope 전달.
3. 러너: 기존 `RunSessionManager.startRun()` 호출 → `RunHub` 이벤트를 outbound WS 로 `run_event` 래핑하여 전송.
4. 백엔드: 수신 이벤트를 Redis `user:{userId}:events` 채널에 publish.
5. 브라우저 WS(`/ws/events`): 해당 채널을 subscribe 중이므로 그대로 팬아웃 수신.

**(C) 파일 읽기 (화이트리스트 경유)**
1. 브라우저: `{ op: "read_file", payload: { path } }`.
2. 백엔드 RPC 핸들러: 스키마 검증 → 러너로 포워드.
3. 러너: `devices.workspace_root` 로 root-jail 검증 후 파일 내용 응답.
4. 백엔드: 응답을 그대로 브라우저에 반환. 서버 디스크에 쓰지 않음.

### 2.3 세션 라우팅 모델

- `device_id → WebSocket connection` 매핑은 백엔드 프로세스 메모리(+ Redis 하트비트)에 유지.
- 멀티 백엔드 인스턴스 확장 시: Redis 에 `device:{id}:node` 키로 소유 노드 기록 → 교차 노드 RPC 는 Redis request/reply 채널로 중계. 1인 MVP 에서는 단일 노드로 시작.
- 모든 RPC/이벤트 페이로드에 `user_id` 를 주입해 row-level 필터가 항상 강제되도록 한다.

### 2.4 로컬 모드와의 공존

- `packages/runner` 에 `JAFICTION_MODE=local|hosted` 환경 변수 추가.
- `local` 은 현행 유지(Express + 인바운드 WS + 쿠키 auth).
- `hosted` 는 인바운드 HTTP/WS 를 띄우지 않고 outbound WS 만 연결, 동일 `RunnerContext` 재사용.

---

## 3. Whitelist RPC Spec

### 3.1 Envelope

요청:
```
{ "op": string, "id": string, "payload": object }
```
응답:
```
{ "id": string, "ok": true,  "result": object }
{ "id": string, "ok": false, "error": { "code": string, "message": string } }
```

- `op` 는 아래 표에 정의된 값만 허용. 임의 문자열/동적 디스패치/`eval` 경로 없음.
- 모든 `payload` 와 `result` 는 `packages/shared/src/core/hostedRpc.ts` 에 정의되는 zod 스키마로 양쪽(백엔드·러너)에서 검증.
- 서버가 raw bash / stdin / shell 명령을 러너로 전달할 수 있는 경로는 존재하지 않는다. CLI 파라미터도 사전 정의 필드만.

### 3.2 초기 오퍼 세트

| op | 입력 요지 | 출력 요지 | 소스(러너 핸들러) |
|---|---|---|---|
| `get_state` | `{}` | `SidebarState` | `StateHub.snapshot` |
| `list_projects` | `{}` | `{ projects: ProjectSummary[] }` | `projectsRouter.list` |
| `get_project` | `{ slug }` | `ProjectDetail` | `projectsRouter.get` |
| `save_project` | `{ slug, patch }` | `ProjectDetail` | `projectsRouter.save` |
| `upload_document` | `{ slug, filename, contentBase64 }` | `{ docId }` | `projectsRouter.uploadDocument` |
| `delete_document` | `{ slug, docId }` | `{ ok: true }` | `projectsRouter.deleteDocument` |
| `list_runs` | `{ slug }` | `{ runs: RunSummary[] }` | `runsRouter.list` |
| `get_run_messages` | `{ runId, cursor? }` | `{ messages, nextCursor }` | `runsRouter.getMessages` |
| `start_run` | `{ slug, mode, inputs }` | `{ runId }` | `RunSessionManager.startRun` |
| `resume_run` | `{ runId }` | `{ ok: true }` | `RunSessionManager.resume` |
| `abort_run` | `{ runId, reason? }` | `{ ok: true }` | `RunSessionManager.abort` |
| `complete_run` | `{ runId }` | `{ ok: true }` | `RunSessionManager.complete` |
| `submit_intervention` | `{ runId, text }` | `{ ok: true }` | `RunSessionManager.submitIntervention` |
| `call_provider_test` | `{ provider }` | `{ ok, stdoutExcerpt }` | `providersRouter.test` |
| `save_provider_config` | `{ provider, config }` | `{ ok: true }` | `providersRouter.saveConfig` |
| `save_provider_api_key` | `{ provider, key }` | `{ ok: true }` | `providersRouter.saveKey` |
| `notion_connect` | `{ token, dbId }` | `{ ok: true }` | `profileRouter.notionConnect` |
| `notion_disconnect` | `{}` | `{ ok: true }` | `profileRouter.notionDisconnect` |
| `opendart_save_key` | `{ key }` | `{ ok: true }` | `openDartRouter.saveKey` |
| `opendart_test` | `{ corpName }` | `{ ok, sample }` | `openDartRouter.test` |
| `read_file` | `{ path }` | `{ contentBase64 }` | 신규 file RPC(root-jail) |
| `write_file` | `{ path, contentBase64 }` | `{ ok: true, bytes }` | 신규 file RPC(root-jail) |
| `list_workspace_files` | `{ subdir? }` | `{ entries }` | 신규 file RPC(root-jail) |

- `call_provider_test` / `save_provider_api_key` 는 러너에서만 처리되며 key 는 `FileSecretStore` 로 로컬 저장된다. 서버는 저장 여부 플래그만 안다.
- `upload_document` 의 `contentBase64` 는 백엔드 메모리에서만 잠시 머물고 즉시 러너로 포워딩된다. 서버 디스크에 쓰지 않는다.
- 각 op 의 실제 타입은 기존 `packages/web/src/api/client.ts` 와 `packages/shared/src/core/schemas.ts` 의 타입을 재활용한다.

---

## 4. Event Stream Spec

러너 → 백엔드 방향의 비동기 이벤트(outbound WS 동일 채널에서 multiplexing).

| event | payload | 출처 |
|---|---|---|
| `state_snapshot` | `{ state: SidebarState }` | `StateHub` broadcast |
| `run_event` | `{ runId, event: RunEvent }` | 기존 `RunHub` 이벤트를 그대로 래핑 |
| `intervention_request` | `{ runId, prompt }` | `RunSessionManager` 개입 요청 훅 |
| `run_finished` | `{ runId, status, summary? }` | 런 종료 시 한 번 |

- 백엔드는 event 를 받으면 `users.id` 기준으로 Redis 채널 `user:{userId}:events` 에 publish.
- 브라우저 WS(`/ws/events`) 는 로그인 세션 소유 유저 채널을 subscribe 중이므로 같은 envelope 가 팬아웃된다.
- `RunEvent` 스키마는 기존 `packages/shared/src/core/schemas.ts` 를 단일 소스로 사용. 전송 계층만 바뀐다.
- 재연결 시 `RunHub` 의 per-run replay buffer 를 재활용해 `run_event` 재전송 지원.

---

## 5. Postgres Schema

모든 테이블은 메타데이터 전용. 원고 본문·런 메시지 바디·리뷰 상세·프로바이더 키는 절대 저장하지 않는다.

### 5.1 테이블

```
users (
  id          uuid primary key,
  google_sub  text unique not null,
  email       text not null,
  created_at  timestamptz not null default now()
)

sessions (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  cookie_hash   text not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
)

devices (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  label           text not null,
  workspace_root  text not null,
  token_hash      text not null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz
)

projects_meta (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  device_id     uuid not null references devices(id) on delete cascade,
  slug          text not null,
  company_name  text,
  updated_at    timestamptz not null default now(),
  unique (user_id, device_id, slug)
)

runs_meta (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  device_id     uuid not null references devices(id) on delete cascade,
  project_slug  text not null,
  run_id        text not null,
  status        text not null,
  review_mode   text not null,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  unique (device_id, project_slug, run_id)
)
```

### 5.2 인덱스

- `devices (user_id)`
- `runs_meta (user_id, started_at desc)`
- `projects_meta (user_id, updated_at desc)`
- `sessions (expires_at)` — 만료 GC 용.

### 5.3 멀티테넌시 포인트

- 모든 product 테이블에 `user_id` 가 선재되어 있어 나중 row-level security 전환이 단순 ALTER + policy 로 가능.
- 백엔드 RPC 라우터는 `req.session.user_id` 를 모든 쿼리/이벤트 publish 에 강제 주입한다. `user_id` 없는 경로는 타입상 존재하지 않도록 핸들러 시그니처로 묶는다.

---

## 6. Phased Implementation Plan

각 phase 는 1–3일 분량으로 resumable. Phase 별로 Objective / Touched files / Acceptance / Risks & rollback 을 기재한다.

### Phase 0 — DOMPurify XSS 잠금 & backend 워크스페이스 부트스트랩
- **Objective**: `RunsPage.tsx` 의 `dangerouslySetInnerHTML` 경로를 DOMPurify 로 감싸 호스티드 전환 이전 XSS 리스크를 차단하고, 빈 `packages/backend` 워크스페이스를 만든다.
- **Touched files**: `packages/web/package.json`, `packages/web/src/pages/RunsPage.tsx`, `packages/web/src/lib/markdown.ts`(신규 또는 기존 util), `package.json`(workspaces), `packages/backend/package.json`(stub).
- **Acceptance**: `./scripts/check.sh` 통과. 기존 렌더 스냅샷 테스트가 sanitized HTML 로 갱신. `packages/backend` 가 빈 `tsc --noEmit` 성공.
- **Risks / rollback**: DOMPurify 가 특정 마크다운 구조를 과도 제거할 수 있음 → allow-list 설정 테스트 추가. Rollback 은 패키지 제거 + import 되돌리기.

### Phase 1 — Shared RPC envelope + zod 스키마
- **Objective**: `packages/shared/src/core/hostedRpc.ts` 에 envelope 와 op 별 입출력 스키마를 정의, 기존 `schemas.ts` 의 타입을 재수출.
- **Touched files**: `packages/shared/src/core/hostedRpc.ts`(신규), `packages/shared/src/index.ts`.
- **Acceptance**: 모든 op 에 대해 `parse` round-trip 단위 테스트. `RpcRequest`/`RpcResponse` 유니온 타입이 exhaustive 로 좁혀짐(`never` 검사 테스트).
- **Risks / rollback**: 스키마 확장 시 리펙터 비용 → 버저닝 필드 `v: 1` 포함.

### Phase 2 — 러너 hosted-mode outbound WS 클라이언트
- **Objective**: `JAFICTION_MODE=hosted` 시 러너가 인바운드 서버를 띄우지 않고 백엔드 URL 로 WSS 를 연결, 디바이스 토큰으로 핸드셰이크.
- **Touched files**: `packages/runner/src/index.ts`, `packages/runner/src/hosted/outboundClient.ts`(신규), `packages/runner/src/secretStore.ts`(token 네임스페이스 추가).
- **Acceptance**: 모의 WS 서버 상대로 연결/재연결/핑퐁/토큰 거절 케이스 테스트 통과. 로컬 모드 회귀 없음(`./scripts/apply-dev-stack.sh`).
- **Risks / rollback**: 재연결 백오프 버그 → 지수 백오프 + jitter, 상한 60s.

### Phase 3 — 러너 RPC 디스패처
- **Objective**: 기존 `routes/*Router.ts` 핸들러를 얇은 RPC wrapper 로 감싸 `op → handler` 맵을 만든다. 로컬 모드는 여전히 Express 라우터 경유, hosted 모드는 dispatcher 경유.
- **Touched files**: `packages/runner/src/hosted/rpcDispatcher.ts`(신규), `packages/runner/src/routes/*`(공유 핸들러 추출), `packages/runner/src/runnerContext.ts`.
- **Acceptance**: 각 op 에 대해 dispatcher 단위 테스트(mock RunnerContext). 비허용 `op` 는 `error.code = "unknown_op"` 로 거절.
- **Risks / rollback**: 핸들러 중복 경로 → 단일 함수로 추출 후 양쪽이 import.

### Phase 4 — Backend 패키지 스캐폴딩
- **Objective**: `packages/backend` 에 Fastify/Hono 중 택1, Postgres(`pg` + `drizzle-kit` 또는 `node-pg-migrate`), Redis(`ioredis`), Google OAuth 연결.
- **Touched files**: `packages/backend/**` 전부, `scripts/apply-dev-stack.sh`(backend 기동 추가), `scripts/check.sh`(타입체크 포함).
- **Acceptance**: `/healthz`, `/auth/google`, `/auth/google/callback`, `/api/me` 엔드포인트가 E2E 테스트에서 쿠키 세션으로 왕복 성공. `users`/`sessions` 마이그레이션 적용.
- **Risks / rollback**: OAuth 리디렉트 URI 등록 누락 → `.env.example` 에 명시. DB 부재 시 기동 실패 UX 명확히.

### Phase 5 — 디바이스 페어링 플로우
- **Objective**: 웹 UI 가 6자리 페어링 코드 + 워크스페이스 루트 입력 폼을 제공 → 러너 CLI 가 해당 코드를 입력하고 토큰 교환 → `devices` row 생성.
- **Touched files**: `packages/backend/src/routes/devices.ts`(신규), `packages/web/src/pages/DevicesPage.tsx`(신규), `packages/runner/src/hosted/pairing.ts`(신규), `packages/runner/src/secretStore.ts`.
- **Acceptance**: 페어링 코드 TTL(기본 10분) 경과 시 거절, 재사용 거절. 토큰은 `FileSecretStore` 에 namespace `hosted.deviceToken` 으로 저장.
- **Risks / rollback**: 코드 brute-force → 레이트 리미트(유저별 5회/10분) + `devices.token_hash` bcrypt.

### Phase 6 — 백엔드 ↔ 러너 WS 릴레이 & 세션 라우팅
- **Objective**: 백엔드가 `device_id` 기준 연결 맵을 유지하고 브라우저 RPC 를 해당 러너로 포워드, 러너 이벤트를 Redis 로 publish.
- **Touched files**: `packages/backend/src/ws/deviceHub.ts`(신규), `packages/backend/src/rpc/dispatch.ts`(신규), `packages/backend/src/events/fanout.ts`(신규).
- **Acceptance**: 통합 테스트에서 브라우저 ↔ 백엔드 ↔ 러너(mock) 왕복 `start_run` 성공, `run_event` 브라우저 WS 수신 확인. 러너 연결 끊김 시 큐잉/타임아웃 동작 테스트.
- **Risks / rollback**: 메모리 누수(미회수 pending RPC) → id 당 TTL + abort 훅.

### Phase 7 — Web 클라이언트 호스티드 전환
- **Objective**: `packages/web/src/api/client.ts` 의 base URL 을 환경 변수로, WS URL 을 `/ws/events` 단일 엔드포인트로 전환. 쿠키는 `SameSite=Lax; Secure` + 백엔드 도메인.
- **Touched files**: `packages/web/src/api/client.ts`, `packages/web/src/ws/*`, `packages/web/vite.config.ts`, `packages/web/.env.example`.
- **Acceptance**: 호스티드 모드에서 로컬 러너 URL 노출 없음. 기존 페이지들 전부 로드/런 수행.
- **Risks / rollback**: 쿠키 도메인 mismatch → 동일 origin 전략 또는 정확한 `Domain` 설정 문서화.

### Phase 8 — 파일 RPC root-jail
- **Objective**: `read_file`/`write_file`/`list_workspace_files` 를 `devices.workspace_root` 하위로만 제한, path traversal 테스트 추가.
- **Touched files**: `packages/runner/src/hosted/fileRpc.ts`(신규), `packages/shared/src/core/storagePaths.ts`.
- **Acceptance**: `..` traversal, 절대경로, 심볼릭 링크, 대문자 대소 혼동 케이스 거절. 단위 테스트 커버리지 95% 이상.
- **Risks / rollback**: 플랫폼 별 경로 정규화 차이 → Node `path.resolve` + `realpath` 이후 prefix 비교.

### Phase 9 — 관측/보안 경화
- **Objective**: 엄격한 CSP 헤더, 응답/로그의 secret redaction, 세션 라우팅 회귀 테스트.
- **Touched files**: `packages/backend/src/security/csp.ts`(신규), `packages/backend/src/logging/redact.ts`(신규), `packages/runner/src/hosted/outboundClient.ts`(로그 필터).
- **Acceptance**: `default-src 'none'; script-src 'self'; ...` 적용 후 브라우저 페이지 정상 로드. 로그에 `sk-`/`ghp_`/`AIza` 패턴 자동 마스킹 테스트.
- **Risks / rollback**: CSP 가 inline 스타일을 깨뜨림 → 필요한 곳만 nonce 허용.

### Phase 10 — 배포 스모크
- **Objective**: Fly.io 또는 Railway 로 백엔드 + Postgres + Redis 를 배포하고 E2E 스모크(로그인 → 페어링 → `start_run` → 이벤트 수신)를 수행한다.
- **Touched files**: `packages/backend/Dockerfile`, `fly.toml` 또는 `railway.json`, `docs/deploy/README.md`.
- **Acceptance**: 배포 환경에서 1회 완전한 리뷰 런 성공. 백엔드 재시작 후 세션 유지 확인.
- **Risks / rollback**: WSS TLS 종료 구성 오류 → provider 문서 기반 헬스체크 확장.

---

## 7. Security Checklist

- [ ] 모든 RPC 가 `op` 화이트리스트 + zod 스키마 양쪽 검증을 통과 (Phase 1, 3, 6).
- [ ] 파일 RPC 가 `workspace_root` root-jail 을 벗어나지 않음 (Phase 8).
- [ ] 디바이스 토큰은 TTL, refresh, revoke 경로를 모두 보유 (Phase 5, 9).
- [ ] DOMPurify 로 마크다운 렌더 XSS 차단 (Phase 0).
- [ ] 엄격한 CSP 가 호스티드 origin 에 적용 (Phase 9).
- [ ] 로그에서 API 키/토큰/이메일 redaction (Phase 9).
- [ ] 러너 자동 업데이트 경로는 도입하지 않음(사용자가 수동 pull) (모든 Phase).
- [ ] 세션 라우팅(`user_id → device_id → ws`) 회귀 테스트가 CI 에 포함 (Phase 6, 9).

---

## 8. Open Questions

1. **백엔드 프레임워크**: Fastify(풍부한 플러그인) vs Hono(경량·엣지 친화). 현재 성향상 Fastify 우세, 배포 플랫폼 결정 후 확정.
2. **배포 플랫폼**: Fly.io(머신 단위, WSS 친화) vs Railway(UX). Postgres/Redis 통합 비용으로 판단.
3. **디바이스 토큰 저장소**: 1차는 `FileSecretStore` 재사용(네임스페이스 `hosted.deviceToken`), 2차로 OS 키체인 검토.
4. **페어링 코드 포맷**: 6자리 숫자 vs 8자리 base32. TTL 기본 10분, 재시도 5회/10분.
5. **Postgres 마이그레이션 도구**: `drizzle-kit`(타입 통합) vs `node-pg-migrate`(단순). 스키마 타입 재사용 필요성으로 `drizzle-kit` 우세.
6. **오프라인 디바이스 정책**: 백엔드 RPC 가 러너 미연결 상태를 만나면 즉시 `device_offline` 에러로 실패할지, 짧은 큐잉(기본 5초)을 허용할지. MVP 는 즉시 실패 + 재시도 UI 로 결정 후 재검토.
