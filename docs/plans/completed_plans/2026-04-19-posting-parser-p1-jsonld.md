---
date: 2026-04-19
status: completed
parent: docs/plans/2026-04-17-posting-parser-refactor.md
prev: docs/plans/2026-04-17-posting-parser-p0-handoff.md
completed_at: 2026-04-19
---

# P1 — JSON-LD `JobPosting` 파서 + fieldSources 복구

**Parent plan:** `docs/plans/2026-04-17-posting-parser-refactor.md`
**Stage:** P1 (리팩터 2단계)
**Scope:** 국내 전용 공고 파서
**Goal:** success 분류 **8 → 18 이상** + `fieldSources = factual` 비율 ≥ **40%** (분모 5필드 기준, §7.2)
**예상 공수:** 1~2일 (Chunk 1~6 합 ~9시간)

## Progress

- 2026-04-19: Chunk 3 파이프라인 통합과 Chunk 4 jobkorea golden 재동결을 워킹트리에 반영했다.
- 2026-04-19: shared/runner/backend 직접 빌드 및 테스트, posting golden 5/5, `jobPosting.tier` 확장, `jobPosting.jsonLd` 회귀 검증을 완료했다.

---

## 1. 목표 / 비목표

### 1.1 목표

- **성공률 증가**: JSON-LD `JobPosting` 스키마 파서 도입으로 wanted/jobkorea/daangn 계열 partial 케이스를 success 로 승격
- **Factual tier 확보**: JSON-LD 추출 경로를 `fieldSources = factual` 로 태깅 → 다운스트림(`evaluatePostingConfidence`) 이 low-confidence 차단을 풀 수 있는 factual 근거 마련
- **P0 bug 해결**: `buildExtractionResult` 가 `fieldSources: {}` 로 덮어쓰는 버그 수정 (§2.1)
- **Misidentification 유지**: 0건 (P0 결과) — JSON-LD 도입이 회귀를 일으키지 않음

### 1.2 비목표 (P1 범위 밖 — 명시적으로 건드리지 않음)

- **Puppeteer / 브라우저 렌더링** — Jumpit 17건, recruiter.co.kr 9건, kia 6건 등은 static HTML 에 JSON-LD 없음 → **P3 범위**. 이번 P1 에서는 해결 안 함.
- **`__NEXT_DATA__` 쿼리 구조 확장** (careerlink 등) — P2 범위
- **Regex 파서 전면 재설계** — JSON-LD 는 레이어로 덧붙이고, regex 는 현상태 유지. JSON-LD 없거나 불완전하면 기존 regex 결과로 폴백.
- **Jumpit SPA 해결** — fixture 실측상 Jumpit static HTML 에 JSON-LD **0/17** (§2.3). P1 로는 근본 불가.
- **Fixture classification 로직 개선** — jumpit 3건 "가짜 success" 제거 (handoff §4.3) 는 별개 소 리팩터로 분리.
- **ATS 블랙리스트 축소** — 현재 유지(점핏/원티드/사람인/기아 탤런트 라운지). 재평가는 P3 완료 후.
- **Wanted `/company/16049` 유형** (공고가 아닌 회사 페이지) — P2 에서 `expired`/별도 분류로 분기

---

## 2. 현재 상태 분석 (file:line 기반)

### 2.1 파서 진입점 — `packages/shared/src/core/jobPosting.ts`

| 영역 | 위치 | 현재 동작 |
|---|---|---|
| `fetchAndExtractJobPosting()` | `jobPosting.ts:177-247` | URL fetch → HTML → `extractEmbeddedJobPostingSource()` (GreetingHR 전용 `__NEXT_DATA__`) → `normalizeJobPostingHtml()` → `buildExtractionResult()` |
| `buildExtractionResult()` | `jobPosting.ts:449-486` | **[P0 BUG]** line 484 `fieldSources: {}` 하드코딩 — `extractStructuredJobPostingFields` 가 line 329 에서 계산한 `fieldSources` 를 통째로 폐기 |
| `extractStructuredJobPostingFields()` | `jobPosting.ts:274-331` | Tier 분류 담당 — `inferRoleNameWithTier`/`inferCompanyNameWithTier` 호출, `fieldSources.{companyName,roleName}` 만 채움 (deadline 등은 아직 tier 미태깅) |
| `extractEmbeddedJobPostingSource()` | `jobPosting.ts:767-802` | `<script id="__NEXT_DATA__">` 에서 GreetingHR `getOpeningById` 쿼리만 파싱. JSON-LD 인식 없음. |
| `extractTitle()` + ATS 블랙리스트 | `jobPosting.ts:488-491` + `atsBlacklist.ts:8-33` | `<title>` 추출 후 `filterAtsFromTitle()` 로 필터 |

### 2.2 P0 도입 공용 타입

