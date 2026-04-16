# 2026-04-16 · OpenDART 회사 선택 모달 버그픽스 & UX Gap 해소

작성자: planner (Claude) / 상태: Draft / 스테이지: 독립 (Insight 다중소스 파이프라인 후행 버그픽스)

## 0. 배경

최근 커밋 `3b7f7b6 feat(shared,runner): 인사이트 생성 다중 소스 파이프라인 도입` 은 DART 미보유를 **정상 경로**(웹/공고 tier 로 진행)로 전환했으나, `web` 패키지의 모달 UX 와 `storage`/`openDart` 의 기존 버그가 함께 남아 있어 다음 3가지 문제가 사용자에게 노출된다.

### 관측된 증상
- 검색어 `더케이교직원나라(주)` → OpenDART 회사 선택 모달 후보가 `더케이`, `원`, `케이`, `케이` 같은 **토큰 조각** + 중복.
- 모달에 "넷 다 아님 / DART 없이 진행" 선택지가 없어, 리팩터 이후 유일한 탈출구가 **취소(= 인사이트 생성 abort)** 뿐임.

## 1. 목표 / 비목표

### 목표
1. [Fix-1] `companyName` 변경 시 stale `openDartCandidates` 를 invalidate.
2. [Fix-2] `resolveCompanyCandidates` fuzzy match 필터 강화 — 토큰 조각·중복 후보 제거.
3. [Fix-3] `OpenDartCandidateModal` 에 **"일치하는 회사 없음 (DART 없이 진행)"** 선택지 추가, 선택 시 DART 스킵 경로로 인사이트 생성을 재개.

### 비목표
- 인사이트 다중소스 파이프라인 재설계 — 2026-04-15 스테이지에서 이미 완료, 건드리지 않음.
- WebSearchProvider / cache / tier 프롬프트 변경 — 해당 스테이지 범위.
- DART `OpenDartClient.resolveAndFetchCompany` 전체 재설계 — 부분 필터 개선만.
- 공고 분석 로직 변경 (`jobPosting.ts`).

## 2. 현재 상태 분석 (file:line 기반)

### 2.1 Fix-1 — stale candidates 잔존
- `packages/shared/src/core/storage.ts` `updateProjectInfo` (대략 :270–:330 근처).
- 현재 로직: `openDartCorpCode` 가 명시적으로 patch 될 때만 `openDartCandidates` 를 clear 하거나 유지.
- `companyName` 변경은 candidates 의 근거(검색어)를 바꾸지만 invalidate 트리거가 없어 **이전 검색 후보가 다음 재생성 시 그대로 모달에 떠오름**.

### 2.2 Fix-2 — fuzzy match 과도 매칭
- `packages/shared/src/core/openDart.ts` `resolveCompanyCandidates` (대략 :320–:360, 서브에이전트 조사상 :342 근처).
- 현재 fuzzy 로직: 검색어의 substring/token 일치 기반으로 후보를 모음 → 짧은 토큰(`더케이`, `원`, `케이`)이 과도하게 수용되고, 동일 `corp_name` 의 중복 엔트리(다른 `corp_code`)가 그대로 흘러감.

### 2.3 Fix-3 — 모달 UX gap
- `packages/web/src/components/OpenDartCandidateModal.tsx` — 버튼 `취소` + `선택 후 생성` 2개만.
- `packages/web/src/pages/ProjectsPage.tsx`:
  - `handleGenerateInsights` — `openDartCandidates?.length` 이면 모달 오픈 + early return.
  - `handleDartCandidateConfirm` — 선택한 corpCode 를 patch 한 뒤 재생성.
  - 취소 경로 — 모달 close 만, 인사이트 생성은 abort.
- 리팩터 철학(`DART 미보유 = 정상 경로`)과 **불일치**.

## 3. 제안 아키텍처

### 3.1 Fix-3 데이터 흐름

