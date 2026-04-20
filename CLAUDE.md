# Jasojeon — Claude Code Instructions

> Claude Code reads this file automatically. For other agents, see `AGENTS.md`.
> On conflict: `CLAUDE.md` > `AGENTS.md` > `docs/development/ARCHITECTURE.md` > `docs/development/OPERATING_RULES.md`

---

## Project Overview

Jasojeon is a web UI + local runner rewrite of the original `forJob` VS Code extension.

- `packages/shared/` — orchestration, storage, schemas, shared workflow logic
- `packages/runner/` — hosted-mode outbound runner (WS to backend, no inbound server)
- `packages/web/` — React + Vite UI
- `scripts/` — canonical local execution entrypoints (prefer over raw `npm`)
- `tools/` — deterministic validators
- `docs/development/` — harness architecture and operating policy

---

## Before You Start

1. Read `docs/development/ARCHITECTURE.md` before broad structural changes.
2. Read `docs/development/OPERATING_RULES.md` before touching workflow, validation, or runner entrypoints.
3. Read `docs/development/LOCAL_SETUP.md` for ports, `.env.dev`, OCI SSH, common errors.
4. Inspect the current file tree before editing anything.
5. Run `./scripts/check.sh` after any non-trivial change.

---

## Official Entrypoints (WSL-safe)

```
./scripts/check.sh
./scripts/dev-stack.sh            # canonical: full dev loop (infra + backend + runner + web)
./scripts/start-dev-backend.sh    # start postgres/redis + backend only
./scripts/start-dev-runner.sh     # pair (first run) + start runner only
./scripts/apply-dev-stack.sh      # legacy: web-only restart helper
./scripts/status-dev-stack.sh
./scripts/stop-dev-stack.sh       # stop all; --all also tears down containers
./scripts/with-node.sh <command>
./scripts/with-npm.sh run <script>
./scripts/gh.sh <args>            # GitHub CLI 래퍼 — bash에서 gh.exe 자동 탐색
```

**WSL rule**: Raw `node` / `npm` / `gh` on `PATH` may be the wrong binary. Always prefer `./scripts/*.sh`.

---

## Branch / Deploy Workflow

| 브랜치 | 환경 | 자동 배포 |
|--------|------|-----------|
| `develop` | 테스트 (자소전.shop, OCI 168.107.25.12) | push → `.github/workflows/deploy-dev.yml` |
| `main` | 프로덕션 (휴면 중) | push → `.github/workflows/deploy.yml` (현재 `.env.production` 없어 실효 없음) |

### 작업 규약 (로컬 Claude + nanoclaw 봇 공통)

1. **모든 작업은 `develop` 브랜치에 commit + `git push origin develop`** 으로 수렴한다.
   서버 `~/project/Jasojeon` 파일을 직접 편집하고 방치 금지 (deploy-dev.yml 의
   `git reset --hard origin/develop` 가 날려버린다).
2. **로컬 작업 시작 전** 반드시 `git pull origin develop`.
3. **`main`** 은 `develop → main` PR merge 로만 전진시킨다 (현 plan 범위 밖, 휴면).
4. PR 은 `develop` 을 base 로 연다. `test.yml` 이 PR 게이트.

> 서버 ↔ 로컬 ↔ 봇 race condition 완화를 위해 위 규약은 강제 규칙이다. 구조적 격리
> (예: `~/project/Jasojeon-work/` 별도 checkout) 는 현재 single user 라 YAGNI.

---

## Planes — Keep Them Separate

| Plane   | Paths |
|---------|-------|
| Product | `packages/shared/**`, `packages/runner/**`, `packages/web/**` |
| Harness | `scripts/**`, `tools/**`, `docs/development/**`, `docs/plans/**`, `.github/**` |

Do not embed harness fixes inside product runtime code, and vice versa.

---

## Validation Rules

| When | Run |
|------|-----|
| After any non-trivial change | `./scripts/check.sh` |
| After touching runner/web/websocket/boot | `./scripts/dev-stack.sh` |
| To inspect current state | `./scripts/status-dev-stack.sh` |

---

## High-Risk Paths — Extra Care Required

- `packages/shared/src/core/**`
- `packages/runner/src/index.ts`
- `packages/runner/src/hosted/**`
- `packages/runner/src/routes/**`
- `packages/runner/src/ws/**`
- `packages/web/src/**`
- `scripts/**`
- `package.json`

---

## Planning Rules

- For multi-step work, create or update a dated plan under `docs/plans/`.
- Keep plans small and resumable.
- Update `docs/development/` when official entrypoints or workflow rules change.

---

## Model Selection

| Task | Model |
|------|-------|
| File exploration, quick edits | haiku |
| Multi-file coding, default work | sonnet (default) |
| Architecture decisions, security analysis, complex debugging | opus |

Use the `Agent` tool with `subagent_type: "Explore"` for broad codebase searches instead of repeated Grep/Glob cycles.

---

## Subagent Delegation

Delegate to subagents when:
- Task spans multiple independent files/concerns → use parallel agents
- Deep codebase exploration needed → use `Explore` subagent
- Planning/architecture → use `Plan` subagent

Limit context negotiation to 3 cycles per subagent. Structure work as:
**Research → Plan → Implement → Review → Verify**

---

## Codex Delegation — Token Minimization

**Claude's role**: orchestration, judgment, user communication only.
**Codex's role**: all heavy code work.

| Task | Action |
|------|--------|
| Large codebase exploration / analysis (5+ files) | Delegate to Codex via `codex-companion.mjs` |
| Code review (standard or adversarial) | Delegate to Codex (`adversarial-review` or `review`) |
| Implementation tasks (multi-file edits, refactors) | Delegate to Codex task |
| Result summary, user communication, judgment calls | Claude handles directly |

**Companion script**: Codex CLI 플러그인이 설치된 환경에서 `codex-companion.mjs`를 통해 실행한다. 경로는 환경마다 다르므로 `find ~/.claude/plugins -name "codex-companion.mjs" | head -1`로 확인한다.

**Rules**:
- Prefer background execution (`run_in_background: true`) for long-running Codex tasks.
- Do not duplicate work: if Codex is doing the analysis, Claude does not re-read the same files.
- Claude reads Codex output and synthesizes; never re-derives what Codex already produced.
- If Codex is unavailable or fails, fall back to Claude tools silently without explaining the delegation attempt.
- Every Codex prompt must include: "Do NOT use CDP MCP or browser automation tools."

---

## Code Quality Standards

- Write tests before implementation for new features (TDD).
- No secrets, tokens, absolute paths, or credentials in any output or commit.
- Follow established patterns before inventing new ones.
- Prefer immutability over mutating shared state.
- Don't add error handling for impossible scenarios — trust internal guarantees.
- Don't add docstrings, comments, or type annotations to code you didn't change.
- Three similar lines > premature abstraction.

---

## Commit Convention

```
feat(scope): description
fix(scope): description
docs: description
refactor(scope): description
test(scope): description
```

---

## Never Commit

- `.harness/**`
- `*.pid`
- Local logs and machine-specific temp output
- `.claude/` local session state

---

## Task Closeout

When finishing a task, report:
1. What changed
2. What commands were run
3. Whether `check.sh` and `apply-dev-stack.sh` were run
4. Any skipped validation
5. Any remaining risk or manual review needed
