# P0 — 오인식 방어 + `fieldConfidence` 스키마

**Parent plan:** `docs/plans/2026-04-17-posting-parser-refactor.md`
**Stage:** P0 (리팩터 1단계)
**Scope:** 국내 전용 공고 파서
**Goal:** fixture 기준 misidentification 32건 → ≤5건
**예상 공수:** 1~2일 (당초 "반나절" 추산은 과소 — 스키마·UI·테스트까지 포함)

---

## 1. 배경

recon 결과(`docs/plans/2026-04-17-posting-parser-fixtures/report.md`):
- 진짜 성공률 10.7% (8/75)
- **misidentification 32건 (43%)** — `<title>` 폴백이 "점핏", "원티드", "기아 탤런트 라운지" 같은 ATS 사이트명을 공고 회사/직무로 인식하여 인사이트 생성 파이프라인에 garbage 전달
- 현재 파서(`packages/shared/src/core/jobPosting.ts`)는 추출 결과에 신뢰도 정보가 없어 downstream이 "이 회사명이 진짜 회사인지 사이트명인지" 판단 불가

**P0의 역할**: 리팩터 전체의 기반 스키마·방어 레이어. P1(JSON-LD)·P2(nextData)·P3(Puppeteer) 모두 이 tier 정보를 채워주는 레이어로 동작.

## 2. 측정 게이트

**통과 조건 (fixture 재측정)**:

- [ ] `misidentification` 카테고리 ≤ **5건** (현재 32건)
- [ ] `success` 8건 회귀 0건 (greetinghr 2, jobkorea 3, careers.idis.co.kr 3)
- [ ] `./scripts/check.sh` 통과
- [ ] Golden fixture 테스트 신규 5건 모두 통과

**측정 명령**:
```bash
bun run scripts/fetch-posting-fixtures.ts --force
diff docs/plans/2026-04-17-posting-parser-fixtures/results.json{,.baseline}
```

실패 시 P1 진입 금지. 원인 분석 후 P0 재작업.

## 3. 아키텍처 결정

### 3.1 Source Tier — 프로젝트 공용 타입으로 승격

현재 `companyInsightArtifacts.ts:101` 의 `SOURCE_TIER_RULES_BLOCK`에 tier 규칙이 **문자열 리터럴로만** 존재. 타입 정의는 없음. P0에서 공용 타입으로 정식 도입:

```ts
// packages/shared/src/core/sourceTier.ts (신규)
export const SOURCE_TIERS = ["factual", "contextual", "role"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];
export const SourceTierSchema = z.enum(SOURCE_TIERS);

export function isFactual(t: SourceTier): boolean { return t === "factual"; }
export function isWeakTier(t: SourceTier): boolean { return t === "role"; }
```

### 3.2 fieldConfidence 매핑 규칙

| 출처 | Tier |
|---|---|
| JSON-LD `JobPosting` (P1 도입 후) | `factual` |
| `__NEXT_DATA__` detail payload (greetingHr 등) | `factual` |
| 공식 API (P3a 도입 후) | `factual` |
| HTML heading regex + **≥2 corroborating 신호** (title / og:meta / 다른 heading 중 교차 일치) | `contextual` |
| HTML heading regex 단독 | `role` |
| `<title>` 단독 폴백 | `role` (자동) |
| ATS 사이트명 블랙리스트 매칭 | **폐기** (필드 자체 추출 안 함) |

### 3.3 reviewNeeded 사유 통합 필드

**현재**: `companyContext.reviewNeeded.reason = "openDartAmbiguous"` — 회사 맥락 전용
**문제**: 공고 분석 단계의 사유(low confidence 등)는 담을 곳이 없음
**결정**: `ProjectRecord`에 **범용 사유 배열** 추가. openDartAmbiguous는 P0에서 건드리지 않고 병행 유지 (점진 이관은 이후 스테이지에서 판단).

```ts
// packages/shared/src/core/types.ts
export type ReviewNeededReason =
  | "lowConfidenceExtraction"  // neu
  | "extractionError"           // neu (JobPostingFetchError 등)
  | "postingAmbiguous";         // neu (사이트명만 감지된 경우)
```

### 3.4 파서의 fetch / 분리 구조

