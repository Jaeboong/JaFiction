# Jasojeon Repository AGENTS Guide

This file is the first repo-level instruction for coding agents working in this repository.

If there is a conflict, follow this order:

1. `AGENTS.md`
2. `docs/development/ARCHITECTURE.md`
3. `docs/development/OPERATING_RULES.md`
4. `README.md`

## Read This Before Editing

- Read `docs/development/NAVIGATION.md` first to locate the right file for your task.
- Read `docs/development/ARCHITECTURE.md` before broad structural changes.
- Read `docs/development/OPERATING_RULES.md` before changing workflow, validation, or execution entrypoints.
- Treat `scripts/` as the source of truth for local execution.

## Repo Map

- `packages/shared/`: orchestration, storage, schemas, and shared workflow logic
- `packages/runner/`: localhost HTTP and WebSocket runner
- `packages/web/`: React + Vite UI
- `scripts/`: official local execution, validation, and dev-apply entrypoints
- `tools/`: deterministic validators
- `docs/development/`: harness architecture and operating policy
- `docs/plans/`: dated design and implementation notes
- `.github/`: review scaffolding

For a detailed file-level map (task → entry point, route table, test locations), see:

→ `docs/development/NAVIGATION.md`

## Product Plane vs Harness Plane

- Product plane: `packages/shared/**`, `packages/runner/**`, `packages/web/**`
- Harness plane: `scripts/**`, `tools/**`, `docs/development/**`, `docs/plans/**`, `.github/**`, root workflow docs

Keep changes in the intended plane. Do not hide workflow fixes inside product runtime code when a harness fix is the right answer.

## Official Entrypoints

Use these first:

- `./scripts/check.sh`
- `./scripts/apply-dev-stack.sh`
- `./scripts/status-dev-stack.sh`
- `./scripts/stop-dev-stack.sh`
- `./scripts/with-node.sh`
- `./scripts/with-npm.sh`

`package.json` is a convenience alias layer over these scripts. Do not treat raw `npm` commands as the only canonical workflow.

## WSL Node/NPM Rules

If you are running in WSL, assume raw `node` or `npm` on `PATH` may be wrong even when they appear to work.

- Prefer direct `./scripts/*.sh` entrypoints.
- Prefer `./scripts/with-node.sh` for direct CLI JS execution.
- Prefer `./scripts/with-npm.sh run ...` over raw `npm run ...` when shell health is unknown.
- Do not introduce new repo instructions that depend only on raw `npm`.
- Do not assume the first `node` on `PATH` is the correct Linux binary.

## Validation Rules

Run `./scripts/check.sh` after non-trivial changes.

Some validation commands start the localhost runner as part of tests, including
`./scripts/check.sh` and `./scripts/with-npm.sh run test ...` through the repo
test wrapper. If a sandboxed run fails with a localhost bind error such as
`listen EPERM 127.0.0.1`, do not treat that as a product regression yet. Rerun
the same command with escalation first, then judge pass/fail from the
unrestricted result.

Run `./scripts/apply-dev-stack.sh` when changes affect any of these:

- runner startup or routing
- web startup or Vite integration
- shared code used by runner and web at boot
- WebSocket flow
- local dev boot behavior

Use `./scripts/status-dev-stack.sh` to verify the current local stack.

## Planning Rules

- Inspect the current tree before editing.
- For multi-step work, add or update a dated plan under `docs/plans/`.
- Keep plans small and resumable.
- Update repo docs when official entrypoints or workflow rules change.

## Navigation Document Maintenance

Update `docs/development/NAVIGATION.md` whenever any of the following occur:

- A source file is added or deleted in `packages/shared/src/core/`, `packages/shared/src/controller/`, `packages/runner/src/routes/`, `packages/runner/src/ws/`, or `packages/web/src/`
- A new page or component is added to `packages/web/src/pages/` or `packages/web/src/components/`
- A new test file is added to `packages/shared/src/test/`
- A router's domain responsibility changes
- A file's primary role changes significantly

Do not add entries for files whose role is already accurately described. Do not remove entries without confirming the file is deleted.

## Runtime Metadata

Never commit local harness runtime state:

- `.harness/**`
- pid files
- local logs
- machine-specific temp output

## High-Risk Paths

Changes here need extra care and explicit validation:

- `packages/shared/src/core/**`
- `packages/runner/src/index.ts`
- `packages/runner/src/routes/**`
- `packages/runner/src/ws/**`
- `packages/web/src/**`
- `scripts/**`
- `package.json`
- `README.md`

## Code Quality Standards

- Write tests before implementation for new features (TDD).
- No secrets, tokens, absolute paths, or credentials in any output or commit.
- Follow established patterns before inventing new ones.
- Prefer immutability over mutating shared state.
- Don't add error handling for impossible scenarios — trust internal guarantees.
- Don't add docstrings, comments, or type annotations to code you didn't change.
- Three similar lines > premature abstraction.

## Commit Convention

```
feat(scope): description
fix(scope): description
docs: description
refactor(scope): description
test(scope): description
```

## Never Commit

- `.harness/**`
- `*.pid`
- Local logs and machine-specific temp output
- `.claude/tmp/` and other local session state

## Subagent Delegation

- Broad codebase searches → use an Explore subagent, not repeated Grep/Glob cycles
- Planning/architecture → use a Plan subagent
- Parallel independent concerns → run parallel agents

## Codex Delegation

**Claude's role**: orchestration, judgment, user communication only.  
**Codex's role**: all heavy code work (multi-file edits, large analysis, refactors).

| Task | Action |
|------|--------|
| Codebase exploration / analysis (5+ files) | Delegate to Codex |
| Code review | Delegate to Codex |
| Multi-file implementation / refactor | Delegate to Codex |
| Summary, user communication, judgment | Handle directly |

**Rules**:
- Prefer background execution for long-running Codex tasks.
- Do not duplicate work: if Codex is doing the analysis, do not re-read the same files.
- Every Codex prompt must include: "Do NOT use CDP MCP or browser automation tools."
- If Codex is unavailable, fall back to direct tools silently.

## Expected Closeout

When finishing a task, report:

- what changed
- what commands were run
- whether `check` and `apply-dev-stack` were run
- any skipped validation
- any remaining risk or manual review need
