---
date: 2026-04-19
status: draft
parent: docs/plans/2026-04-19-posting-parser-p1-jsonld.md
related: docs/plans/2026-04-17-posting-parser-refactor.md
---

# P1 Chunk 3.5 — Factual 비율 Gate 보충 (P2 선점 최소 작업)

**Parent plan:** `docs/plans/2026-04-19-posting-parser-p1-jsonld.md`
**Scope:** P1 Gate §7.2 `factual 비율 ≥ 40%` 미달을 메우기 위한 P2 선점 최소 작업
**Decision status:** 수치 블로커 발견 — §10 사용자 확정 대기 후 착수

---

## 0. Executive Summary — 수치 블로커 (중요)

사전 조사 결과, 사용자가 제시한 4개 lever(GreetingHR roleName seed / cross-source validation / idis 전용 힌트 / jumpit classification skip) 의 **정직한 상한은 +5**이며, 목표 +14 에 **도달 불가능**하다.

| Lever | 요청 기대 | 조사 후 실측 가능 | 갭 |
|---|---|---|---|
| GreetingHR NEXT_DATA roleName | +2 (roleName) | +2 | 0 |
| Cross-source companyName (idis) | +6 | +3 (companyName 만) | -3 |
| Cross-source roleName (idis) | 위 +6 에 포함 | **+0** (교차 가능한 소스 없음) | -3 |
| idis 전용 seed | (선택) 보강 | companyName 후보 재설계 필요 — cross-source lever 에 합산 | 0 |
| jumpit classification skip | skip | skip | 0 |
| other_corporate partial 승격 | "몇 건" | **+0** (partial 은 분모 밖) | 약 -3 |
| **합계** | **+14** | **+5 (ceiling)** | **-9** |

분자 30 + 5 = **35/110 = 31.8%** — gate 40% 여전히 미달.

### 선택지 (§10 사용자 확정 필요)
- **(A) 범위 확대** — JSON-LD `description` × regex 섹션 교차로 `mainResponsibilities` factual 승격 (wanted 9 × 1 = +9 또는 더). Gate 통과 가능. 이번 플랜 §3.5 로 옵션 제공.
- **(B) Gate 하향** — P1 Gate 를 ≥ 32% 로 재조정하고 P1 선언. factual 승격의 핵심 작업은 P2 본편으로 이월.
- **(C) 분모 축소** — jumpit 3건 classification 강등으로 success 22 → 19, 분모 95. 분자 35/95 = **36.8%** — 여전히 미달. (단독으로는 의미 없음)

**기본 권장**: (A) + §3.1 + §3.2 조합. 이 플랜은 (A) 수용 시 Chunk 3.5.D 로 확장되는 구조로 설계.

---

## 1. 목표 / 비목표

### 1.1 목표
- **P1 Gate §7.2 factual 비율 ≥ 40% 통과** (또는 §10 에서 확정된 하향 gate)
- **회귀 0건**: 기존 success 22 / misidentification 0 유지
- **최소 침습**: 기존 tier 어휘(`factual/contextual/role`) 와 `fieldSources` 스키마 재사용, RPC/스키마 변경 없음
- **P2 본편 로직 선점만** — Fetcher/Parser 분리·Puppeteer·사람인 API 는 건드리지 않음

### 1.2 비목표 (이번 스테이지에서 명시적으로 하지 않음)
- P3 Puppeteer / SPA 렌더링
- companyHints 스키마 확장 (P2 본편 §A2 — 리팩터 plan)
- RPC `AnalyzePostingResult` 스키마 변경
- Fetcher/Parser 인터페이스 분리 (refactor plan §A3 — P3)
- Careerlink `__NEXT_DATA__` 어댑터 (P2 본편)
- Wanted `/company/` 페이지 별도 분류 (P2 본편)
- Fixture `classify()` 로직 개선 (handoff §4.3 — 별건 소 리팩터)
- 블랙리스트 범위 변경

---

## 2. 현재 상태 분석 (실측 기반)

### 2.1 Gate 현황 (2026-04-19 재측정)

| 지표 | 값 | 기준 | 판정 |
|---|---|---|---|
| success 분류 | 22 | ≥ 18 | ✅ |
| misidentification | 0 | ≤ 0 | ✅ |
| factual 비율 | **27.3% (30/110)** | ≥ 40% (44/110) | ❌ |

### 2.2 factual 분자 내역

분모 110 = success 22 × 5 필드. 분자 30 의 출처별 breakdown:

| 도메인 그룹 | success | factual 필드/건 | 소계 | 근거 |
|---|---|---|---|---|
| wanted | 9 | 2 (companyName, roleName — JSON-LD) | 18 | JSON-LD 경로 |
| jobkorea | 4 | 2 (companyName, roleName — JSON-LD) | 8 | JSON-LD 경로 |
| greetinghr | 2 | **1** (companyName only — `groupInfo.name` seed) | 2 | roleName 은 body detail 라인에서 `role` tier |
| daangn (other_corporate) | 1 | 2 | 2 | JSON-LD 경로 |
| idis | 3 | **0** | 0 | JSON-LD 없음, companyName = 오인식 가까운 body 문단, roleName = body h2 추출 (`role` tier) |
| jumpit | 3 | **0** | 0 | JSON-LD 없음 (P3 대기) |
| **합계** | **22** | | **30** | |

### 2.3 구조 조사 결과 — file:line 확정

