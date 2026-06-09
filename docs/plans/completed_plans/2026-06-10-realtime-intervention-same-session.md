# Plan — Realtime 개입 시 같은 세션 유지 (clean-pass 라운드가 새 run을 만드는 버그)

작성일: 2026-06-10
브랜치: develop
상태: 진행 중

## 증상
realtime 실행 중 사용자가 채팅으로 개입하면 같은 세션이 아니라 "최근 실행"에 새 항목(새 run)이 생기고 거기서 대화가 이어진다. 기대: 같은 run/세션에서 이어져야 함.

## 근본 원인 (확정)
`request.reviewMode === "realtime"` 에서 한 라운드가 BLOCK 없이 깨끗하게 통과 → finalizer 턴 실행 후 `orchestrator.ts:1456` 에서 무조건 `break`. `orchestrator.run()` 이 resolve 되어 `status:"completed"` 로 마킹(1492-1497)되고, `runsHandlers.ts:439` 가 무조건 `markRoundComplete` 호출 → 세션이 State C(paused, `resolveIntervention` 없음). 이후 사용자 메시지는 `RunSessionManager.submitIntervention` 에서 `"continuation"` 으로 분류 → `startRunInternal` 이 `existingRunId` 없이 새 run 레코드 생성 → 새 runId → 웹 UI가 새 사이드바 항목 표시.

### 버그 판정 근거 (문서적 증거)
1. 커밋 `9aeac84` 메시지 "prevent realtime mode loop break on user intervention" — 팀이 realtime 루프는 개입에 끊기면 안 된다고 명시. 단 BLOCK 경로만 고침, 클린패스 `break`(1456)는 미수정.
2. `/done`·`/stop` 종료 명령(orchestrator.ts:959-966) 존재 — 클린 패스가 자동 완료라면 불필요. 세션은 사용자가 명시 종료할 때까지 유지가 의도.
3. 비대칭: BLOCK 라운드는 세션 유지(State B, 같은 run), 클린 라운드만 완료. 원리적 이유 없음.

## 수정 (orchestrator.ts 만 편집; runner/web 무변경)

### 변경 A — clean-pass `break`(1456) 교체
finalizer 블록(1446-1455) 이후 `break;` 대신 BLOCK 분기(1409-1416)를 미러링:
- `handleRealtimeAwaitingUserInput(round, <continuation-prompt>, { markAwaitingStatus: true })` 호출. 프롬프트는 한국어 안내(예: "이번 라운드를 마쳤습니다. 이어서 다듬을 방향을 알려주시거나 /done 으로 마칠 수 있어요.").
- `outcome === "done"` → `break;`
- else → `round += 1; continue roundLoop;` (재진입 시 다시 `handleRealtimeAwaitingUserInput`→`requestUserIntervention`→`waitForIntervention` 가 `resolveIntervention` 를 매 라운드 재무장 → 다음 메시지는 State B "resumed", 같은 runId)

`run()` 이 `waitForIntervention` pending promise 에 멈춰 있으므로 `runsHandlers.ts:439` 의 `markRoundComplete` 에 도달하지 않음 → State C 전이 없음.

### 변경 B — `/done`·`/stop` 가 realtime run 을 실제 `completed` 로 종료
현재 done 경로는 storage status 가 `awaiting-user-input`(931-934, 966 이 979 reset 전에 return)인 채 1488 가드가 완료 기록(1492-1497)을 건너뛰어 run 이 영원히 미완료(잠복 버그).
- 622-623 부근에 `let realtimeUserEnded = false;` 선언.
- `handleRealtimeAwaitingUserInput` 의 `/done`·`/stop` 분기(959-966)에서 `return "done"` 전에 `realtimeUserEnded = true;`.
- 1488 가드를 `if (run.status === "awaiting-user-input" && !realtimeUserEnded) { return ...; }` 로 변경.
- 1492-1497 은 유일한 `completed` writer 로 유지.

deepFeedback 은 storage 에 `awaiting-user-input` 을 쓰지 않으므로(853-861 은 이벤트만) 가드/플래그 영향 없음.

## 영향 검증
- State A(실행 중 개입, `executionAbortController` 바인딩 → `queued`, 같은 run): 무영향.
- deepFeedback / 일회성 run: 무영향, 정상 완료.
- 웹 UI: `awaiting-user-input` 이미 렌더("입력 대기 중", info/waiting dot — formatters.ts:35,122-133; RunsPage.tsx). web 변경 없음.
- 기존 BLOCK `/done` 테스트(orchestrator.test.ts:3124) 기대값 `awaiting-user-input`→`completed` 로 변경(의도된 동작 수정).

## 라이프사이클 변화 (사용자 고지됨)
realtime run 은 클린 패스에서 자동 완료(초록 점)되지 않고 `/done`·`/stop` 전까지 "입력 대기" 상태로 열려 있음.

## TDD 테스트
- `packages/shared/src/test/orchestrator.test.ts`
  - (신규) clean-pass 라운드가 awaiting-user-input 으로 park 되고 다음 메시지로 같은 run 이어감
  - (신규) clean-pass 첫 awaiting 에서 `/done` → `completed`
  - (수정) 1826 "realtime finalizes after first PASS-only round" — `requestUserIntervention`(`/done`) 제공하도록
  - (수정) 3124 BLOCK `/done` → 기대값 `completed`
  - (회귀) deepFeedback `/done` 여전히 `completed`
- `packages/shared/src/test/runSessionManager.test.ts`
  - (신규/확인) State B resumed 같은 runId + 매 라운드 재무장; State A queued; State C continuation 계약 유지

## 검증
- `./scripts/check.sh`
- 변경 테스트가 수정 전 fail → 수정 후 pass 확인

## 완료 후
- commit + `git push origin develop`, deploy-dev CI 모니터링
- 이 문서를 `docs/plans/completed_plans/` 로 이동