| 파일 | 내용 |
|---|---|
| `packages/shared/src/core/sourceTier.ts:1-24` | `SOURCE_TIERS = ["factual","contextual","role"]`, `SourceTierSchema`, `isFactual`, `isWeakTier`, `compareTiers` |
| `packages/shared/src/core/atsBlacklist.ts:8-33` | `ATS_SITE_PATTERNS` (점핏/원티드/사람인/기아 탤런트 라운지), `isAtsSiteTitle`, `filterAtsFromTitle` |
| `packages/shared/src/core/types.ts:4-9, 190-226` | `REVIEW_NEEDED_REASONS`, `ProjectRecord.postingReviewReasons`, `ProjectRecord.jobPostingFieldConfidence` |
| `packages/shared/src/core/hostedRpc.ts:45, 76-77, 117-118, 489` | RPC 스키마 — `postingReviewReasons`, `jobPostingFieldConfidence`, `AnalyzePostingResult.fieldSources` |
| `packages/runner/src/routes/insightsHandlers.ts:30-40, 65-82, 143` | `evaluatePostingConfidence` (companyName/roleName 둘 다 non-factual 이면 `lowConfidenceExtraction`), `generate_insights` low-confidence guard |

### 2.3 75 URL Fixture 실측 — JSON-LD 커버리지

`docs/plans/2026-04-17-posting-parser-fixtures/results.json` 기준:

| 도메인 그룹 | 총 | JSON-LD present | 현재 success | P1 플립 가능 추정 |
|---|---|---|---|---|
| wanted | 11 | **10** | 0 | **+10** (1건은 `/company/` 페이지라 out-of-scope) |
| jobkorea | 4 | **4** | 3 | **+1** (48891846 partial → success) |
| other_corporate | 19 | 1 (daangn, desc=33) | 3 | 0~+1 (daangn) |
| greetinghr | 2 | 0 | 2 | 0 (`__NEXT_DATA__` 경로로 이미 factual 승격 대상 — P0 bug 수정 이후) |
| jumpit | 17 | **0** | 3* | **0** — P3 대기 |
| recruiter_co_kr | 9 | 0 | 0 | 0 |
| kia | 6 | 0 | 0 | 0 |
| posco/careerlink/lg | 7 | 0 | 0 | 0 |

*Jumpit 3건 success 는 fixture classification 얕음으로 인한 "가짜 success" (handoff §4.1).

**P1 현실 상한**: 현재 8건 + wanted 10 + jobkorea 1 + daangn 0~1 = **18~20건** (handoff 의 23건은 JSON-LD 근거 부족).

### 2.4 Fixture 측정 스크립트 / Golden Test

| 파일 | 역할 |
|---|---|
| `scripts/fetch-posting-fixtures.ts:188-212` | 이미 JSON-LD 분석 유틸 (`analyzeJsonLd`/`findJobPosting`) 보유 — 동일 로직을 shared 모듈로 승격 가능 |
| `scripts/fetch-posting-fixtures.ts:279-315` | `classify()` — 필드 존재 + matchScore 기반. P1 에서 건드리지 않음 (fixture classification 개선은 별건) |
| `packages/shared/src/test/jobPosting.goldens.test.ts:44-115` | 5개 golden 비교. `fieldSources` 가 `expected.fieldSources` 와 일치해야 통과. 현재 모두 `{}` 기대 — P1 에서 **factual** 로 승격 업데이트 필요 |
| `packages/shared/src/test/goldens/posting/*.expected.json` | 5건 — greetinghr×2 + jobkorea×3. 모두 현재 `fieldSources: {}` (P0 bug 반영) |

### 2.5 P0 잔존 리스크 (handoff §4 요약)

| 리스크 | P1 에서의 대응 |
|---|---|
| `buildExtractionResult:484` bug | **Chunk 1 에서 수정** (§3.1) — 선결 조건 |
| Jumpit 3건 가짜 success | 건드리지 않음 — fixture classification 개선 별건 |
| Jobkorea roleName 회사명 prefix | JSON-LD `title` 에 prefix 가 포함돼 있어 동일 문제 존재. **Chunk 4 정규화 로직** 에서 제거 (§3.4) |
| ATS 블랙리스트 범위 | 변경 없음. JSON-LD 경로는 블랙리스트 bypass (§3.3) |

---

## 3. 제안 아키텍처

### 3.1 [선결] P0 bug 수정 — `fieldSources` 누수 복구

`packages/shared/src/core/jobPosting.ts:484`

```diff
-  fieldSources: {}
+  fieldSources: extracted.fieldSources
```

이 수정만으로:
- Greetinghr 2건: `__NEXT_DATA__` 경로에서 seed 로 주입된 companyName 이 `fieldSources.companyName = "factual"` 로 저장됨 (`inferCompanyNameWithTier` line 601-602 경로)
- Jobkorea 3건 (기존 success): `pageTitle` 교차 확인으로 `contextual` tier 부여 가능
- Golden expected.json 5건 `fieldSources` 모두 업데이트 필요 (아무것도 아닌 {} → 실제 tier)

**이 수정을 Chunk 1 의 첫 작업으로 편입.** P1 의 factual 비율 gate 가 측정 가능해지는 전제 조건.

### 3.2 JSON-LD 추출 공용 모듈

```
packages/shared/src/core/jobPosting/
  jsonLd.ts              ← 신규 (JSON-LD 추출 + JobPosting 매핑)
packages/shared/src/core/jobPosting.ts  ← 수정 (jsonLd 모듈 호출)
```