#### 2.3.1 GreetingHR — NEXT_DATA `openingsInfo.title` 존재
- `docs/plans/2026-04-17-posting-parser-fixtures/fetched/echomarketing.career.greetinghr.com_001.html:1`
  - `__NEXT_DATA__` 내 `"openingsInfo":{"openingId":209703,"status":"OPEN","title":"[개발자 공개 채용]프론트엔드 신입 채용","detail":"..."}`
  - `<title>[개발자 공개 채용]프론트엔드 신입 채용</title>` (동일)
  - `<meta content="에코마케팅" property="og:site_name">` (companyName 교차검증 근거)
- `docs/plans/2026-04-17-posting-parser-fixtures/fetched/echomarketing.career.greetinghr.com_002.html:1`
  - `openingsInfo.title` = `"[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용"`
- 현재 파서 (`packages/shared/src/core/jobPosting.ts:883-918 extractEmbeddedJobPostingSource`) 는 `openingsInfo.title` 을 `pageTitle` 로만 반환 — `seedRoleName` 으로 활용하지 않음. 따라서 현재 roleName tier = `role` (body detail 라인 매칭).
- 실측 현재 roleName 값: `프론트엔드 개발자` / `백엔드 개발자(Python, Java)` — **body 추출 결과가 NEXT_DATA title 원문보다 정돈됨**. Seed 로 title 을 그대로 주입하면 **텍스트 품질 하락**. (§3.1 설계 근거)

#### 2.3.2 idis — JSON-LD/NEXT_DATA 부재, 정적 DOM 존재
- `docs/plans/2026-04-17-posting-parser-fixtures/fetched/careers.idis.co.kr_001.html:1`
  - `<title>아이디스 채용</title>`
  - `<h1 class="flex items-center gap-2 leading-0">...|IDIS 채용</h1>` (사이트 헤더, 공고별 roleName 아님)
  - `<h2 class="text-3xl font-semibold mb-2 text-center">2026년 2분기 연구소-SW개발(신입) 인재 모집</h2>` (공고 타이틀)
  - 푸터: `<p class="text-lg font-semibold mb-2">(주)아이디스홀딩스</p>`
  - body 내 `(주)아이디스는 채용 과정에서 타사의 영업비밀...` 긴 문단 — 현재 파서가 `/주식회사|\(주\)/` 첫 매치로 잡아 companyName 에 garbage 채움.
  - JSON-LD 블록 없음, `__NEXT_DATA__` `openingsInfo` 구조 없음 (React Server Components `self.__next_f.push`)
- 현재 results.json 측정치: companyName = 긴 garbage 문단, roleName = `2026년 2분기 연구소-SW개발(신입) 인재 모집` (h2 → body 첫 라인 스캔에서 추출). classification = success (score 0.6, companyMatch: true via substring `아이디스` 포함)

#### 2.3.3 파서 진입점 위치
- `packages/shared/src/core/jobPosting.ts:246-258` — `fetchAndExtractJobPosting` 내 embedded/JSON-LD 추출 후 seed 전달
- `packages/shared/src/core/jobPosting.ts:578-621` — `inferRoleNameWithTier` — 현재 분기: `seedRoleName` > `jsonLdSeed.title` > body detail lines > title candidates
- `packages/shared/src/core/jobPosting.ts:656-689` — `inferCompanyNameWithTier` — 현재 분기: `seedCompanyName` > `jsonLdSeed.companyName` > body `/주식회사|\(주\)/` 첫 매치 > title 후보
- `packages/shared/src/core/jobPosting.ts:883-918` — `extractEmbeddedJobPostingSource` — NEXT_DATA `openingsInfo.title`/`groupInfo.name` 추출 경로

### 2.4 수치 제약 — +5 ceiling 도출

| lever | 추가 factual | 누적 분자 | 누적 비율 |
|---|---|---|---|
| 현재 | 0 | 30 | 27.3% |
| §3.1 GreetingHR roleName cross-validate with NEXT_DATA title | +2 | 32 | 29.1% |
| §3.2 + §3.3 idis companyName 후보 재설계 + cross-source 승격 | +3 | 35 | 31.8% |
| (A) §3.5 JSON-LD description × regex responsibilities cross | +9 (wanted 9 건) | 44 | **40.0%** |
| (A) 추가 확장: qualifications | +9 (token overlap 있는 wanted 건) | 53 | **48.2%** |

→ Gate 40% 통과를 위해선 (A) 확장 필수. 순수 요청 3개 lever 만으로는 상한 31.8%.

---

## 3. 제안 아키텍처

### 3.1 Chunk 3.5.A — GreetingHR roleName cross-validation (+2 factual)

**목적**: 현재 body detail 추출 결과(`프론트엔드 개발자`)를 **값으로 유지**하면서 NEXT_DATA `openingsInfo.title` 과의 token overlap 에서 `factual` tier 를 부여한다. Raw seed 주입은 하지 않음(품질 역행 방지 — §2.3.1).

**구현 지점**: `packages/shared/src/core/jobPosting.ts:578-621 inferRoleNameWithTier`

**확장 내용**:
1. `options` 에 `nextDataRoleTitle?: string` 추가 — `extractEmbeddedJobPostingSource` 가 반환한 `openingsInfo.title` 원문을 전달.
2. 기존 분기 유지:
   ```
   seedRoleName (factual)
     → jsonLdSeed.title (factual, normalize 적용)
     → extractRoleFromDetailLines (body — 현재 role/contextual)
   ```