**현재**: `fetchAndExtractJobPosting(input)` 이 fetch + 파싱 통합. `normalizeJobPostingHtml(html)` 은 이미 HTML만 받는 내부 함수로 존재 → **P3 Puppeteer 도입 시 재사용 가능**. P0에서는 별도 분리 작업 불필요.

## 4. 데이터 모델 diff

### 4.1 `JobPostingExtractionResult` (`packages/shared/src/core/jobPosting.ts:10-29`)

```diff
 export interface JobPostingExtractionResult {
   source: "url" | "manual";
   fetchedAt: string;
   fetchedUrl?: string;
   pageTitle?: string;
   normalizedText: string;
   companyName?: string;
   roleName?: string;
   deadline?: string;
   // ... (나머지 공고 필드)
   keywords: string[];
   warnings: string[];
+  fieldSources: Partial<Record<JobPostingFieldKey, SourceTier>>;
 }

+export type JobPostingFieldKey =
+  | "companyName" | "roleName" | "deadline" | "overview"
+  | "mainResponsibilities" | "qualifications" | "preferredQualifications"
+  | "benefits" | "hiringProcess" | "insiderView" | "otherInfo";
```

### 4.2 `ProjectRecord` (`packages/shared/src/core/types.ts:180-214`)

```diff
 export interface ProjectRecord {
   // ... 기존 필드
   insightStatus: InsightStatus;
+  postingReviewReasons?: readonly ReviewNeededReason[];
+  jobPostingFieldConfidence?: Partial<Record<JobPostingFieldKey, SourceTier>>;
 }
```

둘 다 **optional + default `[]` / `{}`** 으로 추가 → 기존 레코드 JSON 파일은 로드 시 Zod가 빈 값 주입. 마이그레이션 hook 불필요.

### 4.3 `ProjectRecordSchema` (`packages/shared/src/core/storage.ts:142`)

```diff
 const ProjectRecordSchema = z.object({
   // ...
+  postingReviewReasons: z.array(ReviewNeededReasonSchema).optional().default([]),
+  jobPostingFieldConfidence: z.record(JobPostingFieldKeySchema, SourceTierSchema).optional().default({}),
 });
```

### 4.4 RPC 스키마 (`packages/shared/src/core/hostedRpc.ts`)

`analyze_posting` / `analyze_insights` 응답에 `fieldSources` 포함하도록 Zod schema 확장. 기존 클라이언트는 optional로 받아 호환.

## 5. 파일별 수정 지점

### 5.1 신규 파일

| 경로 | 목적 |
|---|---|
| `packages/shared/src/core/sourceTier.ts` | SourceTier 타입 + 헬퍼 |
| `packages/shared/src/core/jobPosting/atsBlacklist.ts` | ATS 사이트명 블랙리스트 + 매처 |
| `packages/shared/src/test/goldens/posting/*.html` | Golden fixture HTML 5건 |
| `packages/shared/src/test/goldens/posting/*.expected.json` | 각 golden 기대값 |
| `packages/shared/src/test/jobPosting.goldens.test.ts` | Golden 회귀 테스트 |
| `packages/shared/src/test/jobPosting.tier.test.ts` | Tier 분류 단위 테스트 |

### 5.2 수정 파일

| 경로 | 수정 지점 | 변경 내용 |
|---|---|---|
| `packages/shared/src/core/types.ts:180-214` | `ProjectRecord` 인터페이스 | 2개 필드 추가 (§4.2) |
| `packages/shared/src/core/types.ts` (상단) | | `ReviewNeededReason`, `JobPostingFieldKey` export |
| `packages/shared/src/core/jobPosting.ts:10-29` | `JobPostingExtractionResult` | `fieldSources` 추가 |
| `packages/shared/src/core/jobPosting.ts:454-457` | `extractTitle()` | 반환 전 ATS 블랙리스트 필터 적용. 매칭 시 `undefined` |
| `packages/shared/src/core/jobPosting.ts:487-540` | `inferCompanyName` / `inferRoleName` | 필드별 tier 반환하도록 signature 확장 → 호출부에 `fieldSources` 누적 |
| `packages/shared/src/core/jobPosting.ts:158-227` | `fetchAndExtractJobPosting()` | 반환 result에 `fieldSources` 채워서 돌려주기 |
| `packages/shared/src/core/storage.ts:142, 178-204, 216-220, 376` | Zod schema + `createProject` / `updateProject` | 신규 필드 기본값 |
| `packages/shared/src/core/hostedRpc.ts` (`AnalyzePostingResult` 근방) | | `fieldSources` 응답 스키마 추가 |
| `packages/runner/src/routes/insightsHandlers.ts:33-75` (`analyzeProjectInsightsService`) | line 63, 71 | 추출 후 `all-role tier` 감지 → `postingReviewReasons` 에 `lowConfidenceExtraction` 추가 + `insightStatus = "reviewNeeded"` |
| `packages/runner/src/routes/insightsHandlers.ts:77-136` (`generateProjectInsightsService`) | line 125-167 사이 | LLM 호출 직전 guard: `postingReviewReasons` 에 `lowConfidenceExtraction` 포함 시 거부 + `{jobId: null, review: "lowConfidenceExtraction"}` 반환 |
| `packages/web/src/pages/ProjectsPage.tsx:284-320` (`projects-analysis-banner`) | | ⚠️ 배지 + 필드별 tier 표시 + 메시지 + 생성 버튼 disable 로직 |

