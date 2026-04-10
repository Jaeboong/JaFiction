# 2026-04-08 Design HTML Fidelity Implementation

## Goal

`docs/plans/design/*.html` 을 시각적 소스 오브 트루스로 삼아 `packages/web` UI를 재구성한다.

이번 작업의 기준은 "느낌이 비슷한가"가 아니라 아래 항목이 실제 HTML과 최대한 일치하는가이다.

- 폰트
- 폰트 크기와 두께
- 여백과 정렬
- 헤더 / 사이드바 / 본문 배치
- 카드 / 테이블 / 폼의 구조
- 액션 버튼 위치와 위계

기존 rounded / frosted 스타일은 기준에서 제외한다.

## Scope

- 공통 셸
- Overview
- Providers
- Projects create/workspace
- Runs
- Insight modal

## Ownership Split

### Worker 1

- `packages/web/src/App.tsx`
- `packages/web/src/styles.css`
- 필요 시 `packages/web/src/main.tsx`

책임:

- 공통 헤더 / 탭 / 로딩 / 푸터 셸을 디자인 HTML 기준으로 재구성

### Worker 2

- `packages/web/src/pages/OverviewPage.tsx`
- `packages/web/src/components/AgentEffortSection.tsx`
- `packages/web/src/styles/overview.css`
- `packages/web/src/pages/ProvidersPage.tsx`
- `packages/web/src/components/AgentDefaultsSummary.tsx`
- `packages/web/src/styles/providers.css`

책임:

- Overview / Providers HTML fidelity 구현

### Worker 3

- `packages/web/src/pages/ProjectsPage.tsx`
- `packages/web/src/styles/projects.css`

책임:

- Projects create/workspace HTML fidelity 구현

### Worker 4

- `packages/web/src/pages/RunsPage.tsx`
- `packages/web/src/components/ProjectInsightModal.tsx`
- `packages/web/src/styles/runs.css`
- `packages/web/src/styles/insight-modal.css`

책임:

- Runs / Insight modal HTML fidelity 구현

## Guardrails

- 디자인 HTML에 없는 시각 해석은 최소화한다.
- CDP 기반 시각 확인은 사용하지 않는다.
- 기존 기능은 유지하되, HTML에 드러난 구조가 빠져 있으면 가능한 범위에서 추가한다.
- 각 워커는 자기 소유 파일만 수정한다.

## Validation

- 통합 후 `./scripts/check.sh`
- 공통 셸과 웹 런타임이 바뀌므로 `./scripts/apply-dev-stack.sh`

## Current Pass

- 공통 상단 네비는 pill 탭 행과 중앙 정렬 셸 기준으로 다시 맞춘다.
- 각 페이지 루트는 좌측 정렬된 전체 폭 화면이 아니라, 중앙에 배치된 rounded workspace shell 안에서 렌더링한다.
- 개별 페이지 디테일보다 먼저 "상단바가 보이는가 / 전체가 중앙에 정렬되는가" 를 우선 복구한다.