3. body detail 에서 값이 추출된 경우, 아래 순서로 cross-validation 결과에 따라 tier 결정:
   - `options.pageTitle.toLowerCase().includes(fromDetail.toLowerCase())` → `contextual` (기존)
   - **[신규] `options.nextDataRoleTitle` 에 대해 token overlap ≥ 2 개 일치 → `factual`**
   - 나머지 → `role`
4. Token overlap 판정 함수 신규 (§3.2 와 공용):
   ```ts
   function tokenOverlapAtLeast(
     needle: string,
     haystack: string,
     minCount: number,
     minTokenLen = 2
   ): boolean
   ```
   - `needle`/`haystack` 을 공백·`·:()[]{}` 구분자로 split, 정규화(소문자, trim, `\s+→""`).
   - 길이 `< minTokenLen` 토큰 제외.
   - stop-token 리스트 제외: `채용`, `공고`, `공개`, `신입`, `경력`, `채용공고`, `모집`.
   - needle 토큰 중 haystack 의 전체 문자열이 **포함**하는 개수 ≥ `minCount`.

**예상 승격**:
- 001: `프론트엔드 개발자` vs `[개발자 공개 채용]프론트엔드 신입 채용` → 토큰 `프론트엔드`, `개발자` 모두 일치 → factual ✅
- 002: `백엔드 개발자(Python, Java)` vs `[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용` → `백엔드`, `python`, `java` 등 ≥ 2 → factual ✅

**파이프라인 전달 경로 수정**:
- `packages/shared/src/core/jobPosting.ts:883-918 extractEmbeddedJobPostingSource`
  - 반환 인터페이스에 `roleTitle?: string` 추가 → `openingsInfo.title` 원문.
- `packages/shared/src/core/jobPosting.ts:246-258 fetchAndExtractJobPosting`
  - `embeddedSource.roleTitle` 을 `buildExtractionResult` 로 전달.
- `packages/shared/src/core/jobPosting.ts:474-530 buildExtractionResult`
  - `nextDataRoleTitle` 파라미터 추가.
- `packages/shared/src/core/jobPosting.ts:285-356 extractStructuredJobPostingFields`
  - `nextDataRoleTitle` 파라미터 추가 → `inferRoleNameWithTier` 로 전달.

**회귀 리스크**:
- 기존 greetinghr 텍스트 값 불변 (factual tier 승격만). Golden expected.json 2건 (`greetinghr_*.expected.json`) 의 `fieldSources.roleName` 을 `factual` 로 재동결 필요.
- jobkorea 4건은 이미 JSON-LD 로 factual — 영향 없음.
- wanted/daangn 도 JSON-LD 로 factual — 영향 없음.

### 3.2 Chunk 3.5.B — Cross-source validation helper 신규 (공용 함수)

**신규 파일**: `packages/shared/src/core/jobPosting/crossValidate.ts`

**공개 API**:
```ts
export interface CrossValidateCandidate {
  value: string;
  /** 후보 출처 식별자 — debug/logging 용 */
  source:
    | "hostname"
    | "titleStrip"
    | "ogSiteName"
    | "ogTitle"
    | "footer"
    | "h1"
    | "nextDataRoleTitle"
    | "body";
}

export interface CrossValidateResult {
  /** 승격 결과 값 (일치 그룹 중 대표). 승격 실패 시 undefined. */
  value?: string;
  /** tier — factual 승격 조건을 만족하면 "factual" */
  tier?: "factual";
  /** 매칭에 기여한 소스 목록 (debug) */
  matchedSources: CrossValidateCandidate["source"][];
}

/**
 * 여러 후보 중 ≥ minAgreeCount 개가 token overlap 으로 일치하면 factual 승격 결과를 반환.
 * 일치 그룹의 "대표 값" 은 토큰 수가 가장 많은 후보 (품질 보존).
 */
export function crossValidateCandidates(
  candidates: readonly CrossValidateCandidate[],
  opts?: { minAgreeCount?: number; minTokenOverlap?: number; stopTokens?: readonly string[] }
): CrossValidateResult;

/** §3.1 에서도 재사용 — 토큰 overlap 판정 */
export function tokenOverlapAtLeast(
  needle: string,
  haystack: string,
  minCount: number,
  opts?: { minTokenLen?: number; stopTokens?: readonly string[] }
): boolean;
```

**판정 규칙 (default)**:
- `minAgreeCount` 기본 2
- `minTokenOverlap` 기본 1 (후보 값 하나만 쓸 때는 1토큰 일치로 충분히 같다고 판단)
- `stopTokens` 기본 `["채용", "공고", "공개", "신입", "경력", "모집", "idis", "inc", "corp", "ltd"]` (회사 도메인 영어 약칭 등 false-positive 방지)
- 토큰 추출: `split(/[\s·:|,/\-()\[\]{}【】〔〕]+/)` 후 trim, 빈 토큰 제외, 소문자화
- 한국어 조사 제거: `\s*(?:는|은|이|가|을|를|의|와|과)\s*$` 토큰 말미에서 trim
- 위양성 방지: 두 후보 값이 **완전히 동일한 문자열인 경우 같은 출처로 간주 (agree count 증가 금지)** — origin 필드로 dedup

### 3.3 Chunk 3.5.C — `inferCompanyNameWithTier` 후보 재설계 (+3 factual, idis 전용 효과)