> 이번 P1 에서는 하위 디렉토리(`jobPosting/`) 를 새로 만들되, **기존 `jobPosting.ts` 는 분할하지 않음**. Refactor plan §P3 에서 fetcher/parser 분리 작업 시 한꺼번에 옮김.

```ts
// packages/shared/src/core/jobPosting/jsonLd.ts
export interface JsonLdJobPostingFields {
  title?: string;
  companyName?: string;
  description?: string;      // summary 성격 (§3.5)
  datePosted?: string;
  validThrough?: string;     // ISO → 한국어 normalize 는 호출측
  employmentType?: string;   // "FULL_TIME" 등
  locationText?: string;
  baseSalaryText?: string;
  sourceTier: SourceTier;    // 항상 "factual"
}

export function extractJsonLdJobPosting(html: string): JsonLdJobPostingFields | undefined;

// 내부:
//  1. <script type="application/ld+json"> 블록 전부 순회
//  2. JSON.parse 실패 허용 (블록 여러 개 중 깨진 것 스킵)
//  3. findJobPosting(raw) — 단일/배열/@graph 래핑 모두 지원 (fetch-posting-fixtures.ts:214-240 참조)
//  4. 첫 매칭 JobPosting 반환
//  5. description HTML 포함 가능 → stripTagsAndEntities() 로 정제
```

`scripts/fetch-posting-fixtures.ts:188-240` 의 `analyzeJsonLd`/`findJobPosting` 로직을 **그대로 승격**. 스크립트 쪽은 이 모듈을 import 하여 중복 제거.

### 3.3 파이프라인 통합

`fetchAndExtractJobPosting()` (`jobPosting.ts:237-247`) 흐름 변경:

```
HTML
  │
  ├─ extractEmbeddedJobPostingSource(html)       [기존 __NEXT_DATA__ — factual 경로]
  │    └─ 성공 → detailHtml + seedCompanyName  ──────┐
  │
  ├─ extractJsonLdJobPosting(html)                [신규 JSON-LD — factual 경로]
  │    └─ 성공 → jsonLdFields                    ────┤
  │                                                  │
  ├─ extractTitle(html) + filterAtsFromTitle()    [<title> 폴백 — role]
  │                                                  ▼
  └─ normalizeJobPostingHtml(detailHtml || html) → buildExtractionResult()
                                                     │
                                                     └─ JSON-LD seed 주입
                                                        (companyName/roleName/deadline/overview/...)
```

**핵심 규칙**:

1. `extractEmbeddedJobPostingSource` 는 기존과 동일하게 우선 적용 (GreetingHR `__NEXT_DATA__` 경로는 이미 검증된 factual)
2. `extractJsonLdJobPosting` 는 **추가 seed 공급자**로 동작 — `__NEXT_DATA__` 가 companyName 을 채우지 못했으면 JSON-LD 가 채움
3. `buildExtractionResult` 의 seed 파라미터로 `seedCompanyName` (이미 있음) + 신규 `seedRoleName` + 신규 `jsonLdSeed` 를 전달
4. `extractStructuredJobPostingFields` 내부의 `inferRoleNameWithTier`/`inferCompanyNameWithTier` 에 **JSON-LD 경로 분기 추가** — seed 아닌 "structured source" 경로는 `factual` tier 부여
5. ATS 블랙리스트는 `<title>` 경로에만 적용. JSON-LD 경로는 **bypass** (JSON-LD 의 `hiringOrganization.name` 은 신뢰 가능)
6. JSON-LD 로 채워진 필드의 `fieldSources[field] = "factual"`

### 3.4 Jobkorea roleName prefix 정규화

JSON-LD `title` 에 `hiringOrganization.name` prefix 가 들어있는 패턴 관찰:

| 샘플 | JSON-LD title | hiringOrg | 정리 후 roleName 기대 |
|---|---|---|---|
| jobkorea 48896788 | `소프트웨어 개발자 채용` | `㈜네오정보시스템` | `소프트웨어 개발자` (`채용` suffix 제거) |
| jobkorea 48910001 | `㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)` | `㈜아이엠비씨` | `iOS 앱개발, SNS 운영` (괄호 안 추출) |

**정규화 함수** (`jsonLd.ts` 에 내장):

