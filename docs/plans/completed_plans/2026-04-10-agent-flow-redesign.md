# Agent Flow Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current realtime orchestrator loop with `coordinator -> drafter -> reviewers -> (BLOCK => coordinator synthesis + user escalation, REVISE/PASS only => finalizer)` without changing `deepFeedback` in the first pass.

**Architecture:** Reuse the existing role model and turn execution plumbing, because `finalizer` already exists in the type system and participant builder. Rewrite only the `reviewMode === "realtime"` branch so reviewer verdict collection branches immediately after the review stage; add a coordinator BLOCK-synthesis prompt for escalation and a finalizer prompt that integrates REVISE feedback into the finished draft. Treat the current section-led convergence loop, devil's-advocate round, weak-consensus polish, and `SectionOutcome` handoff logic as superseded realtime behavior unless product scope explicitly says to preserve them.

**Tech Stack:** TypeScript, shared orchestrator prompt/parsing helpers, Node test runner

---

## 현재 흐름 요약 (코드 기반)

- 역할 해석은 이미 완성되어 있다. `packages/shared/src/core/orchestrator.ts:216-221`에서 `section_coordinator`, `section_drafter`, `finalizer`, reviewer들을 생성하고, `packages/shared/src/core/types.ts:32-50`, `packages/shared/src/core/roleAssignments.ts:42-87`, `packages/shared/src/core/orchestrator/participants.ts:29-59`가 `finalizer`를 정식 역할로 유지한다.
- realtime 모드의 실제 실행 순서는 현재도 `coordinator -> drafter -> reviewers`로 시작하지만, 리뷰 이후 즉시 종료되지 않고 반복 수렴 루프로 들어간다. 핵심 제어 구간은 `packages/shared/src/core/orchestrator.ts:1179-1528`이다.
- coordinator는 `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts:49-220`의 프롬프트로 discussion ledger를 작성한다. drafter는 `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts:659-690`의 `<coordinator-brief>`를 받아 섹션 초안을 쓴다.
- reviewer 판정은 `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts:245-334`에서 `Status: APPROVE|REVISE|BLOCK` 형식으로 정의되고, 파서는 `packages/shared/src/core/orchestrator/parsing/responseParsers.ts:444-468`에서 상태를 읽는다. 상태가 없으면 기본값은 `REVISE`다.
- verdict 집계와 종료 조건은 `packages/shared/src/core/orchestrator/discussion/convergenceEvaluator.ts:27-120`에 있다. 여기서 BLOCK 수, REVISE 다수결, open blocking ticket, 전체 문서 완료 여부를 계산한다.
- 그 결과 orchestrator는 devil's-advocate, weak-consensus polish, deferred-close, next-section handoff, write-final 같은 section outcome 분기까지 처리한다. 이 흐름은 `packages/shared/src/core/orchestrator.ts:1372-1535`에 집중되어 있다.
- finalizer는 이미 realtime에서 존재한다. 다만 현재는 "전체 문서가 준비되었다"는 ledger/state 조건을 만족했을 때만 `packages/shared/src/core/orchestrator.ts:1483-1528`에서 호출된다. 즉, "REVISE/PASS만 남았으면 바로 finalizer" 구조는 아직 아니다.
- provider streaming 계층은 역할 제어를 하지 않는다. `packages/shared/src/core/providerStreaming.ts:9-17`과 `packages/shared/src/core/providerStreaming.ts:271-302`는 `speakerRole`, `participantId`, `participantLabel`, `messageScope`를 그대로 이벤트에 싣는 중계기다. 새 흐름에서 필요한 것은 주로 orchestrator 쪽 message scope 재배치다.

## 변경이 필요한 파일과 위치

- `packages/shared/src/core/orchestrator.ts`
  - `run()`의 realtime 분기 `:1179-1535`
  - reviewer verdict 수집 직후 분기를 `BLOCK 있음` / `REVISE+PASS만`으로 단순화
  - obsolete 가능성이 높은 `devils-advocate`, `weak-consensus polish`, `deferred-close`, `handoff-next-section`, `write-final` 판정 경로 제거 또는 realtime 전용 dead path 정리
  - coordinator BLOCK-synthesis turn용 새 `messageScope` 추가

