# Phase 11 Hosted Migration — Manual Smoke Test Checklist

> **Purpose:** Ensure feat/hosted-migration delivers a production-ready hosted experience before merging to `main` by validating every Stage 11 feature set end-to-end on real browsers and locally paired runners.

## 1. 사전 준비

- [ ] Dev stack healthy
  - Action: `./scripts/status-dev-stack.sh` → confirm runner/web/backend all `UP`. If stopped, run `./scripts/dev-stack.sh` and wait for health logs.
  - Expectation: status script shows runner HTTP + WS bound to localhost, web Vite dev server ready, backend responding on 4000.
  - Logs: `logs/dev-stack/*.log` or `docker compose ps` when troubleshooting container issues.
- [ ] Device paired
  - Action: Ensure local runner already paired (device token present in `~/.jasojeon/secrets.enc`). If not, run `./scripts/start-dev-runner.sh` and complete pairing.
  - Expectation: Web app `DeviceConnected` badge shows paired device id; runner logs show `stateHub connected`.
  - Logs: `packages/runner/logs/*.log` for token errors.
- [ ] Google OAuth client configured
  - Action: Verify `.env` contains `GOOGLE_CLIENT_ID/SECRET`; run `./scripts/with-npm.sh run backend:env-check` if available.
  - Expectation: Visiting `/auth/google` redirects to Google consent and returns without 400 errors.
  - Logs: `packages/runner/src/routes/providersRouter.ts` console output or backend `auth.log` for OAuth issues.
- [ ] Seed project present
  - Action: Ensure at least one project exists via Projects page or `scripts/seed-project.sh`.
  - Expectation: `get_state` returns non-empty `projects[]` to avoid empty-state-only coverage.
  - Logs: `packages/shared/src/core/storage.ts` debug logs when seeding fails.

## 2. Bootstrap & Auth (Stage 11.5)

- [ ] LoginGate on anonymous visit
  - Action: Open browser in incognito → `https://localhost:5173` → do not login yet.
  - Expectation: LoginGate overlay visible with Google CTA, rest of app blurred.
  - Logs: Browser console (AuthGuard warnings) + runner `configRouter` logs.
- [ ] Google OAuth sign-in
  - Action: Click Google CTA → select test account → allow scopes → confirm redirect to `/`.
  - Expectation: Session cookie set, UI transitions to Overview page.
  - Logs: Browser network tab for `/auth/google/callback`, backend `auth.log` for tokens.
- [ ] Device onboarding when unpaired
  - Action: Delete local device token, refresh app.
  - Expectation: DeviceOnboarding panel appears with pairing instructions.
  - Logs: Runner `security/sessionAuth.ts` warnings.
- [ ] Pairing success path
  - Action: Use Stage 11.6 pairing flow to enter code; keep UI open.
  - Expectation: Panel auto-dismisses, `Connected` badge updates without manual reload.
  - Logs: Runner `stateHub` logs + WebSocket inspector.
- [ ] Backend outage indicator
  - Action: `docker compose stop backend`; keep runner + web running; refresh app.
  - Expectation: Network error UI with retry CTA, no infinite spinner.
  - Logs: Browser network errors + console stack traces.
- [ ] Session expiry path
  - Action: Delete cookies → press any nav tab.
  - Expectation: Redirect to LoginGate immediately.
  - Logs: Browser devtools Application tab; backend `401` responses logged.

## 3. Read Parity (Stage 11.1)

- [ ] State fetch after login
  - Action: Inspect `/api/state` response in network tab right after login.
  - Expectation: Contains accurate `projects`, `runState`, `profileDocuments`, `openDart` flags.
  - Logs: Runner `stateHub` + backend `state.log`.
- [ ] Projects list render
  - Action: Navigate to Projects page.
  - Expectation: All seeded projects listed with correct metadata (company, status).
  - Logs: Browser console for React errors.

## 4. Project CRUD + Upload (Stage 11.2)

- [ ] Project create flow
  - Action: Click "New Project" → fill form → submit.
  - Expectation: New project appears immediately in sidebar + list without refresh.
  - Logs: `/api/rpc` response + runner `projectsRouter.ts` logs.
- [ ] Upload large file (>=1MB)
  - Action: Attach 1–5MB PDF/doc; observe progress bar.
  - Expectation: Chunk progress increments, success toast, document shown under project.
  - Logs: Browser network chunk requests + runner upload logs.
- [ ] Reject >50MB file
  - Action: Attempt to upload 60MB artifact (can use dummy file).
  - Expectation: Client blocks with validation message before upload or server returns 413.
  - Logs: Browser console + runner storage logs.
- [ ] Delete project with confirm modal
  - Action: Click delete → type company name into confirmation field accurately.
  - Expectation: Project removed, toast displays success.
  - Logs: runner `projectsRouter` + DB logs for deletion.

## 5. Provider / Settings (Stage 11.3)

