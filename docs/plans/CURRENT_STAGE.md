# Current Stage

> 이 파일은 진행 중인 스테이지와 최근 완료 스테이지를 추적한다.
> 업데이트: 스테이지 완료 또는 새 스테이지 시작 시마다 갱신.
> 최종 갱신: 2026-04-15

## 현재 진행 중

| 스테이지 | 제목 | 상태 | 브랜치 | 플랜 파일 |
|---------|------|------|--------|----------|
| insight-multi-source | 인사이트 생성 파이프라인 다중 소스 리팩터 | **완료** — Stage A~E 전부 green | main | [링크](2026-04-15-insight-generation-multi-source.md) |
| 11.9 | Device auto-claim (zero-friction pairing) | In Progress — backend(pairing.ts, app.ts, deviceHub.ts, subscribeAdapter.ts 신규) 작업 중, runner routes/shared 일부 수정됨 | feat/hosted-migration | [링크](2026-04-12-stage-11.9-device-auto-claim.md) |
| 11.10 | 디바이스 멀티유저 (머신 단위 디바이스) | Pending (11.9 완료 후 착수) | feat/hosted-migration | [링크](2026-04-12-stage-11.10-device-multi-user.md) |

### 11.9 세부 진행 상황 (git status 기준)

수정된 파일:

- `packages/backend/src/app.ts` — 신규 라우트 등록 작업 중
- `packages/backend/src/routes/pairing.ts` — auto-claim 엔드포인트 재작성 중
- `packages/backend/src/ws/deviceHub.ts` — WS 디바이스 허브 수정 중
- `packages/backend/src/redis/subscribeAdapter.ts` — **신규** Redis 구독 어댑터 추가
- `packages/runner/src/routes/insightsHandlers.ts` — 수정됨
- `packages/runner/src/routes/openDartHandlers.ts` — 수정됨
- `packages/runner/src/routes/runsHandlers.ts` — 수정됨
- `packages/shared/src/core/companyInsightArtifacts.ts` — 수정됨
- `packages/shared/src/core/insights.ts` — 수정됨
- `packages/shared/src/core/nodeRuntimeResolver.ts` — 수정됨
- `packages/shared/src/core/providers.ts` — 수정됨

Web(ConnectConsentModal, DevicesPage)과 runner auto-claim 클라이언트는 아직 착수 전으로 보임.

## 최근 완료 (completed_plans/)

최신순 정렬 — 스테이지 번호가 있는 것 우선, 이후 기능 단위 플랜 순서로 나열.

| 완료일 | 스테이지 / 플랜 | 파일 |
|--------|----------------|------|
| 2026-04-12 | Stage 11.6.B — Runner distribution (runner-bin Docker 스테이지, 배포 파이프라인) | [2026-04-12-stage-11.6B-runner-distribution.md](completed_plans/2026-04-12-stage-11.6B-runner-distribution.md) |
| 2026-04-11 | Hosted migration plan (전체 hosted 마이그레이션 설계) | [2026-04-11-hosted-migration-plan.md](completed_plans/2026-04-11-hosted-migration-plan.md) |
| 2026-04-11 | Stage 11.6.B — Runner distribution (초안) | [2026-04-11-stage-11.6-b-runner-distribution.md](completed_plans/2026-04-11-stage-11.6-b-runner-distribution.md) |
| 2026-04-11 | Stage 11.6 — Dev automation | [2026-04-11-stage-11.6-dev-automation.md](completed_plans/2026-04-11-stage-11.6-dev-automation.md) |
| 2026-04-11 | Runs manual completion | [2026-04-11-runs-manual-completion-implementation.md](completed_plans/2026-04-11-runs-manual-completion-implementation.md) |
| 2026-04-11 | Same-run resume | [2026-04-11-same-run-resume-implementation.md](completed_plans/2026-04-11-same-run-resume-implementation.md) |
| 2026-04-11 | App tab indicator | [2026-04-11-app-tab-indicator.md](completed_plans/2026-04-11-app-tab-indicator.md) |
| 2026-04-11 | Gemini + Notion OAuth | [2026-04-11-gemini-notion-oauth.md](completed_plans/2026-04-11-gemini-notion-oauth.md) |
| 2026-04-11 | Providers API key icon actions | [2026-04-11-providers-api-key-icon-actions.md](completed_plans/2026-04-11-providers-api-key-icon-actions.md) |
| 2026-04-11 | Providers Notion icon actions | [2026-04-11-providers-notion-icon-actions.md](completed_plans/2026-04-11-providers-notion-icon-actions.md) |
| 2026-04-11 | Provider auto-install handoff | [handoff-provider-auto-install.md](completed_plans/handoff-provider-auto-install.md) |
| 2026-04-11 | Phase 11 smoke test | [phase-11-smoke-test.md](completed_plans/phase-11-smoke-test.md) |

## 브랜치 현황

- `main`: 프로덕션 배포 기준 (최신 커밋: `eca5ad3 docs(harness): gh CLI 래퍼 스크립트 추가`)
- `feat/hosted-migration`: 현재 작업 브랜치 (11.9, 11.10 작업 중)

## 주요 의존성 체인

```
11.6 (dev automation)
  └─ 11.6.B (runner distribution / Docker 바이너리 빌드)
       └─ 11.8 (profile parity — completed, 별도 plan 파일 없음)
            └─ 11.9 (device auto-claim) ← 현재 진행 중
                 └─ 11.10 (multi-user device) ← 대기 중
```

## 11.9 체크리스트 (플랜 기준)

- [ ] Schema 변경 (`workspace_root` nullable, `hostname`/`os`/`runner_version` 추가) + migration `0001`
- [ ] Backend `/auth/device-claim` POST/GET 엔드포인트 (Redis claim 저장, long-poll)
- [ ] Backend `/api/device-claim/approve` POST (session required, IP 매칭)
- [ ] Backend `GET /api/devices`, `POST /api/devices/:id/revoke` — insertDevice 시그니처 갱신
- [ ] Runner `autoClaimDevice()` 함수 (poll loop, abort signal)
- [ ] Runner `index.ts` — `JASOJEON_MODE=pair` 분기 제거, auto-claim 통합
- [ ] Web `ConnectConsentModal.tsx` 신규 (BootstrapGate `device_offline` 교체)
- [ ] Web `DevicesPage.tsx` 재작성 (pair form 제거, empty state)
- [ ] Web `client.ts` — `approveDeviceClaim` 추가, `listDevices` 타입 갱신
- [ ] `scripts/start-dev-runner.sh` — PAIRING_CODE 처리 제거
- [ ] 테스트 (`deviceClaim.test.ts`, `autoClaim.test.ts`, `ConnectConsentModal.test.tsx`)
- [ ] `./scripts/check.sh` 통과

## 참고

- OCI 서버: `168.107.25.12` (SSH 키: `/tmp/oci.key`, chmod 600, repo 경로: `~/jasojeon`)
- 개발 스택: `./scripts/dev-stack.sh` (절대 `apply-dev-stack.sh` 사용 금지)
- 검증: `./scripts/check.sh` 만 사용