**문제** (§2.3.2): 현재 body `/주식회사|\(주\)/` 첫 매치가 우선순위가 높아 garbage(`(주)아이디스는 채용 과정에서 타사...`)를 추출. Cross-source 를 "기존 결과 위에 덧붙이는" 방식으로만 추가하면 garbage 는 여전히 value 로 남고 tier 만 올라가는 위험이 있다 (false factual 승격).

**해결**: 후보 **수집 → cross-vote → 대표 값 선택** 의 3 단계로 `inferCompanyNameWithTier` 를 재편.

**구현 지점**: `packages/shared/src/core/jobPosting.ts:656-689 inferCompanyNameWithTier`

**새 흐름**:
```ts
function inferCompanyNameWithTier(lines, options): FieldWithTier | undefined {
  // 1. seed 우선 (기존)
  if (options.seedCompanyName) return { value, tier: "factual" };
  if (options.jsonLdSeed?.companyName) return { value, tier: "factual" };

  // 2. 후보 수집 (신규)
  const candidates: CrossValidateCandidate[] = [];
  //   2a. hostname-derived: "careers.idis.co.kr" → "idis" → 한국어 매핑 가능 시 추가
  //       (§3.3.1 참조 — 휴리스틱 제한)
  //   2b. titleStrip: pageTitle 에서 "채용" suffix / "공고" 제거
  //   2c. ogSiteName: <meta property="og:site_name"> 값 (HTML 에서 별도 추출 필요)
  //   2d. footer: body 마지막 30줄 내 /주식회사|\(주\)/ 짧은 (≤ 40자) 라인
  //   2e. body: 기존 "/주식회사|\(주\)/ 첫 매치" — 단 길이 ≤ 40자 로 필터 (garbage 문단 배제)

  // 3. Cross-validate
  const result = crossValidateCandidates(candidates, { minAgreeCount: 2 });
  if (result.tier === "factual" && result.value) {
    return { value: result.value, tier: "factual" };
  }

  // 4. Fallback: 단일 후보 중 하나를 선택 (contextual 또는 role)
  //    - titleStrip 단독 → role (기존 title 폴백과 동일)
  //    - body 단독(≤40자) + pageTitle includes → contextual
  //    - body 단독 → role
  return pickFallback(candidates, options);
}
```

#### 3.3.1 hostname-derived 후보 — 극히 보수적으로

**이번 스테이지의 핵심 false-positive 방어선**. P2 본편의 `companyHints` 스키마는 건드리지 않지만, hostname 단서만은 hardcode 로 유한한 매핑만 허용한다.

- `packages/shared/src/core/jobPosting/companyHostnames.ts` 신규 (최소 매핑 테이블, 신규 스키마 아님):
  ```ts
  export const HOSTNAME_COMPANY_HINTS: ReadonlyArray<{ hostPattern: RegExp; companyName: string }> = [
    { hostPattern: /(?:^|\.)idis\./i, companyName: "아이디스" },
    // 필요시 추후 확장 — 이번 스테이지에서는 idis 만 추가
  ];
  ```
- 목적: idis 에서만 cross-vote 에 hostname 한 표를 추가. 다른 도메인(wanted/jobkorea/daangn/...) 은 JSON-LD 경로로 이미 factual 이라 무관.
- 의도적으로 `companyHints` (P2 본편 §A1 범위) 로 키우지 않음. 이 테이블은 향후 P2 본편에서 `companyHints` 로 **이관**될 임시 자리(staging).

#### 3.3.2 `og:site_name` 추출 유틸
- `extractOgSiteName(html: string): string | undefined` 를 `jobPosting/jsonLd.ts` 에 addend, 또는 신규 `jobPosting/metaTags.ts`. 이번 스테이지에선 `jsonLd.ts` 안에 조용히 추가하여 파일 신설 최소화.

#### 3.3.3 길이 필터 (garbage 문단 방어)
- 기존 body match: `/주식회사|\(주\)/` 첫 매치 → **길이 ≤ 40자** 인 경우만 후보.
- idis 의 `(주)아이디스는 채용 과정에서 타사...` (약 200자+) 는 자동 배제.
- 길이 40자는 fixture 상 합리적 상한 (`㈜네오정보시스템 채용` = 12자, `(주)아이디스홀딩스` = 10자 등).

**예상 승격 — idis 3건**:
- hostname = `아이디스` (1표)
- titleStrip(`아이디스 채용`) → `아이디스` (1표)
- footer(`(주)아이디스홀딩스`) → `아이디스홀딩스` (token `아이디스` overlap 으로 일치 집계)
- body 길이 초과 → 필터 배제
- cross-vote agree ≥ 2 → value=`아이디스`, tier=factual → **+3 factual** ✅

**회귀 리스크**:
- 기존 fixture 의 다른 사이트 companyName 값 변경 가능성. 특히:
  - greetinghr 2건: seed(`groupInfo.name`) 경로 유지 → 변화 없음.
  - jobkorea 4건: `jsonLdSeed.companyName` → 변화 없음.
  - wanted 9건 + daangn 1건: `jsonLdSeed.companyName` → 변화 없음.
  - jumpit / posco / recruiter_co_kr 등 partial: 후보 수집 방식이 바뀌므로 텍스트 변화 가능. Golden 5건 중 jobkorea 3건의 companyName 이 변경되면 fail.