- `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
  - `extractRealtimeReviewerStatus`, `collectRealtimeReviewerStatuses` 구간 `:444-468`
  - `APPROVE`를 `PASS`로 바꾸거나 최소한 하위 호환 alias로 허용
  - finalizer/coordinator synthesis에 넘길 reviewer packet 추출 helper 추가
    - 예: status
    - objection summary
    - blocking reason
    - revise suggestion

- `packages/shared/src/core/orchestrator/discussion/convergenceEvaluator.ts`
  - 현재 majority-based convergence 계산 구간 `:27-120`
  - 새 흐름에서는 "BLOCK reviewer 존재 여부"와 "non-BLOCK feedback 요약" 정도만 남고, section-ready / whole-document-ready / handoff 계산은 realtime에서 더 이상 주도 로직이 아니게 된다
  - 이 파일은 축소되거나 realtime에서 사용 중지될 가능성이 높다

- `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
  - drafter brief 주변 `:146-209`
  - coordinator BLOCK 종합용 reviewer digest block
  - finalizer 입력용 reviewer feedback block
  - 필요하면 `PASS/REVISE/BLOCK` 요약 block builder 추가

- `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
  - coordinator open prompt `:49-220`
  - reviewer prompt `:245-334`
  - finalizer prompt `:336-374`
  - convergence notice block `:752-767`
  - 새 설계에 맞춰 최소 다음 프롬프트 세트로 재구성
    - coordinator initial brief prompt
    - reviewer verdict prompt (`PASS / REVISE / BLOCK`)
    - coordinator BLOCK synthesis prompt
    - finalizer integration prompt

- `packages/shared/src/core/providerStreaming.ts`
  - 기능 변경은 필수는 아니다
  - 다만 coordinator가 같은 round에서 `initial brief`와 `block synthesis` 두 종류 turn을 가질 수 있으므로, `messageScope`와 이벤트 가독성이 충분한지 `:271-302` 기준으로 확인

- `packages/shared/src/test/orchestrator.test.ts`
  - 기존 realtime finalizer override 검증 `:1753-1815`는 유지
  - 기존 drafter insertion 검증 `:1818-1879`는 유지하되 reviewer verdict contract 변경 반영
  - 기존 section handoff / deferred-close / convergence notice / BLOCK hold 테스트 `:2989-3317`는 새 설계 기준으로 교체 또는 삭제

- 변경 불필요가 유력한 파일
  - `packages/shared/src/core/types.ts`
  - `packages/shared/src/core/roleAssignments.ts`
  - `packages/shared/src/core/orchestrator/participants.ts`
  - 이유: `finalizer` 역할은 이미 enum, assignment, participant builder에 모두 존재한다

## 단계별 구현 순서

### Task 1: Realtime 새 흐름을 테스트로 먼저 고정

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: BLOCK 분기 테스트를 먼저 추가**

새 테스트를 추가해 다음을 고정한다.
- 순서가 `coordinator -> drafter -> reviewers -> coordinator(block synthesis)`인지
- reviewer 중 하나라도 `Status: BLOCK`이면 finalizer가 호출되지 않는지
- coordinator synthesis 결과가 `awaiting-user-input` 이벤트로 사용자 질문을 남기고 에이전트 루프를 멈추는지

**Step 2: REVISE/PASS 분기 테스트를 추가**

새 테스트를 추가해 다음을 고정한다.
- reviewer verdict가 `PASS`와 `REVISE`만이면 finalizer가 정확히 1회 호출되는지
- finalizer prompt가 drafter 초안과 reviewer 피드백을 둘 다 받는지
- coordinator의 second-pass convergence turn 없이 run이 완료되는지

**Step 3: obsolete behavior 테스트를 정리**

다음 realtime 테스트는 새 설계와 충돌하므로 교체 또는 삭제 대상으로 표시한다.
- `realtime closes a section on REVISE...` (`:2989-3064`)
- `realtime deferred-close converts...` (`:3066-3169`)
- `realtime BLOCK still prevents...` (`:3171-3223`)
- `realtime injects a convergence notice...` (`:3225-3317`)

**Step 4: 테스트를 돌려 실패를 확인**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: FAIL because realtime orchestrator still implements the old convergence loop.

### Task 2: Reviewer 판정 파서와 요약 helper를 새 계약에 맞춘다

**Files:**
- Modify: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Modify: `packages/shared/src/core/orchestrator/discussion/convergenceEvaluator.ts`

**Step 1: status literal migration**

`extractRealtimeReviewerStatus()`를 `PASS|REVISE|BLOCK` 기준으로 바꾸되, 마이그레이션 동안 `APPROVE`도 `PASS`로 읽게 한다.

**Step 2: reviewer feedback packet helper 추가**

coordinator BLOCK synthesis와 finalizer integration에서 재사용할 helper를 만든다.
- reviewer label
- normalized status
- 핵심 objection / revise suggestion
- block reason or close condition

**Step 3: old convergence helper 축소**

majority-based convergence 계산은 realtime 새 설계와 맞지 않으므로:
- 유지가 필요한 최소 helper만 남긴다
- orchestrator가 직접 분기할 수 있게 불필요한 `wholeDocumentReady`, `deferred-close`, `write-final` 계산을 정리한다

**Step 4: 파서 단위 영향 확인**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: still FAIL, but failures should move from parser contract to orchestrator control-flow mismatch.

### Task 3: Realtime prompt 계약을 새 역할 흐름에 맞춰 재구성

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`