```
OpenDartCandidateModal
  ├─ 후보 리스트 (기존)
  ├─ [NEW] "일치하는 회사 없음 (DART 없이 진행)" 옵션 (리스트 상단 또는 3번째 버튼)
  ├─ 취소 → onCancel()     (기존: 모달 close만)
  ├─ 선택 후 생성 → onConfirm(corpCode)  (기존)
  └─ [NEW] DART 없이 진행 → onSkipDart()  (신규 콜백)

ProjectsPage.handleDartSkip
  ├─ storage.updateProjectInfo({
  │     slug,
  │     openDartCandidates: null,        // invalidate
  │     openDartSkipRequested: true,     // "사용자가 명시적으로 스킵했다" 플래그
  │   })
  └─ regenerateInsights(slug)            // reviewNeeded → 재진입

runner/insightsHandlers.ts
  └─ collectCompanyContext 호출 전:
        if (project.openDartSkipRequested) → dart source 를 "unavailable" 로 강제 처리
        (= ambiguous 재분기 없이 그대로 web+posting tier 로 진행)
```

### 3.2 의사결정 요약

| 결정 지점 | 옵션 | 권장 | 이유 |
|---|---|---|---|
| 스킵 표현 | 리스트 항목 / 3번째 버튼 | **3번째 버튼** (보조 톤) | 후보 중 하나를 잘못 고르는 사고 방지 |
| 스킵 상태 저장 | 휘발 / 영속 | **영속 (`openDartSkipRequested`)** | 재생성 반복 시 동일 ambiguous 로 다시 막히지 않게 |
| 스킵 해제 | 수동 / 자동 | **`companyName` 변경 시 자동 해제** (Fix-1 과 동일 트리거에 편승) | UX 단순성 |
| Fuzzy 필터 | 최소 길이 / 유사도 임계 / dedupe | **세 가지 모두 적용** | 토큰·중복 둘 다 차단 |

## 4. 타입/스키마 변경

### 4.1 `ProjectRecord` (shared)
- `openDartSkipRequested?: boolean` 추가.
- Zod 스키마(`schemas.ts`)에 동일 필드 추가 (optional, default undefined).
- `storage.updateProjectInfo` patch 대상에 포함.
- 마이그레이션 불필요 (optional, 기존 레코드는 undefined 로 해석).

### 4.2 WS 프로토콜 (`webviewProtocol.ts`)
- **변경 없음.** 기존 `openDartCandidates` 메시지 재사용.
- 스킵은 `updateProjectInfo` 패치 + 재생성으로 처리 → 신규 메시지 불필요.

### 4.3 모달 props (`OpenDartCandidateModal.tsx`)
- `onSkipDart: () => void` prop 추가.
- 내부 버튼 영역에 3번째 버튼 `"일치하는 회사 없음 (DART 없이 진행)"` 추가.

## 5. 파일별 변경 목록

### 수정 (shared)
- `packages/shared/src/core/storage.ts` — `updateProjectInfo`:
  - `companyName` 변경 감지 시 `openDartCandidates` 를 `undefined` 로 clear.
  - 동일 트리거에서 `openDartSkipRequested` 도 `undefined` 로 reset (Fix-1 & Fix-3 연동).
  - `openDartSkipRequested` patch 전달 지원.
- `packages/shared/src/core/openDart.ts` — `resolveCompanyCandidates` (및 필요한 경우 하위 fuzzy 함수):
  - (a) **최소 길이**: `corp_name.length >= 2` 이면서 검색어와의 의미 있는 매칭(공통 substring ≥ 2자 + 추가 문자 이상)이 있는 후보만 유지.
  - (b) **유사도 임계**: 검색어 대비 Jaccard/Levenshtein 기반 임계값(0.3 등) 미달 후보 제거. 단순 구현은 "검색어에 후보명이 포함되거나 후보명에 검색어가 포함되는 경우만" 허용.
  - (c) **Dedupe**: `corp_code` 기준 고유, 동일 `corp_name` 에 여러 `corp_code` 가 있으면 `stock_code` 보유 > 상장 여부 > 최신 modify_date 순 우선.
  - (d) 최대 후보 수 상한 (예: 10) 유지.