- **완화**: 후보 수집을 **seed 부재 시에만** 실행. JSON-LD/NEXT_DATA 경로가 있는 도메인은 기존 path 로 분기.
- **완화**: `./scripts/check.sh` + fixture 재측정으로 classification 변화 여부 3-way diff (§7).

### 3.4 Chunk 3.5.C-2 — idis 전용 seed (별도 필요성 재평가)

최초 요청의 "idis 전용 파서 힌트" 는 §3.3 의 hostname 매핑 + footer 후보 로직으로 **흡수됨**. 별도 seed 주입 경로는 불필요.

roleName 의 경우: idis 는 JSON-LD/NEXT_DATA 가 없고, `<title>`/`<h1>`/`og:title` 모두 사이트명(`아이디스 채용`)만 포함하여 roleName 교차가 불가능. → **roleName factual 승격 불가, role tier 유지**. (+0)

### 3.5 Chunk 3.5.D — (옵션 A, 사용자 확정 시) JSON-LD description × mainResponsibilities cross-validation (+9~18 factual)

**사용자 선택지 (A) 수용 시에만 착수**. Gate 40% 통과를 위한 마지막 lever.

**로직**:
1. `extractStructuredJobPostingFields` 에서 body regex 로 얻은 `mainResponsibilities` 값과 `jsonLdSeed.description` 의 token overlap 을 비교.
2. Overlap ≥ **5 토큰** 이면 `fieldSources.mainResponsibilities = "factual"` (wanted/jobkorea 다수 건 mainResp length ≥ description length 의 70%, description 이 factual 공식 소스이므로 cross match 되면 body 결과를 factual 로 인정).
3. 단, description length < 50 (daangn) 은 §3.5.1 `jsonLdOverviewMinLength` 와 같은 floor 로 제외.
4. `qualifications` 는 JSON-LD 에 별도 필드가 없음 → description 에 `자격요건`/`requirements` 헤딩이 있거나 role token 이 겹치면 factual (더 보수적). 이 세부는 Chunk 3.5.D 설계 시 fixture 확인 후 확정.

**예상 효과** (wanted 9건 × 최대 2 필드 × partial agree):
- mainResponsibilities: wanted 9건 중 description length ≥ 50 인 건만 확인 필요 — results.json 실측상 wanted 9건 모두 description length ≥ 139. → **최대 +9**.
- qualifications: description 에서 토큰 overlap 되는 건만 (보수적으로 +3~+6 예상).
- jobkorea 4건: description 길이가 91~289자로 짧아 +0~+4 범위.

누적 bestcase: +9~+18 factual → 비율 **40~53%** → Gate 통과.

**리스크**:
- False positive factual (description 이 요약인데 body 섹션이 실제 내용인 경우 token 일부 일치로 factual 승격될 수 있음).
- → Overlap threshold 를 보수적으로(5 토큰) 두고 fixture 재측정 시 misidentification 증가 여부 확인. 증가 시 threshold 상향.
- 이 작업은 P2 본편 §"regex 교차 검증" 의 공식 범위이므로 여기서 선점하면 P2 시 재사용 가능 — 로직을 `jobPosting/crossValidate.ts` 에 동일 체계로 구현.

---

## 4. 데이터 모델 변경 (최소화)

- `JobPostingExtractionResult.fieldSources` — **변경 없음**. 기존 `Partial<Record<JobPostingFieldKey, SourceTier>>` 유지.
- `JobPostingExtractionRequest` — **변경 없음** (내부 seed 전달만 확장).
- `SourceTier` 어휘 — **변경 없음** (factual/contextual/role).
- RPC `AnalyzePostingResult` — **변경 없음**.
- `ProjectRecord` — **변경 없음**.
- Golden `expected.json` — greetinghr 2건 `fieldSources.roleName` 추가 재동결만 필요. jobkorea 3건 / wanted 1건(Chunk 5) 은 기존 값 유지.

---

## 5. 파일별 변경 목록

### 5.1 신규 파일

| 경로 | 목적 |
|---|---|
| `packages/shared/src/core/jobPosting/crossValidate.ts` | `crossValidateCandidates`, `tokenOverlapAtLeast` — §3.2 |
| `packages/shared/src/core/jobPosting/companyHostnames.ts` | `HOSTNAME_COMPANY_HINTS` — §3.3.1 최소 매핑 |
| `packages/shared/src/test/jobPosting.crossValidate.test.ts` | cross-validate 단위 테스트 (토큰 overlap, stop-token, origin-dedup, false-positive 방지) |

### 5.2 수정 파일

| 파일 | 위치 | 변경 요약 |
|---|---|---|
| `packages/shared/src/core/jobPosting.ts` | `:246-258 fetchAndExtractJobPosting` | `embeddedSource.roleTitle` 경유 전달, `ogSiteName` 추출 후 전달 |
| `packages/shared/src/core/jobPosting.ts` | `:285-356 extractStructuredJobPostingFields` | `nextDataRoleTitle`, `ogSiteName`, `fetchedUrl` 파라미터 추가 → cross-validate 경로로 전달 |
| `packages/shared/src/core/jobPosting.ts` | `:474-530 buildExtractionResult` | 동일 파라미터 추가 |
| `packages/shared/src/core/jobPosting.ts` | `:578-621 inferRoleNameWithTier` | §3.1 cross-validate 분기 추가 (NEXT_DATA title / og:title) |
| `packages/shared/src/core/jobPosting.ts` | `:656-689 inferCompanyNameWithTier` | §3.3 후보 수집 재설계 — seed 없을 때만 cross-vote 경로 |
| `packages/shared/src/core/jobPosting.ts` | `:883-918 extractEmbeddedJobPostingSource` | 반환 인터페이스에 `roleTitle` 추가 |
| `packages/shared/src/core/jobPosting/jsonLd.ts` | 파일 끝 | `extractOgSiteName(html)` 공개 헬퍼 추가 (또는 신규 헬퍼 파일) |
| `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_frontend.expected.json` | `fieldSources` | `{companyName: "factual"}` → `{companyName: "factual", roleName: "factual"}` |
| `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_backend.expected.json` | 동일 | 동일 |

