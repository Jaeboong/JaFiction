# Overview / Providers 워크스페이스 라운드 리프레시

## 목표

- `OverviewPage`와 `ProvidersPage`를 `Projects / Runs / Insight Modal`과 같은 rounded workspace 톤으로 정리한다.
- 데이터, 텍스트, 액션, 저장 흐름은 유지하고 시각 구조만 개편한다.
- 변경 영향은 `packages/web/src/**`로 제한하고, 공통 스타일은 재사용 가치가 높은 프리미티브만 추가한다.

## 구현 메모

- 공통 shell은 유지하되, 상단 탭과 워크스페이스 프레임을 slate/white 기반으로 정돈한다.
- Overview / Providers 전용으로 아래 스타일 프리미티브를 정리한다.
  - rounded sidebar/list item
  - rounded section surface / stat card / form panel
  - softer table row / badge / action group
  - mono field / status row / meta card
- `AgentEffortSection`과 `AgentDefaultsSummary`는 Providers / Overview 양쪽에서 자연스럽게 보이도록 동일 톤으로 맞춘다.

## 검증

- 필수: `./scripts/check.sh`
- 선택: 공통 shell 수정 영향이 커 보일 때만 `./scripts/apply-dev-stack.sh`

## 남은 확인 포인트

- 좁은 화면에서 Overview 요약 카드와 Providers 폼 액션이 자연스럽게 줄바꿈되는지 확인
- Projects / Runs 탭의 기존 화면 언어가 이번 공통 shell 조정으로 깨지지 않는지 확인
