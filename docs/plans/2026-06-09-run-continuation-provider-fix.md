# Run Continuation Provider Fix

> 작성일: 2026-06-09
> 브랜치: develop
> 상태: 완료

## 목표

- 라운드 완료 후 개입 메시지로 생성되는 연속 실행이 이전 실행의 역할별 provider 설정을 유지한다.
- 문항, 초안, 선택 문서, 라운드 설정을 연속 실행에 그대로 전달한다.
- 역할 설정과 무관하게 Claude가 선택되는 하드코딩을 제거한다.

## 검증

- 연속 실행 요청 생성 회귀 테스트: 통과
- 러너 전체 테스트: 169개 통과
- `./scripts/check.sh`: 통과
- `./scripts/apply-dev-stack.sh`: 검사 및 웹 재시작 성공, backend/runner 미실행으로 최종 상태 판정 실패
- `./scripts/status-dev-stack.sh`: Postgres/Redis/web 정상, backend/runner 미실행
