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
3. Inspect the current file tree before editing anything.
4. Run `./scripts/check.sh` after any non-trivial change.

---

## Official Entrypoints (WSL-safe)

```
./scripts/check.sh
./scripts/dev-stack.sh            # canonical: full dev loop (infra + backend + runner + web)
./scripts/start-dev-backend.sh    # start postgres/redis + backend only
./scripts/start-dev-runner.sh     # pair (first run) + start runner only
./scripts/apply-dev-stack.sh      # legacy: web-only restart helper (backend must already be running)
./scripts/status-dev-stack.sh
./scripts/stop-dev-stack.sh       # stop all; --all also tears down containers
./scripts/with-node.sh <command>
./scripts/with-npm.sh run <script>
```

**WSL rule**: Raw `node` / `npm` on `PATH` may be the wrong binary. Always prefer `./scripts/*.sh`.

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

**Companion script path**:
```
node "/home/cbkjh0225/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs"
```

**Rules**:
- Prefer background execution (`run_in_background: true`) for long-running Codex tasks.
- Do not duplicate work: if Codex is doing the analysis, Claude does not re-read the same files.
- Claude reads Codex output and synthesizes; never re-derives what Codex already produced.
- If Codex is unavailable or fails, fall back to Claude tools silently without explaining the delegation attempt.

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