### 5.3 ATS 블랙리스트 설계

```ts
// packages/shared/src/core/jobPosting/atsBlacklist.ts
const ATS_SITE_PATTERNS = [
  /점핏/,
  /원티드/i,
  /사람인/,
  /잡코리아/i,
  /기아\s*탤런트\s*라운지/i,
] as const;

export function isAtsSiteTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  return ATS_SITE_PATTERNS.some((p) => p.test(normalized));
}

export function filterAtsFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  return isAtsSiteTitle(title) ? undefined : title;
}
```

호출: `extractTitle()` 결과를 `filterAtsFromTitle()` 통과시킨 뒤 `inferCompanyName/inferRoleName` 에 주입. 매칭 시 pageTitle 자체가 없어지므로 `<title>` 폴백 경로 작동 안 함 → `fieldSources.companyName` 자연스럽게 `role` tier 못 받음 (heading만 있으면 heading 기반 role 또는 contextual, 아예 추출 실패면 undefined).

## 6. UI 설계 (`projects-analysis-banner`)

### 6.1 표시 규칙

- `fieldSources[field] === "role"` 이거나 필드 자체가 비어있는 경우 → **⚠️ 아이콘 + "자동 감지 — 확인 필요"** 레이블
- 전체 추출 필드 중 `factual` 0건 + `role`/undefined 가 대다수 → 배너 상단 경고 박스 강조
- `postingReviewReasons` 에 `lowConfidenceExtraction` 존재 시 — 인사이트 생성 버튼 `disabled` + 툴팁 "공고 회사명·직무를 확인한 뒤 수정 후 다시 시도해주세요"

### 6.2 메시지 카피 (한국어)

- 배너 상단: `"자동 감지 결과 신뢰도가 낮습니다. 아래 필드를 확인하고 직접 수정해주세요."`
- 필드 경고: `"자동 감지 — 확인 필요"` (툴팁: `"공고 페이지 구조상 정확 추출이 어려웠습니다. 값을 직접 입력하거나 공고 텍스트를 붙여넣어 주세요."`)
- 생성 버튼 disabled 툴팁: `"공고 필드 신뢰도가 낮아 인사이트 생성이 차단되어 있습니다. 회사명·직무를 확인·수정한 뒤 다시 시도해주세요."`

### 6.3 컴포넌트 변경

- `projects-analysis-banner` (line 284 근방): 조건부 경고 박스 섹션 추가
- `projects-analysis-warnings` (line 314-320): 기존 warnings 리스트는 유지, 그 위에 tier-기반 경고 블록 삽입
- `CreateProjectWorkspace` 상태: `analysisResult.fieldSources` 를 받아 필드별 tier 계산 로직 추가
- 인사이트 생성 버튼 (기존 `onAnalyzeInsights`/`onGenerateInsights` 트리거): `postingReviewReasons` 확인 → disabled

### 6.4 CSS

`packages/web/src/styles/*` 내 적절한 파일에 `.projects-analysis-warning-badge` / `.projects-analysis-field-warning` 스타일 추가. 기존 색상 팔레트 따름 (warning orange 계열).

## 7. 마이그레이션

**전략**: optional + Zod default 로 자동 마이그레이션.

- `postingReviewReasons?: readonly ReviewNeededReason[]` — default `[]`
- `jobPostingFieldConfidence?: Partial<Record<...>>` — default `{}`
- 기존 프로젝트 JSON 로드 → Zod가 빈 값 주입 → 수동 저장 시점에 채워져 저장됨