- `packages/shared/src/core/schemas.ts` (또는 `types.ts`) — `openDartSkipRequested` 필드 추가.

### 수정 (runner)
- `packages/runner/src/routes/insightsHandlers.ts` — `collectCompanyContext` 호출 전:
  - `project.openDartSkipRequested === true` 면 dart 소스를 `unavailable` 상태로 스킵 (ambiguous 분기 우회).
  - 스킵 시 notices 에 `"dart: skipped by user"` 기록.

### 수정 (web)
- `packages/web/src/components/OpenDartCandidateModal.tsx`:
  - `onSkipDart` prop 추가.
  - 버튼 영역에 `"일치하는 회사 없음 (DART 없이 진행)"` 버튼 추가 — 보조 톤(secondary/ghost 스타일), 기존 `취소`·`선택 후 생성` 와 구분.
- `packages/web/src/pages/ProjectsPage.tsx`:
  - `handleDartSkip` (신규) — `updateProjectInfo({ openDartCandidates: null, openDartSkipRequested: true })` → `regenerateInsights(slug)`.
  - `<OpenDartCandidateModal onSkipDart={handleDartSkip} ... />` 연결.

### 신규 (tests)
- `packages/shared/src/test/storage.openDartCandidates.test.ts` (또는 기존 storage 테스트 확장):
  - `companyName` 변경 시 `openDartCandidates` 및 `openDartSkipRequested` clear 검증.
  - `openDartCorpCode` 명시 patch 시 candidates clear 유지 (기존 계약 회귀 없음).
- `packages/shared/src/test/openDart.resolveCandidates.test.ts`:
  - 토큰 조각(`더케이` 만 검색어와 공유) 후보가 제거되는지.
  - 동일 `corp_name` 중복 엔트리가 dedupe 되는지.
  - 상장 여부/modify_date 기반 우선순위.
- `packages/runner/src/test/insightsHandlers.skipDart.test.ts`:
  - `openDartSkipRequested=true` 프로젝트에서 ambiguous 분기 없이 ready 로 종료되는지.

## 6. 단계별 구현 순서 (각 스테이지 green)

### Stage A · storage & schema
- `ProjectRecord` / zod 스키마에 `openDartSkipRequested` 추가.
- `storage.updateProjectInfo` 의 `companyName` 변경 감지 & invalidate 로직 구현.
- 유닛 테스트 추가 (shared/test).
- Exit: `./scripts/check.sh` green, 기존 storage 테스트 회귀 없음.

### Stage B · openDart fuzzy 필터 강화
- `resolveCompanyCandidates` 필터·dedupe 추가.
- 유닛 테스트 추가.
- Exit: check.sh green, `더케이교직원나라(주)` 가상 fixture 로 토큰 후보 제거 확인.

### Stage C · runner skip 분기
- `insightsHandlers.ts` 에 `openDartSkipRequested` 분기 구현.
- runner 테스트 추가.
- Exit: check.sh green, 기존 ambiguous 플로우 회귀 없음.

### Stage D · 모달 UX & Projects 페이지 연결
- `OpenDartCandidateModal` 에 `onSkipDart` prop + 3번째 버튼 추가.
- `ProjectsPage` 에 `handleDartSkip` 연결.
- 수동 QA: 스크린샷 케이스 재현 후 "DART 없이 진행" 선택 시 인사이트 ready 확인.
- Exit: check.sh green, `./scripts/dev-stack.sh` 기동 후 UI QA.

### Stage E · 문서
- `docs/development/ARCHITECTURE.md` — 인사이트 파이프라인 섹션에 "사용자 DART 스킵" 경로 추가.
- `docs/plans/CURRENT_STAGE.md` — 본 스테이지 완료 표기.

각 스테이지는 commit 단위 독립 green. Stage A~C 는 백엔드 전용이며 UI 노출 없이도 안전. Stage D 머지 시 실사용 가능.

## 7. 테스트 전략

