# Codex Provider Reliability

> 작성일: 2026-06-09
> 브랜치: develop
> 상태: 완료

## 목표

- Jasojeon이 관리하는 공식 Notion MCP 설정이 stdio/HTTP 혼합 상태일 때 Codex 실행 전에 자동 복구한다.
- 대용량 실행 및 인사이트 프롬프트를 Codex argv가 아닌 stdin으로 전달한다.
- 사용자가 `config.toml`을 직접 편집하지 않아도 인사이트와 에이전트 실행이 시작되도록 한다.

## 구현

1. 공식 Notion URL과 stdio 키가 함께 있는 `[mcp_servers.notion]` 설정을 감지한다.
2. 충돌한 Notion 설정만 표준 streamable HTTP 블록으로 교체하고 원본 설정 백업을 남긴다.
3. Codex 실행과 Notion 상태 확인, 연결, 해제 전에 복구를 수행한다.
4. `codex exec ... -`와 stdin으로 프롬프트를 전달한다.
5. 설정 정규화와 stdin 인자 생성 회귀 테스트를 추가한다.

## 검증

- shared provider/notion 단위 테스트: 통과
- `./scripts/check.sh`: 통과
- `./scripts/apply-dev-stack.sh`: 검사 및 웹 재시작 성공, backend/runner 미실행으로 최종 상태 판정 실패
- `./scripts/status-dev-stack.sh`: Postgres/Redis/web 정상, backend/runner 미실행 확인