**검증**:
- 기존 테스트 프로젝트 fixture (있다면) 로드 후 `ProjectRecordSchema.parse()` 통과 확인
- 필요 시 `packages/shared/src/test/storage.migration.test.ts` 신규 — legacy record 호환성 검증

## 8. 테스트 전략

### 8.1 Golden Fixture (이 스테이지에서 도입)

**위치**: `packages/shared/src/test/goldens/posting/`

**초기 5건** (현재 `success` 분류에서 안정적인 케이스):
1. `greetinghr_001.html` (에코마케팅 프론트엔드) + `.expected.json`
2. `greetinghr_002.html` (에코마케팅 백엔드) + `.expected.json`
3. `jobkorea_001.html` (네오정보시스템) + `.expected.json`
4. `jobkorea_002.html` (다산소프트) + `.expected.json`
5. `jobkorea_003.html` (iMBC iOS) + `.expected.json`

(careers.idis.co.kr 3건은 success지만 실제 적합성은 Chunk 6 착수 시 확인 후 편입 결정)

**expected.json 스키마**:
```json
{
  "sourceUrl": "https://...",
  "expected": {
    "companyName": "넵튠(Neptune)",
    "roleName": "H5개발팀 클라이언트 개발",
    "normalizedTextMinLength": 500,
    "fieldSources": {
      "companyName": "factual",
      "roleName": "factual"
    },
    "mustNotContain": ["원티드", "점핏"]
  }
}
```

**HTML 확보**: `docs/plans/2026-04-17-posting-parser-fixtures/fetched/` 에서 해당 파일 복사. **주의**: 사이트 저작권·크기 관리를 위해 HTML을 최소화(5~20KB 수준으로 body 외 불필요 script 제거) 여부 Chunk 6 에서 판단.

**테스트 러너**: 기존 node:test 유지. `jobPosting.goldens.test.ts` 신규.

### 8.2 Tier 분류 단위 테스트 (`jobPosting.tier.test.ts`)

- `<title>` = "점핏 | 개발자 채용" → companyName/roleName 추출 skip, `postingReviewReasons.includes("postingAmbiguous")` 기대
- `<title>` = "넵튠 | H5개발팀 클라이언트 개발" + 본문 heading 없음 → companyName tier `role`
- heading "담당 업무" 발견 + `<title>` 일치 → tier `contextual`
- JSON-LD 있음 (P1 이후 활성화) → tier `factual`

### 8.3 Runner handler 통합 테스트

- `packages/runner/src/test/insightsHandlers.lowConfidence.test.ts` 신규
- `analyze_insights` 호출 시 all-role tier → `postingReviewReasons` 에 `lowConfidenceExtraction` 포함
- `generate_insights` 호출 시 차단 + review 응답

### 8.4 UI 테스트

- 현재 저장소에 React component 단위 테스트 관행 미약 → **신규 도입 보류**. 대신 수동 검증 체크리스트 (§10) 로 대체. Chunk 6 종료 시 판단.

## 9. 작업 chunk 분할 (위임 단위)

각 chunk는 독립 PR 또는 commit 단위로 구성. 단위 테스트 통과 + 이전 chunk의 스냅샷 회귀 없음이 완료 조건.

| # | Chunk | 담당 | 예상 | 완료 조건 |
|---|---|---|---|---|
| 1 | Source Tier 공용 타입 + 헬퍼 | Sonnet | 30분 | `sourceTier.test.ts` 통과 |
| 2 | 스키마 확장 (shared types + Zod + RPC) | Sonnet | 1시간 | 기존 storage 테스트 회귀 없음 |
| 3 | 파서 tier 분류 + ATS 블랙리스트 | Sonnet | 2시간 | `jobPosting.tier.test.ts` 통과 |
| 4 | Runner handler guard | Sonnet | 1.5시간 | `insightsHandlers.lowConfidence.test.ts` 통과 |
| 5 | Web UI 경고 배지 + 생성 버튼 차단 | Sonnet | 1.5시간 | 수동 UX 검증 (§10) |
| 6 | Golden fixture 도입 + 회귀 테스트 | Sonnet | 2시간 | `jobPosting.goldens.test.ts` 5건 통과 |
| 7 | 검증 게이트 (fixture 재측정 + check.sh) | Claude | 1시간 | misidentification ≤5, 회귀 0 |