**Step 1: coordinator initial brief prompt를 축소**

현재 ledger-heavy coordinator prompt를 새 흐름에 맞게 줄인다.
- drafter가 바로 쓸 수 있는 brief 유지
- 다음 라운드 convergence/polish/handoff instructions 제거
- `Next Owner`가 실질적으로 `section_drafter` 고정에 가까운 initial brief 성격이 되도록 정리

**Step 2: reviewer prompt를 `PASS / REVISE / BLOCK`로 변경**

현재 `Status: APPROVE` 문구를 `Status: PASS`로 바꾼다.
- `PASS`: 현재 초안을 finalizer로 넘겨도 됨
- `REVISE`: finalizer가 수렴할 수 있는 비차단 수정
- `BLOCK`: 사용자 질문 없이 finalizer로 넘기면 안 됨

**Step 3: coordinator BLOCK synthesis prompt 추가**

새 프롬프트를 만들어 BLOCK reviewer 의견만 종합하게 한다.
- 각 BLOCK 사유를 통합
- 사용자에게 물을 질문 1개를 생성
- output contract는 간단하게 유지
  - 종합 판단
  - why blocked
  - user question

**Step 4: finalizer prompt를 feedback integration형으로 재작성**

현재 finalizer는 "section-ready + deferred 없음"을 전제로 한다. 이를 다음으로 바꾼다.
- drafter 초안을 seed로 사용
- PASS reviewer의 유지 포인트 반영
- REVISE reviewer의 수정 포인트 수렴
- BLOCK은 이 프롬프트에 들어오지 않음

**Step 5: prompt assertions가 통과할 때까지 테스트 보정**

기존 prompt 테스트의 `APPROVE`, convergence notice, section outcome 기대치를 새 계약에 맞게 바꾼다.

### Task 4: `orchestrator.ts` realtime 루프를 새 branch model로 교체

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: realtime phase 순서를 고정**

`run()`의 realtime branch를 다음 순서로 재배치한다.
1. coordinator initial brief
2. drafter
3. reviewers
4. verdict branch

**Step 2: BLOCK branch 구현**

reviewer packet 중 `BLOCK`이 하나라도 있으면:
- finalizer 호출 금지
- coordinator BLOCK-synthesis turn 실행
- synthesis 결과 질문을 `awaiting-user-input`으로 emit
- run status를 `awaiting-user-input` 또는 설계에 맞는 paused state로 남기고 agent loop 종료

**Step 3: REVISE/PASS branch 구현**

모든 reviewer가 `REVISE` 또는 `PASS`이면:
- coordinator second-pass 없이 finalizer 실행
- finalizer output을 최종 draft artifact로 저장
- run 완료

**Step 4: old realtime convergence code 제거**

아래 구간은 새 설계와 충돌하므로 제거 또는 dead path 정리 대상으로 본다.
- `pendingReviewerVerdictSummary`
- `pendingConvergenceNoticeRounds`
- `devils-advocate`
- `weak-consensus polish`
- `validateSectionOutcome()` 기반 handoff/write-final routing