- [ ] Claude API key save/delete
  - Action: Navigate Settings → providers → enter valid fake key → save → then delete.
  - Expectation: UI indicates stored (masked) state; after deletion, status resets.
  - Logs: Runner `providersRouter` + secret store logs.
- [ ] Notion token + DB ID
  - Action: Enter known valid token/DB ID; run `Check` button.
  - Expectation: Success badge; edit to invalid token and recheck to see error.
  - Logs: Runner `notionMcp` logs.
- [ ] OpenDart key cycle
  - Action: Save key, refresh, ensure persists; delete to confirm removal.
  - Expectation: Input empties, key not loaded after refresh.
  - Logs: Runner storage logs.
- [ ] Agent defaults
  - Action: Modify defaults (review style, tone) and click save.
  - Expectation: Snackbar success, values persist post refresh.
  - Logs: `/api/rpc` payload + runner config logs.

## 6. Run Lifecycle (Stage 11.4)

- [ ] Start run + live events
  - Action: Select project → click "Start Run".
  - Expectation: WebSocket stream shows tokens, timeline updates live.
  - Logs: Runner `runHub` logs + browser WS inspector.
- [ ] Abort run
  - Action: Mid-run click Abort.
  - Expectation: Status transitions to aborted, UI stops streaming.
  - Logs: `/api/rpc abort` + runner orchestrator logs.
- [ ] Resume failed run
  - Action: Use run that previously failed; click Resume.
  - Expectation: Same runId reused, backlog events append.
  - Logs: Runner orchestrator `continuation` logs.
- [ ] Intervention
  - Action: During live run, open Intervention panel, submit message.
  - Expectation: Outcome shows `queued`, chat reflects input.
  - Logs: Runner orchestrator ledger logs.
- [ ] Run delete
  - Action: Delete run from history.
  - Expectation: Confirm modal warns permanent delete; run removed.
  - Logs: Runner `runRepository` logs.

## 7. Profile Documents (Stage 11.8)

- [ ] Panel visibility
  - Action: Settings → Profile Documents.
  - Expectation: Panel loads list with counts.
  - Logs: `/api/rpc profile_list` response.
- [ ] Text doc add
  - Action: Add text entry (title + body) → save.
  - Expectation: List updates instantly, counter increments.
  - Logs: Runner storage logs.
- [ ] File upload multi
  - Action: Upload two files simultaneously.
  - Expectation: Chunk uploads show separate progress; final entries appear.
  - Logs: Browser network + runner chunk logs.
- [ ] Pin toggle
  - Action: Toggle pin on doc.
  - Expectation: UI updates, state store reflects new order.
  - Logs: Runner profile store logs.
- [ ] Preview modal
  - Action: Click preview icon.
  - Expectation: Modal shows body/file preview.
  - Logs: Browser console for rendering issues.

## 8. Local Mode Retired (Stage 11.7)

- [ ] REST usage audit
  - Action: Browser DevTools → Network → filter `api/state` `api/runs` etc.
  - Expectation: No legacy `localhost:4001` or `/api/run/*` endpoints; only `/api/state` + `/api/rpc`.
  - Logs: Browser network export for proof.
- [ ] RPC only writes
  - Action: Trigger run start, project create.
  - Expectation: All writes POST `/api/rpc` with method names, no stray PUT/DELETE.
  - Logs: Browser network HAR.

## 9. Dev Automation (Stage 11.6)

- [ ] One-shot boot
  - Action: `./scripts/dev-stack.sh` from clean shell.
  - Expectation: All services boot <60s, pairing prompt appears once.
  - Logs: `scripts/logs/dev-stack.log` + `supervise.mjs` output.
- [ ] Runner restart supervision
  - Action: Kill runner PID, wait.
  - Expectation: Supervisor restarts runner within 5s, state hub reconnects automatically.
  - Logs: `lib/supervise.mjs` console.
- [ ] Clean shutdown
  - Action: `./scripts/stop-dev-stack.sh`.
  - Expectation: All processes stop gracefully, no orphan ports.
  - Logs: same script output.
- [ ] Reboot without pairing
  - Action: run `./scripts/dev-stack.sh` again.
  - Expectation: Runner reuses token, no pairing prompt.
  - Logs: Runner logs verifying secrets reused.

## 10. 회귀 확인

- [ ] Legacy device token compatibility
  - Action: Place existing `~/.jasojeon/secrets.enc` from pre-hosted era; start app.
  - Expectation: App logs in without re-pairing; runs operate normally.
  - Logs: Runner `secretStore` logs.
- [ ] Local mode endpoints absent
  - Action: Attempt calling old REST endpoints manually (curl `http://localhost:4001/runs`).
  - Expectation: 404 or connection refused.
  - Logs: Runner HTTP logs.

## 11. 보고 양식

Use this template per tester for each scenario:

```
[ ] Scenario name — Pass/Fail
    fail reason: <text>
```

- Attach HAR exports for failures, plus runner + backend logs with timestamps.
- File aggregated checklist in `docs/plans/testing-reports/phase-11/<tester>.md`.
