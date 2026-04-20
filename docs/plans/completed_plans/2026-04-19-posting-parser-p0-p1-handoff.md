# P0 + P1 공고 파서 리팩터 핸드오프

**작성일**: 2026-04-19
**브랜치**: feat/p0-posting-parser-field-confidence
**PR**: https://github.com/Jaeboong/Jasojeon/pull/4
**상태**: PR open, CI 결과 대기 중

---

## 목표 달성

- 공고 파서 factual 추출 비율: 27.3% → 43.8% (+16.5p)
- L2 gate 40%: PASS
- P0 신뢰도 인프라 (fieldConfidence schema, ATS blacklist, UI 경고) 도입

---

## 완료된 작업

### P0 (신뢰도 인프라)

| SHA | 제목 |
|-----|------|
| `f307180` | feat(shared): P0 공고 파서 fieldConfidence 스키마 + ATS 블랙리스트 |
| `c642ffc` | test(shared): P0 tier/블랙리스트/golden 회귀 테스트 도입 |
| `4c096bf` | feat(runner): P0 low confidence 차단 guard + 리뷰 사유 전파 |
| `b648696` | feat(web): P0 신뢰도 경고 배너/배지 + 인사이트 생성 차단 UI |
| `0d4c0d3` | chore(scripts): P0 공고 파서 fixture 측정 스크립트 + recon 산출물 |
| `bcba087` | docs(plans): P0 공고 파서 리팩터 플랜 + verification + handoff |

### P1 (추출 정확도)

| SHA | 제목 | 효과 |
|-----|------|------|
| `f176c97` | fix(shared): P1 Chunk 1 — fieldSources 누수 복구 + golden 재동결 | fieldSources 덮어쓰기 버그 수정 |
| `fd47ec5` | feat(shared): P1 Chunk 2 — JSON-LD 공용 모듈 + unit test | jsonLd.ts 공용 추출 모듈 도입 |
| `52b410c` | feat(shared): P1 Chunk 3+4 — JSON-LD 파이프라인 통합 + jobkorea goldens factual 재동결 | jobkorea 3건 factual 승격 |
| `ae30427` | feat(shared): P1 Chunk 3.5 — 공용 cross-validation + idis hostname hint + JSON-LD description factual 승격 | cross-source voting, idis hostname hint staging |
| `ce0ed6c` | chore(fixtures): Chunk 3.5.E — fixture 75건 재측정, factual 43.8% gate 40% PASS | L2 gate 공식 통과 |
| `e83a0fb` | test(shared): P1 Chunk 5 — wanted golden 추가 (mainResponsibilities factual 고정) | wanted golden 1건 고정 |
| `d24623f` | docs(plans): P1 Chunk 6 Part B — Final L2 gate 공식화, §11 dev-login 별도 plan 분리 | 완료 공식화 + 후속 분리 |

---

## 파일 맵

### 신규 모듈

- `packages/shared/src/core/jobPosting/jsonLd.ts` — JSON-LD 공용 추출/정규화
- `packages/shared/src/core/jobPosting/crossValidate.ts` — cross-source voting
- `packages/shared/src/core/jobPosting/companyHostnames.ts` — hostname hint staging

### goldens (회귀 방지)

- `jobkorea_*`: 3건 (Chunk 3+4)
- `greetinghr_echomarketing_*`: 2건 (Chunk 3.5.A 재동결)
- `wanted_neptune_h5`: 1건 (Chunk 5)

### fixture 측정

- `docs/plans/2026-04-17-posting-parser-fixtures/results.json` — 75건 final result
- `docs/plans/2026-04-17-posting-parser-fixtures/report.md` — factual 비율 breakdown

---

## 다음 담당자에게

### 후속 이슈 (별도 PR)

1. **§11 dev-login (L3 CDP verification)**: `docs/plans/2026-04-19-posting-parser-dev-login-l3-verification.md`
   - 목적: Google OAuth 로 막힌 L3 검증 자동화
   - 범위: backend dev-only 라우트 + 보안 가드

2. **companyHints schema 정식 이행**: 현재 `HOSTNAME_COMPANY_HINTS` 는 staging. P2 에서 DB/설정 기반으로 승격 예정 (idis 1건만 들어있음)

3. **runner 테스트 harness cleanup**: `insightsHandlers.lowConfidence.test` 등의 Windows EBUSY 구조적 버그 — close 체계 추가 필요

### 알려진 제약

- Windows check.sh: runner EBUSY 7건 기존 이슈 (신규 코드 무관)
- storage.test 동시 rename EPERM: Windows 전용, 기존 이슈
- qualifications/preferredQualifications: factual 0% — 현재 추출 경로 없음 (별도 lever 필요)

### 측정 재실행 방법

```
npx tsx scripts/fetch-posting-fixtures.ts   # 캐시된 fetched/ HTML 재파싱
```

`--force` 주면 네트워크 재fetch. 파서만 재측정하려면 옵션 없이 실행.

### 특이 케이스

- jumpit 53460085 (이비즈테크): Chunk 3.5.C 길이 필터로 garbage 회사명 배제 → success → partial 다운그레이드. 파서 품질 향상 부작용, 회귀 아님.