```ts
export function normalizeJobPostingRoleName(title: string, hiringOrgName?: string): string {
  let s = title.trim();
  // 1. 회사명 prefix 제거: "㈜아이엠비씨 직원 채용" / "㈜아이엠비씨 채용" 등
  if (hiringOrgName) {
    const orgEsc = hiringOrgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^${orgEsc}\\s*(?:직원\\s*)?채용\\s*`), "").trim();
  }
  // 2. 괄호 안 직무 추출: "(iOS 앱개발, SNS 운영)" → "iOS 앱개발, SNS 운영"
  const parenMatch = s.match(/^\(([^)]+)\)$/);
  if (parenMatch) s = parenMatch[1].trim();
  // 3. suffix "채용" 제거
  s = s.replace(/\s*채용\s*$/, "").trim();
  return s;
}
```

### 3.5 JSON-LD 필드 → `JobPostingExtractionResult` 매핑

| JSON-LD | → | Extraction Result | Tier | 조건/가공 |
|---|---|---|---|---|
| `hiringOrganization.name` | → | `companyName` | `factual` | trim |
| `title` | → | `roleName` | `factual` | `normalizeJobPostingRoleName` |
| `description` | → | `overview` | `factual` | HTML strip, 길이 ≥ 50 (§3.5.1) |
| `validThrough` | → | `deadline` | `factual` | ISO → `YYYY년 MM월 DD일, HH:MM` (기존 `normalizeDeadline` 재사용) |
| `datePosted` | (보조) | — | — | P1 에서는 저장 안 함 (추후 필요 시 `postingStartedAt`) |
| `jobLocation.address` | → | `otherInfo` 의 한 줄 | `factual` | streetAddress/addressLocality 합침. 기존 `otherInfo` 가 있으면 prepend |
| `employmentType` | → | `otherInfo` 의 한 줄 | `factual` | `FULL_TIME` → "정규직" 등 매핑 |
| `baseSalary` | (보조) | — | — | P1 에서는 저장 안 함 |

**중요 — `mainResponsibilities`/`qualifications`/`preferred` 는 JSON-LD 에서 채우지 않음**:
- fixture 실측: JSON-LD description 길이가 wanted 140자, jobkorea 91자, daangn 33자 → "summary" 용도
- 기존 regex 가 body 에서 섹션 찾아 채우는 것이 훨씬 풍부
- 따라서 이 세 필드의 `fieldSources` 는 P1 범위에서 `contextual` / `role` / undefined 유지
- **이 세 필드의 factual 승격은 P2 범위** — regex 추출 결과 + JSON-LD/공식 스키마 교차 검증 로직 필요

### 3.5.1 `description` 최소 길이 floor

```ts
const OVERVIEW_MIN_LEN = 50;
if (jsonLd.description && stripHtml(jsonLd.description).length >= OVERVIEW_MIN_LEN) {
  extraction.overview = stripHtml(jsonLd.description);
  extraction.fieldSources.overview = "factual";
}
```

Daangn 33자 case 는 이 floor 로 자동 차단됨.

---

## 4. 데이터 모델 변경 (최소화)

- `JobPostingExtractionResult.fieldSources: Partial<Record<JobPostingFieldKey, SourceTier>>` — **변경 없음**. 이미 P0 에서 존재.
- `JOB_POSTING_FIELD_KEYS` — **변경 없음** (`overview`, `otherInfo` 이미 포함).
- `ProjectRecord.jobPostingFieldConfidence` — **변경 없음**.
- RPC `AnalyzePostingResult.fieldSources` (`hostedRpc.ts:489`) — **변경 없음**.
- Golden `expected.json` 5건 — `fieldSources` 값만 업데이트 (schema 변경 아님).

**P1 은 순수 내부 로직 추가만** 수행. 마이그레이션 없음, RPC breaking 없음.

---

## 5. 파일별 변경 목록

### 5.1 신규 파일

| 경로 | 목적 |
|---|---|
| `packages/shared/src/core/jobPosting/jsonLd.ts` | JSON-LD 추출 + JobPosting 매핑 + roleName 정규화 |
| `packages/shared/src/test/jobPosting.jsonLd.test.ts` | JSON-LD 추출 단위 테스트 (블록 탐색/@graph/배열/description HTML strip/roleName 정규화/deadline normalize) |
| `packages/shared/src/test/goldens/posting/wanted_neptune_h5.html` | wanted 353223 golden HTML (Chunk 5 에서 확보) |
| `packages/shared/src/test/goldens/posting/wanted_neptune_h5.expected.json` | 기대값 — companyName `넵튠(Neptune)`, roleName `H5개발팀 클라이언트 개발`, fieldSources `{companyName: "factual", roleName: "factual"}` |

### 5.2 수정 파일

| 파일 | 위치 | 변경 요약 |
|---|---|---|
| `packages/shared/src/core/jobPosting.ts` | :484 | **[Bug fix]** `fieldSources: {}` → `fieldSources: extracted.fieldSources` |
| `packages/shared/src/core/jobPosting.ts` | :237-247 `fetchAndExtractJobPosting` | JSON-LD 추출 호출 → seed 전달 |
| `packages/shared/src/core/jobPosting.ts` | :274-331 `extractStructuredJobPostingFields` | `jsonLdSeed` 파라미터 추가 → tier 분기 |
| `packages/shared/src/core/jobPosting.ts` | :449-486 `buildExtractionResult` | `jsonLdSeed` 받아서 전달 + JSON-LD 기반 필드 direct assignment |
| `packages/shared/src/core/jobPosting.ts` | :534-564, :595-621 `inferRoleNameWithTier`, `inferCompanyNameWithTier` | JSON-LD seed 있으면 첫 분기에서 `factual` 반환 |
| `packages/shared/src/test/jobPosting.goldens.test.ts` | (변경 없음 — expected.json 만 업데이트) | — |
| `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_frontend.expected.json` | `fieldSources` | `{}` → `{companyName: "factual"}` (NEXT_DATA 경로 + bug fix 효과) |
| `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_backend.expected.json` | 동일 | 동일 |
| `packages/shared/src/test/goldens/posting/jobkorea_neoinfo.expected.json` | `fieldSources` + `companyName`/`roleName` | `{companyName: "factual", roleName: "factual"}`, 이름에서 `채용` suffix 제거 |
| `packages/shared/src/test/goldens/posting/jobkorea_dasansoft.expected.json` | 동일 | 동일 |
| `packages/shared/src/test/goldens/posting/jobkorea_imbc_ios.expected.json` | 동일 + roleName prefix 제거 | `roleName`: `㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)` → `iOS 앱개발, SNS 운영` |
| `scripts/fetch-posting-fixtures.ts` | :188-240 | (선택) `analyzeJsonLd`/`findJobPosting` 를 신규 `jsonLd.ts` 모듈 import 로 교체 (중복 제거) |

### 5.3 삭제 파일

없음.

---

## 6. 구현 스테이지 (Chunk 1~6)

각 chunk 는 독립 commit 단위. 완료 조건 = 자체 unit test 통과 + 이전 chunk 의 회귀 없음 + `./scripts/check.sh` pass.

### Chunk 1 — P0 bug 수정 + golden expected 재동결 (0.5h)

**필수 선결 작업.** P1 의 "factual 비율 ≥ 50%" gate 를 측정 가능하게 함.

1. `jobPosting.ts:484` — `fieldSources: extracted.fieldSources` 로 수정
2. Golden expected.json 5건 재동결 — 현재 파서가 실제 뱉는 `fieldSources` 로 업데이트 (bug fix 후 값)
   - 예상: greetinghr 2건 → `{companyName: "factual"}` (seed 경로)
   - 예상: jobkorea 3건 → `{companyName: "role", roleName: "role"}` 또는 `{}` (현재 `<title>` 폴백 경로 — 아직 JSON-LD 미도입)
3. `jobPosting.goldens.test.ts` 5건 전부 통과
4. `./scripts/check.sh` 100% pass

**Green 기준**: 기존 check.sh 통과 + golden 5/5

### Chunk 2 — JSON-LD 추출 공용 모듈 + unit test (2h)

1. `packages/shared/src/core/jobPosting/jsonLd.ts` 작성
   - `extractJsonLdJobPosting(html)` — `<script type="application/ld+json">` 순회, JSON.parse (블록별 try-catch), `findJobPosting` 재귀 (단일/배열/@graph)
   - `normalizeJobPostingRoleName(title, hiringOrgName)` — §3.4 정규화
   - `stripJobPostingDescriptionHtml(desc)` — `<br>`/`<p>` → 줄바꿈, 나머지 태그 strip, entity decode (`decodeHtmlEntities` 기존 함수 재사용)
   - `normalizeEmploymentType("FULL_TIME")` → `"정규직"`, `"PART_TIME"` → `"계약직"` 등 (간단 매핑)
   - `normalizeValidThroughIso(iso)` → 기존 `normalizeDeadline` 호출 또는 독자 구현
2. `packages/shared/src/test/jobPosting.jsonLd.test.ts` 단위 테스트
   - JSON-LD 없는 HTML → undefined
   - 단일 `@type: JobPosting` 객체
   - 배열 래핑 (`[{@type:"WebPage"}, {@type:"JobPosting"}]`)
   - `@graph` 래핑 (`{@graph: [{@type:"JobPosting", ...}]}`)
   - description HTML entity/tag strip
   - roleName 정규화 5 케이스 (회사명 prefix, 괄호 직무, suffix `채용`)
   - validThrough ISO 정규화 (`2026-05-01T23:59` → `2026년 05월 01일, 23:59`)

**Green 기준**: 신규 unit test 전부 pass + `./scripts/check.sh` pass

### Chunk 3 — `fetchAndExtractJobPosting` 통합 (2h)

1. `jobPosting.ts:237` 근처에서 `extractJsonLdJobPosting(html)` 호출
2. `buildExtractionResult()` 에 `jsonLdFields?: JsonLdJobPostingFields` 파라미터 추가
3. `extractStructuredJobPostingFields()` 에 `jsonLdSeed` 전달 → `inferCompanyNameWithTier` / `inferRoleNameWithTier` 가 JSON-LD 우선
4. JSON-LD 가 공급한 필드는 `fieldSources[field] = "factual"` 로 기록
5. JSON-LD 없거나 부분 공급 시 기존 regex 결과 fallback
6. Wanted/Jobkorea 등에서 ATS 블랙리스트가 `<title>` 을 지워도 JSON-LD 로부터 추출되므로 companyName/roleName 확보 가능 확인
7. 우선순위 규칙 test 추가 (unit test in `jobPosting.tier.test.ts` 확장):
   - seed > JSON-LD > `__NEXT_DATA__` > regex > title
   - JSON-LD 만 있는 경우 tier 모두 factual
   - regex 만 성공하면 tier contextual/role 유지

**Green 기준**: `jobPosting.tier.test.ts` 확장분 포함 전부 pass + golden 5/5 회귀 없음

### Chunk 4 — Jobkorea roleName prefix 제거 + golden 업데이트 (1h)

1. `normalizeJobPostingRoleName` 가 Chunk 2 에서 구현되었으므로 Chunk 3 통합과 함께 자동 작동
2. Golden 3건 (`jobkorea_*.expected.json`) 업데이트:
   - `companyName`: `㈜네오정보시스템 채용` → `㈜네오정보시스템` (JSON-LD `hiringOrganization.name` 기반)
   - `roleName`: `소프트웨어 개발자 채용` → `소프트웨어 개발자`
   - `roleName`: `㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)` → `iOS 앱개발, SNS 운영`
   - `fieldSources`: `{companyName: "factual", roleName: "factual"}`
   - `note` 필드에 "P1 JSON-LD 도입으로 정제 완료" 주석 추가

**Green 기준**: `jobPosting.goldens.test.ts` 5/5 pass (새 기대값 기준)

### Chunk 5 — Wanted Golden 신규 추가 (1h)

> **순서 조정 안내**: 사용자 확정 (2026-04-19) — Wanted HTML 은 Chunk 6 의 `fetch-posting-fixtures.ts --force` 재실행 시 `fetched/` 에 자동 저장되는 파일을 복사한다. 따라서 **Chunk 6 의 fixture fetch 단계를 Chunk 5 보다 먼저 수행** (측정 비교는 Chunk 5 이후로 유예).

1. 사용자에게 wanted 대표 HTML 1건 (`wanted/wd/353223`) 제공 요청 — 또는 `scripts/fetch-posting-fixtures.ts` 재실행으로 `fetched/` 확보 후 복사
2. `packages/shared/src/test/goldens/posting/wanted_neptune_h5.html` + `.expected.json` 추가
3. 기대값:
   ```json
   {
     "sourceUrl": "https://www.wanted.co.kr/wd/353223",
     "expected": {
       "companyName": "넵튠(Neptune)",
       "roleName": "H5개발팀 클라이언트 개발",
       "normalizedTextMinLength": 1500,
       "fieldSources": { "companyName": "factual", "roleName": "factual" },
       "mustNotContain": ["원티드", "점핏", "사람인", "기아 탤런트 라운지", "저작권자"]
     }
   }
   ```

**Green 기준**: golden 6/6 pass

### Chunk 6 — Fixture 재측정 + Gate 판정 (1.5h)

1. `bun run scripts/fetch-posting-fixtures.ts --force`
2. `docs/plans/2026-04-17-posting-parser-fixtures/report.md` 재생성 → 변화 확인
3. 3 Layer 검증:
   - **L1**: `./scripts/check.sh` 100% pass
   - **L2**: `results.json` 비교 — success ≥ 18, misidentification 0 유지
   - **L3** (선택): CDP 자동화 재실행 — wanted 1건 이상 "인사이트 생성 버튼 enabled + companyName tier=factual 표시" 확인. L3 실행은 `docs/plans/2026-04-17-posting-parser-p0-verification.md` 와 동일 절차로 Sonnet 에이전트에 위임.

**Green 기준**: §7 모든 게이트 충족

### 합산

| Chunk | 작업 | 공수 |
|---|---|---|
| 1 | P0 bug fix + golden 재동결 | 0.5h |
| 2 | JSON-LD 공용 모듈 + unit test | 2h |
| 3 | `fetchAndExtractJobPosting` 통합 | 2h |
| 4 | Jobkorea prefix 정규화 + golden 업데이트 | 1h |
| 5 | Wanted golden 신규 | 1h |
| 6 | Fixture 재측정 + L3 | 1.5h |
| **합계** | | **~8h (1~2일)** |

---

## 7. Verification 게이트 (P1 기준)

### 7.1 L1 — 자동 단위/통합

- [ ] `./scripts/check.sh` 100% PASS
- [ ] `jobPosting.jsonLd.test.ts` 전부 PASS
- [ ] `jobPosting.tier.test.ts` 기존 + 확장분 PASS
- [ ] `jobPosting.goldens.test.ts` 6/6 PASS (기존 5 + wanted 1)

### 7.2 L2 — 정량 파이프라인

- [ ] `scripts/fetch-posting-fixtures.ts --force` 재측정 후 `results.json` 비교
- [ ] **success 분류 ≥ 18건** (현재 8 + wanted 10 + jobkorea 1 - 여유 1)
- [ ] **misidentification 0 유지** (P0 달성치 회귀 없음)
- [ ] **factual 비율 측정** (사용자 확정 — 2026-04-19):
  - **분모**: fixture 중 `classification === "success"` 인 엔트리 × **5 필드** (`companyName`, `roleName`, `mainResponsibilities`, `qualifications`, `preferred`) = success 18 기준 **~90**
  - **분자**: 위 5 필드 중 `fieldSources[field] === "factual"` 카운트 합
  - **목표**: ≥ **40%**
  - **P1 상한 근거**: JSON-LD 는 companyName/roleName 2개만 factual 승격 가능 → 최대 2 × 18 = 36, 36/90 = 40%
  - **자격요건/담당업무/우대사항의 factual 승격은 P2 이월** — regex 추출 결과와 JSON-LD/공식 스키마 교차 검증이 P2 범위. §3.5 참조
- [ ] 기존 success 8건 회귀 0 (greetinghr 2 + jobkorea 3 + idis 3)

> **Gate 조정 근거** (2026-04-19 사용자 확정):
> - handoff 의 "success 23" → **success ≥ 18** (fixture 실측 JSON-LD 커버리지: wanted 10 + jobkorea 1 + daangn 0~1 = +10~12 상한)
> - factual 비율 분모를 5 필드로 확장 (사용자 지시) → gate 를 **40%** 로 하향 (P1 JSON-LD 범위 내 최대 달성 가능치)
> - jumpit +3 flip 과 mainResp/qualifications/preferred factual 승격은 P3/P2 로 공식 이월

### 7.3 L3 — CDP 자동화 (선택)

- [ ] wanted 대표 URL 1건 (`https://www.wanted.co.kr/wd/353223`) 에서:
  - companyName = `넵튠(Neptune)`, roleName = `H5개발팀 클라이언트 개발` 정확 추출
  - 필드 배지 `factual` tier 표시 (⚠️ 배지 없음)
  - **인사이트 생성 버튼 enabled** (현재 P0 에선 blocked)
