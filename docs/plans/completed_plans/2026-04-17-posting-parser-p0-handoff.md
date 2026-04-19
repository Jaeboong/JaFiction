---
date: 2026-04-19
status: Handoff
parent: docs/plans/2026-04-17-posting-parser-refactor.md
prev: docs/plans/2026-04-17-posting-parser-p0-field-confidence.md
---

# P0 Handoff — 공고 파서 오인식 방어 + `fieldConfidence` 스키마

> 다음 세션 에이전트용 인수인계 문서. P0 작업은 모든 공식 Gate를 통과했고 P1 착수 준비 완료 상태.

---

## 1. 한 줄 요약

P0 Chunk 1~7 완료 → `misidentification` **32건 → 0건**, 공식 Gate 4/4 PASS, P1(JSON-LD 파서) 착수 가능.

---

## 2. 현재 브랜치 / 커밋 기준점

- **브랜치**: `feat/p0-posting-parser-field-confidence`
- **분기점**: `09e015c chore: 2026-04-16 OpenDART 모달 plan 완료본 이동 및 codex 로그 정리` (main)
- **원격**: `origin/feat/p0-posting-parser-field-confidence`

---

## 3. 완료 Gate (2026-04-17)

| 항목 | 결과 |
|---|---|
| misidentification ≤ 5 | **0건** |
| success 8건 회귀 0 | greetinghr 2 + jobkorea 3 + careers.idis.co.kr 3 = 8건 유지 |
| `./scripts/check.sh` | PASS (shared 308 / runner 133 / web 67 / backend 74 / fail 0) |
| Golden fixture 5건 | 5/5 PASS |

---

## 4. 알려진 리스크 (P0 범위 밖 — P1/P3로 이월)

### 4.1 Jumpit 3건 "가짜 success"
- URL: `https://jumpit.saramin.co.kr/position/{53611604, 53526814, 53460085}`
- 추출값이 garbage이지만 `fetch-posting-fixtures.ts` classification 기준이 얕아 success로 분류됨
  - companyName이 공고 소개문 한 문장 통째 (`"...을 만드는 회사입니다."`)
  - roleName이 전부 `"개발자 채용"` 일반 문구
  - `fieldSources`: null
- **원인**: jumpit SPA 구조 → P0 (regex/title 파서)로 근본 해결 불가
- **해결 경로**: P1 (JSON-LD) 또는 P3 (Puppeteer)

### 4.2 Jobkorea roleName 회사명 prefix 혼입
- 예: `"㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)"` — roleName에 회사명 접두사 혼입
- Golden expected.json 의 `note` 필드에 기록됨
- P1 JSON-LD 파서에서 정제 예정

### 4.3 Fixture classification 기준 얕음
- 현재 `fetch-posting-fixtures.ts` 는 필드 존재 여부만으로 success/misidentification 판정
- 값 품질(garbage 여부) 검증 없음 → 4.1 같은 위양성(false positive success) 발생
- **별도 개선 과제**: classification 로직에 tier 기반 품질 필터 추가 (P1 완료 후 또는 별개 소규모 작업)

### 4.4 ATS 블랙리스트 최종 정책
- 현재 유지: `점핏`, `원티드`, `사람인`, `기아 탤런트 라운지`
- 제거됨: `잡코리아` (2026-04-17, suffix-only 패턴이라 jobkorea 정상 케이스 회귀 유발)
- P1(JSON-LD) 이후 남은 4개도 재평가 필요 — 대부분 SPA라 P1/P3 없이는 블랙리스트 의존도 여전

---

## 5. 아키텍처 / 데이터 모델 변경

### 5.1 신규 파일

| 경로 | 목적 |
|---|---|
| `packages/shared/src/core/sourceTier.ts` | `SourceTier` = `factual | contextual | role` 공용 타입 + 헬퍼 |
| `packages/shared/src/core/atsBlacklist.ts` | ATS 사이트명 title 필터 |
| `packages/shared/src/test/sourceTier.test.ts` | Tier 헬퍼 단위 테스트 |
| `packages/shared/src/test/jobPosting.tier.test.ts` | 파서 tier 분류 테스트 |
| `packages/shared/src/test/jobPosting.goldens.test.ts` | Golden 회귀 테스트 |
| `packages/shared/src/test/goldens/posting/*.html` | Golden fixture 5건 (greetinghr x2, jobkorea x3) |
| `packages/shared/src/test/goldens/posting/*.expected.json` | 각 골든 기대값 |
| `packages/runner/src/test/insightsHandlers.lowConfidence.test.ts` | handler guard 통합 테스트 |
| `packages/web/src/components/PostingFieldConfidenceBadge.tsx` | 필드별 tier 배지 |
| `packages/web/src/components/PostingLowConfidenceBanner.tsx` | 신뢰도 낮음 배너 |
| `scripts/fetch-posting-fixtures.ts` | 75 URL fixture 측정 스크립트 |