### 5.3 (옵션 A 수용 시 추가 수정)

| 파일 | 위치 | 변경 요약 |
|---|---|---|
| `packages/shared/src/core/jobPosting.ts` | `:474-530 buildExtractionResult` | §3.5 JSON-LD description × mainResponsibilities/qualifications cross-validate 호출, `fieldSources` 승격 |
| `packages/shared/src/test/jobPosting.crossValidate.test.ts` | 추가 | description × section cross-validate 단위 테스트 |

### 5.4 삭제 파일
없음.

---

## 6. 구현 스테이지

### Chunk 3.5.A — GreetingHR roleName cross-validation (~45분)

1. `extractEmbeddedJobPostingSource` 에 `roleTitle` 반환 추가.
2. 전달 경로 (fetchAndExtract → build → extractStructured → inferRoleNameWithTier) 업데이트.
3. `tokenOverlapAtLeast` + `crossValidate.ts` 최소 구현 (§3.2 의 subset).
4. `inferRoleNameWithTier` 에 NEXT_DATA title cross-validate 분기 추가.
5. Golden 2건 (`greetinghr_*.expected.json`) `fieldSources.roleName = "factual"` 재동결.
6. `jobPosting.tier.test.ts` 확장: "seed/jsonLd/NEXT_DATA title cross" 각 분기 커버.

**Green 기준**: `./scripts/check.sh` pass + golden 6/6 pass + tier test 확장분 pass.

### Chunk 3.5.B — crossValidate 공용 모듈 완성 (~45분)

1. `jobPosting/crossValidate.ts` 공개 API 완성 (§3.2 full).
2. `jobPosting.crossValidate.test.ts` 단위 테스트:
   - token overlap 기본 케이스 / stop-token / 조사 trim / origin dedup / 대표값 선택 (토큰 수 기준)
   - false-positive 방지: idis hostname `idis` vs body `iDiStributed computing` 같은 false match 차단
3. 리팩터: §3.1 의 inline token overlap 호출을 crossValidate.ts 로 흡수.

**Green 기준**: 신규 단위 테스트 pass + check.sh pass + golden 6/6 pass.

### Chunk 3.5.C — idis companyName cross-vote + 후보 재설계 (~1.5h)

1. `companyHostnames.ts` 신규 + hostname-derive 헬퍼 (`deriveCompanyNameHints(hostname)`).
2. `extractOgSiteName(html)` 헬퍼 추가.
3. `inferCompanyNameWithTier` 후보 수집 재설계:
   - seed 경로 최우선 유지.
   - seed 없을 때만 candidates 수집 → cross-vote.
   - body `/주식회사|\(주\)/` 길이 ≤ 40 필터.
4. `fetchAndExtractJobPosting` 에서 `hostname`/`ogSiteName` 을 `extractStructuredJobPostingFields` 로 전달.
5. Tier test 확장: idis 합성 fixture 로 companyName factual 승격 케이스, 오탐 회귀 케이스 (body 긴 문단) 포함.
6. Fixture 재측정 전: `./scripts/check.sh` + golden 6/6 pass 확인.

**Green 기준**: check.sh + golden 6/6 + 확장 tier test pass + idis companyName 값이 `아이디스` 로 변경(실제 fixture 측정 단계에서 확인).

### Chunk 3.5.D — (옵션 A 수용 시) JSON-LD description × section cross (~1h)

1. `buildExtractionResult` 에서 `jsonLdSeed.description` 과 body regex `mainResponsibilities`/`qualifications` 값 cross-validate.
2. Threshold 기본 5토큰, stop-token 확장.
3. 단위 테스트 — wanted 샘플 HTML 2건으로 factual 승격 확인 + threshold 아슬아슬한 케이스 차단.

**Green 기준**: check.sh + golden 6/6 + 추가 단위 테스트 pass.

### Chunk 3.5.E — Fixture 재측정 + Gate 판정 (~45분)

1. `bun run scripts/fetch-posting-fixtures.ts --force` (네트워크 이슈 시 기존 캐시 기준 측정 대체).
2. `report.md`, `results.json` 재생성.
3. §7 검증.

### 합산 공수 (옵션별)

| 옵션 | Chunk | 공수 |
|---|---|---|
| **기본 (A 미수용)** | A+B+C+E | **~3.5h** — 분자 +5, 비율 31.8% (gate 미달) |
| **확장 (A 수용)** | A+B+C+D+E | **~4.5h** — 분자 +14~+23, 비율 40~48% (gate 통과) |

요청 공수 3~4h 내 (A) 수용 시 4.5h 로 약간 초과. 범위 축소 여지:
- Chunk 3.5.D 를 `mainResponsibilities` 만 승격하도록 축소 → 3.75h, +14 도달 (분모 계산: 30+5+9=44/110 = **40.0%** 정확히 경계).