- [ ] jobkorea 48891846 (현재 partial) → success + factual 로 UI 전환
- [ ] Jumpit 3건 변화 없음 확인 (P3 대기 — 여전히 blocked 상태가 정상)

### 7.4 P1 합격 선언 조건

모두 충족 시 P2 진입 승인:
1. L1 전부 pass
2. L2 3개 지표 전부 충족 (success ≥ 18, misid = 0, factual ≥ 40%)
3. L3 (선택적) — Minor 이슈만 있고 Critical/Major 0

---

## 8. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| **JSON-LD 스펙 이형**: `@graph` 래핑 / 배열 / 다중 `@type` | 추출 실패 | `findJobPosting` 재귀로 모든 경우 처리 (`scripts/fetch-posting-fixtures.ts:214-240` 검증 로직 재사용). 파싱 실패 시 조용히 fallback |
| **description HTML entity 섞임** | overview 에 `&amp;` 등 노출 | `decodeHtmlEntities` 기존 함수 + `<br>`/`<p>` 줄바꿈 변환 후 `stripTags` |
| **Jobkorea title prefix 정규화 과잉**: `normalizeJobPostingRoleName` 이 회사명이 우연히 포함된 정상 제목을 깎을 위험 | 정상 공고 roleName 훼손 | regex 앵커 strict (`^{org}\s*(직원\s*)?채용\s*`). golden 3건 + Chunk 2 unit test 로 회귀 감지 |
| **Wanted SPA 에 static JSON-LD 없는 케이스 존재** | 플립 기대치 미달 | Fixture 실측: wanted 11건 중 10건 JSON-LD 확보됨 (`/company/16049` 1건만 회사 페이지 — P2). P1 gate 는 wanted 10건 기준 |
| **Jumpit 0/17 JSON-LD** | handoff §6 "+15" 달성 불가 | 가짜 목표 방지 — P1 gate 를 **+10** 으로 재조정 (§7.2). +15 는 P3 로 이월 공식화 |
| **JSON-LD description 짧음** (daangn 33자 등) | overview 에 부실 값 들어가 LLM 품질 저하 | `OVERVIEW_MIN_LEN = 50` floor (§3.5.1). 미달 시 overview 미채움, `fieldSources.overview` 미설정 |
| **P0 bug 수정 시 greetinghr 2건 fieldSources 값 변화** | golden expected 업데이트 누락 시 테스트 깨짐 | Chunk 1 에서 golden 5건 동시 업데이트. Chunk 2+ 들어가기 전 5/5 green 확인 |
| **fixture 재측정 시 네트워크 변동성**: 타겟 공고가 마감됐거나 HTML 구조 변경 | false regression | `--force` 없이 캐시 사용 모드도 함께 돌려 비교. classification 변화 시 handoff §4.3 의 classification 품질 문제인지 실제 regression 인지 구분 |