**Step 5: deepFeedback untouched regression 확인**

`reviewMode === "deepFeedback"` 분기는 이번 작업에서 기능 변경하지 않는다.

### Task 5: 이벤트/스트리밍/아티팩트 정합성을 맞춘다

**Files:**
- Modify if needed: `packages/shared/src/core/providerStreaming.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: new message scope 명명**

최소 다음 scope를 명시적으로 분리한다.
- `realtime-round-N-coordinator-brief`
- `realtime-round-N-drafter`
- `realtime-round-N-reviewer`
- `realtime-round-N-coordinator-block`
- `realtime-round-N-finalizer-final`

**Step 2: providerStreaming 변경 필요 여부 확인**

현재 stream processor는 role/participant/messageScope 전달만 담당하므로 원칙적으로 수정 없이 재사용한다. 단, UI에서 coordinator 두 turn이 같은 round에 섞여 보이면 messageScope 관련 최소 수정만 한다.

**Step 3: 저장 아티팩트 정리**

새 realtime 설계에서 유지할 artifact를 명확히 한다.
- `revised-draft.md`
- 필요 시 `discussion-ledger.md`
- BLOCK 종료 시 synthesis question 또는 blocked-review summary를 별도 artifact로 남길지 결정

### Task 6: 검증

**Files:**
- Validate: `packages/shared/src/core/orchestrator.ts`
- Validate: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Validate: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Validate: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Validate: `packages/shared/src/core/orchestrator/discussion/convergenceEvaluator.ts`
- Validate: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: targeted orchestrator tests**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: PASS for the new realtime branch tests and unchanged deepFeedback coverage.

**Step 2: provider streaming regression if touched**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/providerStreaming.test.ts`

Expected: PASS if `providerStreaming.ts` changed.

**Step 3: full repo check**

Run: `./scripts/check.sh`

Expected: PASS.

## 테스트 전략 (`orchestrator.test.ts` 기준)

- 유지할 테스트
  - finalizer role assignment / override propagation (`:1753-1815`)
  - drafter insertion ordering (`:1818-1879`)
  - drafter sanitization 계열 테스트
- 새로 추가할 테스트
  - BLOCK 발생 시 coordinator synthesis 후 `awaiting-user-input`
  - REVISE/PASS-only 시 finalizer direct handoff
  - reviewer prompt가 `Status: PASS`를 요구하는지
  - finalizer prompt가 reviewer feedback digest를 포함하는지
- 교체/삭제할 테스트
  - convergence notice 주입
  - majority REVISE hold / polish
  - section handoff / deferred-close / write-final downgrade
  - old `APPROVE` literal 전제 assertions
- deepFeedback 회귀 확인
  - realtime 재설계가 `reviewMode === "deepFeedback"` 흐름을 건드리지 않았는지 최소 1개 이상 기존 deepFeedback test로 보장

## 리스크 및 주의사항

- 가장 큰 리스크는 현재 realtime이 `DiscussionLedger`와 `SectionOutcome` 기반의 section-by-section workflow라는 점이다. 새 설계는 whole-run finalization에 가깝기 때문에, multi-section handoff를 살릴지 버릴지 먼저 확정해야 한다.
- `APPROVE -> PASS` literal 변경은 기존 테스트, persisted mock, prompt assertion을 넓게 깨뜨릴 수 있다. 파서는 한동안 `APPROVE`를 `PASS` alias로 받아야 마이그레이션 충격이 줄어든다.
- coordinator가 같은 round에서 두 번 실행될 수 있다. UI/chat artifact가 이를 구분할 수 있도록 `messageScope`를 명확히 나눠야 한다.
- BLOCK synthesis 결과를 어떤 artifact와 event로 남길지 결정해야 한다. 그렇지 않으면 사용자는 "왜 막혔는지"를 run 결과에서 복기하기 어렵다.
- deepFeedback는 이미 별도 finalizer/coordinator-decision 흐름을 갖고 있다. 이번 redesign 범위를 realtime로 제한하지 않으면 변경 폭이 급격히 커진다.
- 테스트 삭제 범위가 넓다. 단순 삭제가 아니라 "왜 obsolete가 되었는지"를 plan과 PR 설명에 명시해야 한다.