### 7.1 자동
- Shared: storage / openDart 유닛 테스트.
- Runner: insightsHandlers skip 분기 통합 테스트.
- Web: 모달 컴포넌트 테스트가 이미 있다면 3번째 버튼 클릭 시 `onSkipDart` 호출 케이스 추가 (없으면 생략).

### 7.2 수동 QA (dev-stack.sh)
1. `더케이교직원나라(주)` 로 프로젝트 생성 → 모달 노출.
2. 모달에서 "DART 없이 진행" 클릭 → 인사이트 생성 ready (web/posting tier 로만).
3. 동일 프로젝트에서 `companyName` 을 다른 이름으로 변경 후 재생성 → candidates·skip 플래그 모두 reset, 새 DART 검색이 수행됨을 확인.
4. 기존 ambiguous 플로우 (후보 선택 후 생성) 회귀 없음.
5. DART 정상 단일 매칭 케이스 회귀 없음.

## 8. 리스크 & 완화책

1. **`openDartSkipRequested` 지속성 부작용** — 사용자가 회사명만 바꿨는데 스킵 상태가 남으면 신규 회사도 DART 없이 돌림.
   - 완화: Stage A 에서 `companyName` 변경 시 skip 플래그도 함께 reset.
2. **Fuzzy 필터 과도 제거** — 정당한 후보까지 제거.
   - 완화: 유닛 테스트 고정 fixture 로 기존 정상 케이스 보존 검증, 최소 길이 2, 상장사 우선 정렬.
3. **모달 UX 혼동** — 3번째 버튼이 "취소"와 시각적으로 겹쳐 오클릭.
   - 완화: 보조 톤(secondary) + 문구 `"일치하는 회사 없음 (DART 없이 진행)"` 로 의도 명시, 위치는 취소 왼쪽 또는 리스트 하단.
4. **runner 스킵 분기 누수** — skip 플래그가 false 인데도 스킵 경로로 분기되는 버그.
   - 완화: runner 테스트에서 true/false 양쪽 케이스 명시.

## 9. 검증 체크리스트

### 9.1 자동
- [ ] `./scripts/check.sh` green.
- [ ] Stage A/B/C/D 각각 독립 green.
- [ ] 신규 테스트 3종 pass.

### 9.2 수동
- [ ] `./scripts/dev-stack.sh` 기동 후 스크린샷 케이스 재현 → 모달 노출.
- [ ] 후보 리스트에 토큰 조각 후보 없음 확인.
- [ ] "DART 없이 진행" 버튼 노출 + 클릭 시 인사이트 ready.
- [ ] `companyName` 변경 → candidates·skip 플래그 reset.
- [ ] 기존 ambiguous 선택 플로우 회귀 없음.
- [ ] DART 단일 매칭 케이스 회귀 없음.

## 10. 커밋 계획

Stage 별 1 커밋, 총 5 커밋 내외. Commit convention 준수:

```
fix(shared): companyName 변경 시 openDartCandidates 무효화
fix(shared): resolveCompanyCandidates 부분매칭 후보·중복 제거
feat(runner): openDartSkipRequested 플래그로 DART 스킵 분기 지원
feat(web): OpenDART 선택 모달에 "DART 없이 진행" 옵션 추가
docs: 인사이트 파이프라인 사용자 DART 스킵 경로 명시
```

## 부록 A · 참고 파일 인덱스

- `packages/shared/src/core/storage.ts` (`updateProjectInfo`)
- `packages/shared/src/core/openDart.ts` (`resolveCompanyCandidates`, 대략 :320–:360)
- `packages/shared/src/core/schemas.ts` / `types.ts` (ProjectRecord)
- `packages/runner/src/routes/insightsHandlers.ts` (collectCompanyContext 호출부)
- `packages/web/src/components/OpenDartCandidateModal.tsx`
- `packages/web/src/pages/ProjectsPage.tsx` (`handleGenerateInsights`, `handleDartCandidateConfirm`, 신규 `handleDartSkip`)
- (변경 없음) `packages/shared/src/core/webviewProtocol.ts`
- (read-only) `packages/shared/src/core/jobPosting.ts`, `packages/shared/src/core/companyContext/**`
