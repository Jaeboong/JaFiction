# Jasojeon Development Harness Architecture

## Goal

Keep Jasojeon's repository-level validation, execution entrypoints, and review scaffolding separate from the shipped web/runner product runtime.

## The Two-Plane Model

This repository has two different planes.

### 1. Product Plane

The product plane is the software users actually run.

- `packages/shared/**` contains orchestration, storage, schemas, and shared view models
- `packages/runner/**` contains the hosted-mode outbound runner (connects to the backend via an outbound WebSocket and dispatches RPC; no inbound HTTP server)
- `packages/web/**` contains the React + Vite browser UI

Changes in this plane affect runtime behavior and need stronger review plus local smoke validation.

### Hosted Runner Trust Boundary

Local mode was retired in Stage 11.7. The runner no longer exposes an inbound HTTP or WebSocket server. Its only network surface is an outbound WebSocket to the configured backend, authenticated with a persisted device token produced by the pairing flow.

- The runner boots in one of two modes: `JASOJEON_MODE=pair` (one-shot pairing) or `JASOJEON_MODE=hosted` (default; outbound RPC dispatch).
- All browser-originated RPC flows through the backend at `/api/rpc`, protected by the normal backend session cookie.
- Runner secret storage is hardened with either `JASOJEON_SECRET_PASSPHRASE` or a machine-local key file under `~/.jasojeon/secret.key`, with legacy predictable-seed blobs migrated forward on read.

### 2. Development-Harness Plane

The development-harness plane exists to make local development safer and more repeatable.

- `docs/development/**` documents operating rules
- `docs/plans/**` captures design and implementation planning
- `tools/**` contains deterministic validators
- `scripts/**` contains safe execution and dev apply entrypoints
- `.github/**` contains review scaffolding
- root `package.json` exposes convenience aliases

Harness changes are lower risk to user behavior, but they still change how contributors build, validate, and operate the repo.

## Official Entrypoints

The official entrypoints for this repository are the shell scripts under `scripts/`.

Important examples:

- `./scripts/check.sh`
- `./scripts/dev-stack.sh` — canonical hosted-mode local dev entrypoint (runner outbound + web)
- `./scripts/apply-dev-stack.sh` — web-only dev apply (assumes backend + runner are already running)
- `./scripts/status-dev-stack.sh`
- `./scripts/stop-dev-stack.sh`
- `./scripts/with-node.sh`
- `./scripts/with-npm.sh`

`package.json` should stay a thin alias layer over these scripts rather than being the only source of truth.

## WSL Node Strategy

WSL environments in this repo may have a working `node` but a broken `npm` shim.

Because of that, the harness follows two rules:

- never trust raw `npm` as the only official entrypoint
- always resolve a usable `node` first, then execute either a real `npm-cli.js` or direct CLI JS files

This keeps dev workflows stable even when the shell PATH contains a broken `npm`.

## Dev Apply Flow

Local dev = docker compose backend + local runner in hosted mode + web vite.

The canonical flow is:

```text
docker compose up backend postgres redis       # user runs separately
./scripts/dev-stack.sh                          # runner (hosted) + web + status
```

The dev harness persists runtime metadata under `.harness/`:

- `.harness/pids/runner.pid` (written by dev-stack.sh when it launches the runner)
- `.harness/pids/web.pid`
- `.harness/logs/runner.log`
- `.harness/logs/web.log`

## 인사이트 파이프라인 (2026-04-15 갱신)

인사이트 생성은 3-tier 소스 집합에서 LLM 합성으로 진행된다.

```
generateProjectInsightsService (insightsHandlers.ts)
  │
  └─ collectCompanyContext (shared/core/companyContext/index.ts)
        ├─ fetchDartSource   — OpenDART resolve/fetch 래퍼
        ├─ fetchWebSource    — WebSearchProvider (Naver/Brave) + 캐시
        └─ derivePostingSource — project 필드에서 role 스니펫 파생 (외부 호출 없음)
  │
  ├─ ambiguous → reviewNeeded (OpenDartCandidateModal 플로우 그대로 유지)
  ├─ user skip → dart unavailable (`dart: skipped by user`) 로 기록하고 web+posting tier 로 계속 진행
  ├─ resolved  → project corpCode/corpName persist
  │
  └─ generateCompanyAnalysisPhase → buildCompanyAnalysisPrompt (Source Tier Rules 포함)
```

사용자가 회사 선택 모달에서 "일치하는 회사 없음 (DART 없이 진행)"을 선택하면 `openDartSkipRequested=true` 가 저장된다. 이 플래그가 켜진 상태의 재생성은 DART 조회를 다시 시도하지 않고 `unavailable` 해상도로 처리하며, `companyName` 이 바뀌면 skip/candidate 상태를 함께 초기화한다.

### Source Tier Rules

프롬프트에 tier 규칙이 명시되어 있다:
- `factual` (DART 공시) → 사실 근거, 최우선
- `contextual` (웹/뉴스) → 최근 이슈/포지션, factual과 충돌 시 패배
- `role` (공고 파생) → 직무 책임/자격요건 전용

### WebSearch Feature Flag

`runner.json`의 `webSearch.enabled` 기본값은 `false`. 활성화 시:
- `NAVER_CLIENT_ID` + `NAVER_CLIENT_SECRET` (Naver provider)
- `BRAVE_API_KEY` (Brave provider)
- 회사명 단위 캐시: `~/.jasojeon/company-context-cache/<sha1>.json` (TTL 7일)

### 파킹 (별도 스테이지)

- `packages/shared/src/core/jobPosting.ts` — 공고 분석 로직, 이번 스테이지 수정 금지
- `companyHints` 스키마 확장 / regex→LLM 보정 — 미래 스테이지

## Review Boundaries

### High-scrutiny product paths

- `packages/shared/src/core/orchestrator.ts`
- `packages/shared/src/core/providers.ts`
- `packages/runner/src/index.ts`
- `packages/runner/src/runnerContext.ts`
- `packages/runner/src/hosted/**`
- `packages/runner/src/routes/**` (hosted handler surface only; `*Router.ts` retired in Stage 11.7)
- `packages/web/src/App.tsx`
- `packages/web/src/api/client.ts`

### Harness control paths

- `docs/development/**`
- `tools/**`
- `scripts/**`
- `.github/**`
- `package.json`
- `README.md`

## Practical Workflow

1. Inspect the current repository state.
2. Update or add a dated design/plan document under `docs/plans/`.
3. Make minimal coherent changes.
4. Run `./scripts/check.sh`.
5. If runtime entrypoints changed, run `./scripts/dev-stack.sh` (or `./scripts/apply-dev-stack.sh` when only the web needs a restart).
6. Summarize what changed, what was validated, and what still needs human review.