**총: ~9.5시간 (1~2일)**

Codex(무거운 리팩터) 대신 Sonnet 선호 — 각 chunk가 단순 패턴 복제 + 명확한 스키마. 유일하게 Codex 고려 대상은 Chunk 3 (파서 로직 확장) — 기존 로직 이해 필요. Chunk 3 위임 시 프롬프트 명확히 작성.

## 10. 수동 검증 체크리스트 (Chunk 5·7)

`./scripts/dev-stack.sh` 실행 후:

### 10.1 오인식 케이스 확인
- [ ] jumpit URL (`https://jumpit.saramin.co.kr/position/53594223`) 로 공고분석 → companyName/roleName 비어있거나 경고 배지
- [ ] wanted URL (`https://www.wanted.co.kr/wd/353223`) → 같음 (P0에서는 여전히 실패, P1에서 해결 예정)
- [ ] kia URL 같음
- [ ] 인사이트 생성 버튼 disabled + 툴팁 정상 표시

### 10.2 회귀 확인
- [ ] greetinghr URL (`https://echomarketing.career.greetinghr.com/ko/o/209703`) → companyName/roleName 정확 추출 + fieldSources = factual
- [ ] jobkorea URL 같음
- [ ] 인사이트 생성 정상 시작 (ready 상태까지)

### 10.3 스크립트
```bash
./scripts/check.sh
bun run scripts/fetch-posting-fixtures.ts --force
```

## 11. 위험 / 롤백

| 위험 | 영향 | 완화 |
|---|---|---|
| Zod default로 마이그레이션 시 type narrowing 이슈 | 컴파일 오류 | TS strict, Zod `.default()` 패턴은 저장소에 전례 있음 (storage.ts:142 근방 확인). 문제 시 readonly optional 유지 |
| 블랙리스트 과잉 매칭으로 진짜 회사명 차단 | 정상 공고 false rejection | 초기 5 패턴만, 모두 "대기업이 공고 title로 쓸 리 없는" 고유 명사. fixture 재측정으로 회귀 감지 |
| UI 배지로 인해 기존 레이아웃 깨짐 | 사용자 경험 저하 | Chunk 5 수동 검증 필수. 실패 시 배지 위치 조정 후 재검증 |
| 인사이트 생성 차단이 너무 공격적 → 수동 수정 후 진행 불가 | 사용자 blocker | disabled 상태에서도 **필드 수동 편집** 가능 유지. 편집 시 tier → `manual`/`factual` 로 격상. 이 로직 Chunk 5에 포함 |
| `postingReviewReasons` 와 `companyContext.reviewNeeded` 이중 관리 | 코드 일관성 저하 | P0는 신규 사유만 신규 필드로. openDart 이관은 별도 스테이지 후속 과제로 logged |

**롤백 경로**: P0 전체를 단일 branch/feature-flag로 묶지 않음 (스키마 변경이 영구적). 대신 각 chunk PR 단위로 검증 후 병합. Chunk 3~5 중 문제 발생 시 해당 chunk만 revert.

## 12. 후속 과제 (이 플랜 밖)

- `companyContext.reviewNeeded.reason` → `ProjectRecord.postingReviewReasons`(또는 더 일반적 `reviewReasons`) 통합 이관 — P1~P2 사이 별도 소 refactor
- UI component 단위 테스트 도입 (이번엔 수동 검증으로 대체)
- 블랙리스트 외부화 (JSON 설정 파일로) — 운영 중 새 ATS 추가 시 배포 없이 처리 가능하도록 — P4 고려

## 13. 추적 링크

- Parent: `docs/plans/2026-04-17-posting-parser-refactor.md`
- Fixtures: `docs/plans/2026-04-17-posting-parser-fixtures/`
- Advisor 조언 반영 (2026-04-17): Tier 공용화, `<title>` 자동 role, regression goldens 도입
- 기존 Source Tier 규칙: `packages/shared/src/core/companyInsightArtifacts.ts:101-126`
- 현재 파서: `packages/shared/src/core/jobPosting.ts`
- Runner handler: `packages/runner/src/routes/insightsHandlers.ts:33-136`
- Web UI: `packages/web/src/pages/ProjectsPage.tsx:284-320`
