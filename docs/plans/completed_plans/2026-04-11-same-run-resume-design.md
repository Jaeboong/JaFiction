# Same Run Resume Design

**Goal:** `재개`가 새 실행 기록을 만들지 않고 기존 run 하나를 다시 활성화해 같은 대화 흐름 안에서 이어지도록 바꾼다.

**Problem:** 현재 `재개`는 `startContinuationRun()`을 통해 새 `runId`를 만들고, UI도 새 실행처럼 다뤄서 히스토리가 갈라진다. 사용자는 기존 대화와 기록을 유지한 채 같은 실행을 다시 열기를 원한다.

## Desired Behavior

- 완료된 문항에서 `재개`를 누르면 기존 `runId`를 다시 활성화한다.
- 기존 `chat-messages.json`, `chat-ledgers.json`, `review-turns.json`은 유지하고 새 라운드 결과를 뒤에 이어쓴다.
- 기존 `startedAt`은 유지하고, 마지막 재개 시각은 별도 필드로 남긴다.
- 한 번 완료된 세션 카드에서는 `실행 시작` 버튼을 노출하지 않고 `재개`만 노출한다.

## Backend Design

- `RunRecord`에 마지막 재개 시각 필드를 추가한다.
- 오케스트레이터는 새 실행 생성과 기존 실행 재개를 모두 처리할 수 있어야 한다.
- 기존 run 재개 시에는 run 디렉터리를 새로 만들지 않고 기존 레코드를 `running` 상태로 갱신한다.
- 기존 채팅 메시지와 review turns를 먼저 로드한 뒤 새 결과를 append 저장한다.
- `resume` 라우트는 `startContinuationRun()` 대신 "same run restart" 경로를 사용한다.

## Web Design

- `재개` 성공 시 선택 run은 그대로 유지한다.
- 완료된 run을 보고 있을 때는 헤더 액션을 `재개` 전용으로 고정한다.
- `실행 시작` 버튼은 새 실행 모드 또는 아직 완료되지 않은 실행을 다룰 때만 노출한다.
- `재개` 아이콘은 현재의 어색한 회전 화살표 대신 명확한 "play + return" 느낌으로 교체한다.

## Validation

- runner route 테스트로 같은 `runId` 재개와 answer state reopening을 검증한다.
- orchestrator/storage 경계에서 기존 메시지/turn append를 검증한다.
- Runs page 액션 조건 테스트가 없으면 최소한 렌더 조건을 로컬 확인하고 repo check로 회귀를 잡는다.