---

## 7. Verification (factual 비율 재측정)

### 7.1 L1 — 자동 단위/통합
- [ ] `./scripts/check.sh` 100% PASS
- [ ] `jobPosting.crossValidate.test.ts` PASS (§5.1)
- [ ] `jobPosting.tier.test.ts` 확장분 PASS
- [ ] `jobPosting.goldens.test.ts` 6/6 PASS (greetinghr `fieldSources.roleName: "factual"` 포함)

### 7.2 L2 — Fixture 재측정
- [ ] `bun run scripts/fetch-posting-fixtures.ts --force`
- [ ] `results.json` 에서 정량 비교:
  - success ≥ 22 (회귀 0)
  - misidentification = 0 (회귀 0)
  - classification 변화 건수 나열 (특히 idis 3건의 `parse.companyName` 가 `아이디스` 로 변경됐는지)
- [ ] **factual 비율 재계산**:
  - 분모: success × 5필드 (`companyName`, `roleName`, `mainResponsibilities`, `qualifications`, `preferredQualifications`). 필드명은 P1 plan §7.2 합의와 동일.
  - 분자: `fieldSources[field] === "factual"` 카운트.
  - 기본 옵션 기대: 35/110 = **31.8%** (Gate 40% 미달 — 사용자 (B) 수용 시에만 P1 종료 가능).
  - 옵션 A 수용 기대: 44/110 = **40.0%** ~ 53/110 = **48.2%**.

### 7.3 L3 — CDP 수동 검증 (선택)
- [ ] idis 1건 (`https://careers.idis.co.kr/job/6`) 에서:
  - companyName = `아이디스`, tier = factual
  - roleName = body h2 값, tier = role (여전히 ⚠️ 배지 — 정상)
- [ ] greetinghr 1건: roleName tier = factual (⚠️ 배지 사라짐)

### 7.4 합격 선언 조건 (option dependent)

| Option | success | misid | factual 비율 | 판정 |
|---|---|---|---|---|
| (A) | ≥ 22 | 0 | ≥ 40% | P1 Gate 통과 |
| (B) | ≥ 22 | 0 | ≥ 32% (재조정) | P1 Gate 통과 (하향) |
| 아무것도 수용 안 함 | ≥ 22 | 0 | 31.8% | P1 Gate 미달, P2 본편 착수 필요 |

---

## 8. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| Cross-source factual 위양성 (idis hostname + title-strip 이 모두 동일 소스로 취급돼서 count=2 에 실제는 1 출처) | 허위 factual | `CrossValidateCandidate.source` 로 origin 태깅 + 동일 `source` 는 dedup. hostname 과 titleStrip 은 DIFFERENT source 로 간주 (각각 URL 과 HTML 에서 옴). |
| body `/주식회사\|(주)/` 길이 ≤40 필터가 정상 회사명(예 `주식회사 네오정보시스템 채용 담당자` 17자) 을 절단 | 기존 success 회귀 | jobkorea 샘플 값은 JSON-LD seed 경로로 우선 매칭되어 body 후보 미사용 → 영향 없음. Golden 재동결로 보장. |
| NEXT_DATA `roleTitle` 이 본문보다 더 구체적인 경우(현재는 반대) seed 로 강제 주입 시 텍스트 품질 하락 | 실사용자 경험 저하 | §3.1 설계 원칙: NEXT_DATA title 은 **validator**. value 는 기존 body detail 유지. Golden 에 text-value 는 기존 값 유지하여 회귀 없음을 보증. |
| §3.5 (옵션 A) description 짧은 공고에서 false factual 승격 | 다운스트림 품질 저하 | description length ≥ 50 floor 유지 + token overlap threshold 5토큰 (기본). Fixture 측정 시 misidentification 증가 확인 후 필요 시 상향. |
| `HOSTNAME_COMPANY_HINTS` 가 무한히 자람 | 유지보수 부담 | 이번 스테이지는 idis 만 추가. P2 본편 `companyHints` 로 이관 예정 (주석으로 명시). |
| fixture 재측정 중 네트워크 변동 | 허위 회귀 | `--force` 전후로 캐시 기반 비교도 실행 — 기존 HTML 고정 시점 측정도 가능. |
| Chunk 3.5.C 가 partial 건 companyName 텍스트를 변경 → fixture classification score 변화 (misid 가짜 상승) | L2 gate fail 우려 | §3.3.3 길이 필터 + seed 경로 최우선 유지로 JSON-LD/NEXT_DATA 있는 도메인엔 영향 없게 설계. partial 건의 value 변화는 OK (더 나은 방향). |

---

## 9. P2 본편 범위와의 경계 (이번에 선점하지 않음)

**이번 스테이지에서 건드리지 않는 P2 로직**:
- `companyHints` 정식 스키마 (refactor plan §A2) — `HOSTNAME_COMPANY_HINTS` 는 임시 staging. 이관 시 확장될 자리.
- Fetcher/Parser 분리 (`JobPostingFetcher`) — P3 범위.
- Careerlink `__NEXT_DATA__` 어댑터 — queryKey shape 조사 필요. P2 본편.
- Wanted `/company/16049` 별도 분류 — P2 본편.
- ATS 블랙리스트 축소/확장 — 고정 유지.
- `normalizeJobPostingRoleName` 의 `[...]` prefix 제거 확장 (greetinghr 001 의 `[개발자 공개 채용]` 처리) — `normalizeOpeningTitle` 이 존재하나 활용 흐름 재정비는 P2 본편.