### 5.2 주요 수정 지점

| 파일 | 변경 요약 |
|---|---|
| `packages/shared/src/core/jobPosting.ts` | `JobPostingExtractionResult.fieldSources` 추가, `extractTitle()` ATS 필터 적용, `inferCompanyName/inferRoleName` tier 반환 |
| `packages/shared/src/core/types.ts` | `ReviewNeededReason`, `JobPostingFieldKey` export, `ProjectRecord.postingReviewReasons` / `.jobPostingFieldConfidence` 추가 |
| `packages/shared/src/core/schemas.ts` | `JobPostingFieldKeySchema`, `SourceTierSchema`, `ReviewNeededReasonSchema` 추가 |
| `packages/shared/src/core/storage.ts` | `ProjectRecordSchema`에 신규 필드 default |
| `packages/shared/src/core/hostedRpc.ts` | `AnalyzePostingResult` 스키마에 `fieldSources` 확장 |
| `packages/runner/src/routes/insightsHandlers.ts` | `analyze_insights` — all-role tier 감지 → `postingReviewReasons += "lowConfidenceExtraction"` + `insightStatus = "reviewNeeded"`. `generate_insights` — low confidence 차단 guard |
| `packages/runner/src/routes/projectsHandlers.ts` | 신규 필드 로드/직렬화 |
| `packages/web/src/pages/ProjectsPage.tsx` | 배너/배지/생성 버튼 차단 로직 |
| `packages/web/src/styles/projects.css` | 경고 배지/배너 스타일 |
| `.gitignore` | `*.bun-build`, fixture `fetched/` 제외 |

### 5.3 마이그레이션

- `ProjectRecord` 신규 2필드는 모두 **optional + Zod default**
- 기존 프로젝트 JSON 재로드 시 자동 주입 — 별도 마이그레이션 훅 불필요

---

## 6. 다음 스테이지 — P1 범위 (예정)

`docs/plans/2026-04-17-posting-parser-refactor.md` 기준:

1. **JSON-LD `JobPosting` 파서 도입**
   - 국내 ATS (점핏/원티드/잡코리아 등) 대부분 `<script type="application/ld+json">` 로 공고 정보 송출
   - 파싱 시 `fieldSources[field] = "factual"` 설정
2. **Jumpit/Wanted SPA 케이스**
   - JSON-LD 검증 후 heading-기반 garbage 추출 회피 로직 추가
3. **Golden expected.json 업데이트**
   - jobkorea 3건 `fieldSources` 를 `{"companyName": "factual", "roleName": "factual"}` 로 승격
   - Jumpit 케이스 golden 신규 추가 고려

**P1 Gate**:
- `misidentification` 유지 (0건)
- `success` 15건 이상 (현 11건 + jumpit 3 + wanted 몇 건)
- `fieldSources` 에 `factual` 비율 ≥ 50%

---

## 7. 실행 가이드 (다음 세션)

### 7.1 기본 검증
```bash
./scripts/check.sh                          # L1 — lint/unit tests
bun run scripts/fetch-posting-fixtures.ts   # L2 — 75 URL recon (기본 캐시 사용)
bun run scripts/fetch-posting-fixtures.ts --force   # L2 — 강제 재측정
```

### 7.2 Golden 테스트만 돌리기
```bash
./scripts/with-node.sh ./node_modules/.bin/tsc -p packages/shared/tsconfig.json
./scripts/with-node.sh ./node_modules/.bin/node --test packages/shared/dist/test/jobPosting.goldens.test.ts
```

### 7.3 Dev stack
```bash
./scripts/dev-stack.sh       # full dev loop
./scripts/status-dev-stack.sh
./scripts/stop-dev-stack.sh
```

---

## 8. 남은 Task

| ID | Task | 상태 | 비고 |
|---|---|---|---|
| #5 | P0 L3 CDP 자동화 검증 실행 | pending | `./scripts/dev-stack.sh` 후 수동 UX 체크리스트 (plan §10.1~10.2). 필수 아님 — 선택 진행 |

---

## 9. 관련 문서

- Parent refactor plan: `docs/plans/2026-04-17-posting-parser-refactor.md`
- P0 상세 플랜: `docs/plans/2026-04-17-posting-parser-p0-field-confidence.md`
- P0 verification 로그: `docs/plans/2026-04-17-posting-parser-p0-verification.md`
- Recon 결과: `docs/plans/2026-04-17-posting-parser-fixtures/results.json`, `report.md`

---

## 10. 인수 체크리스트 (다음 세션 시작 시)

- [ ] `git fetch && git checkout feat/p0-posting-parser-field-confidence` 후 `git pull` 확인
- [ ] `./scripts/check.sh` 재실행으로 환경 무결성 확인
- [ ] 본 Handoff 문서(§4 리스크 + §6 P1 범위) 읽기
- [ ] Parent refactor plan에서 P1 섹션 확인 후 P1 플랜 작성 또는 착수