---

## 9. P2 와의 경계

**P1 에서 절대 건드리지 않는 것**:

- `extractEmbeddedJobPostingSource()` 내부 `__NEXT_DATA__` 파싱 로직 — GreetingHR `getOpeningById` 전용 상태 유지. Careerlink/기타 Next.js adapter 는 **P2 범위**.
- Fetcher/Parser 분리 (`JobPostingFetcher` 인터페이스) — **P3 범위** (refactor plan §A3)
- Puppeteer / 헤드리스 브라우저 — **P3 범위**
- 사람인 공식 API — **P3a 조건부** (refactor plan §P3a)
- ATS 블랙리스트 패턴 변경 — 불변 유지
- Fixture classification 로직 개선 (handoff §4.3) — 별건 소 리팩터
- `companyContext.reviewNeeded` 이관 — refactor plan §P0 후속 과제로 logged

**P1 에서 설계만 준비 (P2 착수 시 힘 됨)**:

- JSON-LD 공용 모듈은 `packages/shared/src/core/jobPosting/` 디렉토리에 배치 → P3 에서 fetcher/parser 분리 시 이 디렉토리로 나머지 이관
- `jsonLdSeed` 파라미터 명칭/위치는 P3 의 `JobPostingFetcher` 결과 타입 변경 시에도 재사용 가능한 형태로