**이번 스테이지에서 설계만 준비**:
- `jobPosting/crossValidate.ts` — P2 본편 "regex 교차검증" 의 foundation.
- `jobPosting/companyHostnames.ts` — P2 `companyHints` 이관 전 staging.
- JSON-LD description × section cross-validate 프레임워크 (옵션 A) — P2 본편 "regex 교차검증" 의 핵심 구현 선점.

---

## 10. 확정 결정 포인트 (사용자 확답 필요)

### D1. Gate 도달 방식 (핵심)
사전 조사 결과 +14 factual 은 §3.1 + §3.3 만으로 **도달 불가**. +5 ceiling. 세 가지 선택:

- **(A) — 권장**: §3.5 확장(JSON-LD description × mainResponsibilities cross-validate) 수용. +14 달성 가능. 공수 +1h. **P2 본편 로직의 일부를 여기서 선점** (유지관리상 허용 가능 — refactor plan 범위 안에서 진행).
- **(B)**: Gate 를 ≥ 32% 로 하향. §3.1 + §3.3 만. 공수 ~3.5h. P1 선언 후 P2 본편 착수.
- **(C)**: Chunk 3.5 를 보류하고 P2 본편 직행. 이 플랜 스케줄 폐기.

### D2. 옵션 A 수용 시 범위
- **(A1)** mainResponsibilities 만 (threshold 5토큰). 안전 선택. 공수 +30분, 비율 40%.
- **(A2)** mainResponsibilities + qualifications + preferredQualifications 전부 (threshold 각 5토큰). 비율 48%~. 공수 +1h, false factual 위험 증가.

### D3. idis hostname staging 허용 여부
- `HOSTNAME_COMPANY_HINTS` 최소 테이블을 P2 이관 전까지 유지하는 것을 승인하는지 명확히 해야 함.
- 대안: idis 케이스도 cross-source 후보에서 제외 → idis companyName 은 여전히 garbage. success 건이지만 tier = role. +0.

### D4. Golden 재동결 범위
- greetinghr 2건의 `fieldSources.roleName` 을 `factual` 로 업데이트하는 것은 이번 스테이지에서 **필수**. 확인 필요.

---

## 11. 추정 공수

| 옵션 조합 | Chunk | 공수 |
|---|---|---|
| **B** (gate 하향) | 3.5.A + B + C + E | **~3.5h** |
| **A1** (mainResp 만) | 3.5.A + B + C + D(축소) + E | **~4.0h** |
| **A2** (mainResp + qual) | 3.5.A + B + C + D(full) + E | **~4.5h** |

요청 상한 3~4h 과 근접. **A1 권장** — Gate 정확 경계 통과 + 위양성 리스크 최소.

---

## 12. 참고 파일 인덱스

- **P1 Parent plan**: `docs/plans/2026-04-19-posting-parser-p1-jsonld.md` (§7.2 Gate 정의, §9 P2 경계, §10 확정 결정)
- **Refactor plan**: `docs/plans/2026-04-17-posting-parser-refactor.md` (§P2 범위 — 이번 플랜은 §P2 부분 선점)
- **Fixture 실측 (2026-04-19)**:
  - `docs/plans/2026-04-17-posting-parser-fixtures/report.md`
  - `docs/plans/2026-04-17-posting-parser-fixtures/results.json`
- **현재 파서** (Chunk 3+4 완료 상태):
  - `packages/shared/src/core/jobPosting.ts:246-258` — `fetchAndExtractJobPosting` 진입점
  - `packages/shared/src/core/jobPosting.ts:578-621` — `inferRoleNameWithTier`
  - `packages/shared/src/core/jobPosting.ts:656-689` — `inferCompanyNameWithTier`
  - `packages/shared/src/core/jobPosting.ts:883-918` — `extractEmbeddedJobPostingSource`
  - `packages/shared/src/core/jobPosting/jsonLd.ts:1-349` — JSON-LD 공용 모듈
  - `packages/shared/src/core/sourceTier.ts:1-24` — tier 어휘
- **Fixture HTML (조사 근거)**:
  - `docs/plans/2026-04-17-posting-parser-fixtures/fetched/echomarketing.career.greetinghr.com_001.html` (§2.3.1)
  - `docs/plans/2026-04-17-posting-parser-fixtures/fetched/echomarketing.career.greetinghr.com_002.html`
  - `docs/plans/2026-04-17-posting-parser-fixtures/fetched/careers.idis.co.kr_001.html` (§2.3.2)
  - `docs/plans/2026-04-17-posting-parser-fixtures/fetched/careers.idis.co.kr_002.html`
  - `docs/plans/2026-04-17-posting-parser-fixtures/fetched/careers.idis.co.kr_003.html`
- **Golden 테스트 (업데이트 대상)**:
  - `packages/shared/src/test/jobPosting.goldens.test.ts`
  - `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_frontend.expected.json`
  - `packages/shared/src/test/goldens/posting/greetinghr_echomarketing_backend.expected.json`
- **Tier 테스트**:
  - `packages/shared/src/test/jobPosting.tier.test.ts`
- **Fixture 측정 스크립트**:
  - `scripts/fetch-posting-fixtures.ts:279-315 classify()`, `:323-344 computeMatchScore()`
