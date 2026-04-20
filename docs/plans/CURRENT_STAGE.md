# Current Stage

> 이 파일은 진행 중인 스테이지와 최근 완료 스테이지를 추적한다.
> 업데이트: 스테이지 완료 또는 새 스테이지 시작 시마다 갱신.
> 최종 갱신: 2026-04-19 (코드 기준 재검증 — 11.9/11.10 및 P2 Chunk 0·0.5 완료 반영)

## 현재 진행 중

| 스테이지 | 제목 | 상태 | 브랜치 | 플랜 파일 |
|---------|------|------|--------|----------|
| P2 | 공고 파서 메이저 사이트 어댑터 | Chunk 0 (인프라) + Chunk 0.5 (Puppeteer Fetcher) 완료, Chunk 1+ (실 어댑터) 대기 | develop / feat/p2-posting-parser-adapters | [링크](2026-04-19-posting-parser-p2-major-adapters.md) |
| P3 | 공고 파서 후속 (API 조사 분기) | 대기 — API 조사 결과에 따라 scope 확정 | — | [링크](2026-04-17-posting-parser-refactor.md) |

보류:

- [L3 CDP dev-login 라우트](2026-04-19-posting-parser-dev-login-l3-verification.md) — stub, 구현 보류 (후속 이슈)

## 최근 완료 (completed_plans/)

최신순 정렬 — 스테이지 번호가 있는 것 우선, 이후 기능 단위 플랜 순서로 나열.

| 완료일 | 스테이지 / 플랜 | 파일 |
|--------|----------------|------|
| 2026-04-19 | P2 Chunk 0.5 — JobPostingFetcher 인터페이스 + PuppeteerFetcher (커밋 `82538c0`) | [2026-04-19-posting-parser-p2-chunk0.5-detail.md](completed_plans/2026-04-19-posting-parser-p2-chunk0.5-detail.md) |
| 2026-04-19 | P2 Chunk 0.5 — 다음 세션 핸드오프 (역할 종료) | [2026-04-19-posting-parser-p2-chunk0.5-next-session.md](completed_plans/2026-04-19-posting-parser-p2-chunk0.5-next-session.md) |
| 2026-04-19 | P0 + P1 공고 파서 리팩터 핸드오프 (PR #4 머지) | [2026-04-19-posting-parser-p0-p1-handoff.md](completed_plans/2026-04-19-posting-parser-p0-p1-handoff.md) |
| 2026-04-19 | P1 공고 파서 JSON-LD + cross-validation (factual 27.3%→43.8%, L2 gate PASS) | [2026-04-19-posting-parser-p1-jsonld.md](completed_plans/2026-04-19-posting-parser-p1-jsonld.md) |
| 2026-04-19 | P1 Chunk 3.5 Factual Gate 보충 (cross-validation + idis hostname hint) | [2026-04-19-posting-parser-p1-chunk35-factual-boost.md](completed_plans/2026-04-19-posting-parser-p1-chunk35-factual-boost.md) |
| 2026-04-19 | 공고 파서 fixture 수집 Recon (산출물: results.json + report.md 생성 완료) | [2026-04-17-posting-parser-fixtures.md](completed_plans/2026-04-17-posting-parser-fixtures.md) |
| 2026-04-19 | 테스트 환경 분리 (플랫폼 가드 + pre-existing 10건 → 0건) | [2026-04-15-test-environment-triage.md](completed_plans/2026-04-15-test-environment-triage.md) |
| 2026-04-19 | P0 공고 파서 리팩터 — fieldConfidence 스키마 + ATS 블랙리스트 (오인식 32→0) | [2026-04-17-posting-parser-p0-handoff.md](completed_plans/2026-04-17-posting-parser-p0-handoff.md) |
| 2026-04-17 | P0 공고 파서 상세 플랜 | [2026-04-17-posting-parser-p0-field-confidence.md](completed_plans/2026-04-17-posting-parser-p0-field-confidence.md) |
| 2026-04-17 | P0 검증 체계 (L1/L2/L3) | [2026-04-17-posting-parser-p0-verification.md](completed_plans/2026-04-17-posting-parser-p0-verification.md) |
| 2026-04-15 | 인사이트 생성 다중 소스 파이프라인 (Stage A~E green) | [2026-04-15-insight-generation-multi-source.md](completed_plans/2026-04-15-insight-generation-multi-source.md) |
| 2026-04-16 | OpenDART 회사 선택 모달 버그픽스 & UX gap 해소 | [2026-04-16-opendart-candidate-modal-fixes.md](completed_plans/2026-04-16-opendart-candidate-modal-fixes.md) |
| 2026-04-12 | Stage 11.10 — 디바이스 멀티유저 (`device_users` 중간 테이블, migration `0002`) | [2026-04-12-stage-11.10-device-multi-user.md](completed_plans/2026-04-12-stage-11.10-device-multi-user.md) |
| 2026-04-12 | Stage 11.9 — Device auto-claim (zero-friction pairing, Devices 탭 제거까지) | [2026-04-12-stage-11.9-device-auto-claim.md](completed_plans/2026-04-12-stage-11.9-device-auto-claim.md) |
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

- `main`: 프로덕션 배포 기준
- `develop`: 통합 브랜치 (HEAD `82538c0` — P2 Chunk 0.5 까지 머지)
- `feat/p2-posting-parser-adapters`: P2 어댑터 작업 브랜치

## 주요 의존성 체인

```
11.6 (dev automation) — 완료
  └─ 11.6.B (runner distribution) — 완료
       └─ 11.8 (profile parity) — 완료
            └─ 11.9 (device auto-claim) — 완료
                 └─ 11.10 (multi-user device) — 완료

공고 파서 리팩터 (마스터 plan: 2026-04-17-posting-parser-refactor.md)
  ├─ P0 (fieldConfidence + ATS 블랙리스트) — 완료
  ├─ P1 (JSON-LD + cross-validation, factual 43.8%) — 완료
  ├─ P2 (메이저 사이트 어댑터)
  │    ├─ Chunk 0   (SiteAdapter 인프라) — 완료
  │    ├─ Chunk 0.5 (Puppeteer Fetcher)  — 완료
  │    └─ Chunk 1+  (실 어댑터 구현)     ← 진행 중
  └─ P3 (API 조사 분기) — 대기
```

## 참고

- OCI 서버: `168.107.25.12` (SSH 키: `/tmp/oci.key`, chmod 600, repo 경로: `~/jasojeon`)
- 개발 스택: `./scripts/dev-stack.sh` (절대 `apply-dev-stack.sh` 사용 금지)
- 검증: `./scripts/check.sh` 만 사용