---

## 10. 확정된 결정 사항 (2026-04-19 사용자 확답)

1. **P1 Gate 수치**: ✅ `success ≥ 18 + factual 비율 ≥ 40%` 확정
2. **Factual 분모**: ✅ `success × 5필드` (`companyName`, `roleName`, `mainResponsibilities`, `qualifications`, `preferred`)
   - 단, P1 범위에서는 앞 2 필드만 factual 승격 가능 → 최대 40%
   - 자격요건/담당업무/우대사항 factual 승격은 **P2 이월**
3. **Wanted `/company/16049` 유형**: ✅ P1 에서 특별 분기 없음, partial 로 남김. URL 패턴 기반 분류는 **P2 범위**
4. **Daangn `OVERVIEW_MIN_LEN = 50`**: ✅ 유지
5. **Wanted golden HTML 확보**: ✅ Chunk 6 fixture fetch 에서 자동 저장된 `fetched/` 파일 복사 (Chunk 5/6 순서 조정)

---

## 11. 준비 스테이지 — CDP 검증용 dev-login 엔드포인트 (~1-2h)

> **이 섹션은 별도 plan 으로 분리됨** → [`docs/plans/2026-04-19-posting-parser-dev-login-l3-verification.md`](../2026-04-19-posting-parser-dev-login-l3-verification.md)
> 구현은 후속 이슈로 보류. 이 PR (posting parser P1) 범위에 포함되지 않음.

P1 Chunk 6 의 L3 CDP 자동화가 P0 검증 때 **Google OAuth 벽**에 막혀 실행되지 못함 (handoff 실행 기록). 재발 방지용 준비 작업을 Chunk 6 착수 전에 수행.

### 범위
- `packages/backend/src/routes/auth.ts` 에 `POST /api/auth/dev-login` 엔드포인트 추가
- `NODE_ENV === "development"` 일 때만 활성 (prod 에서는 404)
- 요청 body: `{ email: string }` → 해당 이메일로 세션 발급 (기존 `createSession` 재사용)
- 응답: 기존 Google OAuth 콜백과 동일한 세션 쿠키
- `.env.dev` 에 `DEV_LOGIN_ALLOWED_EMAILS=test@test.com` 같은 allowlist 추가 (선택)

### 금지
- prod 빌드에 포함되지 않도록 `NODE_ENV` 분기 철저히 확인
- allowlist 없이 임의 이메일 세션 발급 금지

### 검증
- `./scripts/check.sh` 통과
- `./scripts/dev-stack.sh` 기동 후 curl 로 dev-login → `/auth/me` 성공
- prod 빌드 (`NODE_ENV=production`) 에서 404 확인

이 스테이지는 P1 Chunk 6 의 선결 조건이며, P2 이후에도 CDP 검증 인프라로 재사용.

---

## 12. 추정 공수

합산 ~8시간 (1~2일). 상세 §6 표.

---

## Final L2 gate (Chunk 3.5.E 로 갈음)

Chunk 3.5.E fixture 재측정 (커밋 ce0ed6c) 으로 Final L2 gate 갈음. 별도 재실행 불필요.

- factual 비율: 43.8% (46/105)
- 베이스라인 (Chunk 3+4, 52b410c): 27.3% (30/110)
- 델타: +16.5p
- gate 40%: **PASS**

기여 breakdown:
- wanted mainResponsibilities +9 (Chunk 3.5.D JSON-LD description 교차)
- greetinghr roleName +2 (Chunk 3.5.A body cross-validate)
- idis companyName +3 (Chunk 3.5.C hostname hint)

특이: jumpit `53460085` (이비즈테크) success → partial. 길이 ≤40 필터로 garbage 긴 companyName 제거 부작용. 파서 품질 향상이라 회귀 아님.

---

## 13. 참고 파일 인덱스

- Parent refactor plan: `docs/plans/2026-04-17-posting-parser-refactor.md`
- P0 상세 플랜: `docs/plans/2026-04-17-posting-parser-p0-field-confidence.md`
- P0 verification: `docs/plans/2026-04-17-posting-parser-p0-verification.md`
- P0 handoff: `docs/plans/2026-04-17-posting-parser-p0-handoff.md`
- Fixtures (recon): `docs/plans/2026-04-17-posting-parser-fixtures/{urls.txt, results.json, report.md}`
- **현재 파서**: `packages/shared/src/core/jobPosting.ts:177-802` (특히 `:484` bug, `:767-802` __NEXT_DATA__ 파서)
- P0 도입 파일:
  - `packages/shared/src/core/sourceTier.ts`
  - `packages/shared/src/core/atsBlacklist.ts`
  - `packages/shared/src/core/types.ts:4-9, 190-226`
  - `packages/shared/src/core/hostedRpc.ts:45, 76-77, 117-118, 489`
- Runner handler (guard 로직): `packages/runner/src/routes/insightsHandlers.ts:30-40, 65-82, 143`
- Web UI (배지/배너): `packages/web/src/pages/ProjectsPage.tsx:325, 542, 672-680, 944-1054`
- Golden test harness: `packages/shared/src/test/jobPosting.goldens.test.ts`
- Golden fixtures: `packages/shared/src/test/goldens/posting/*.{html,expected.json}`
- Tier test harness: `packages/shared/src/test/jobPosting.tier.test.ts`
- Fixture 수집 스크립트 (JSON-LD 유틸 재사용 원본): `scripts/fetch-posting-fixtures.ts:188-240`
