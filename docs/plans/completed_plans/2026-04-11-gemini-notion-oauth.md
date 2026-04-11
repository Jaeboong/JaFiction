# Gemini Notion OAuth Implementation Plan

**Goal:** Gemini provider에서 Notion MCP connect 시 MCP 재등록 뒤 브라우저 OAuth를 완료하고 Gemini CLI 토큰 저장소에 토큰을 upsert한다.

**Architecture:** `packages/shared/src/core/notionOAuth.ts`에 Node 내장 모듈만 사용하는 OAuth 유틸을 추가한다. `ProviderRegistry.connectNotionMcp("gemini")`는 기존 MCP add/remove 플로우 뒤 이 유틸을 호출하고, 토큰은 Gemini CLI가 기대하는 `~/.gemini/mcp-oauth-tokens.json` 형식으로 저장한다.

**Validation:** `packages/shared` 단위 테스트 추가 후 `./scripts/check.sh` 실행.

---

### Task 1: OAuth 유틸 추가

**Files:**
- Create: `packages/shared/src/core/notionOAuth.ts`
- Test: `packages/shared/src/test/notionOAuth.test.ts`

1. PKCE 생성, authorize URL 조립, token payload 변환, 토큰 파일 upsert 로직을 테스트 가능한 함수로 분리한다.
2. Notion authorization server metadata 조회, dynamic client registration, local callback server, browser open, code exchange, token save를 수행하는 `performGeminiNotionOAuth`를 구현한다.

### Task 2: Gemini provider 연결 흐름 수정

**Files:**
- Modify: `packages/shared/src/core/providers.ts`
- Test: `packages/shared/src/test/providers.test.ts`

1. Gemini connect 경로에서 기존 MCP plan 실행 뒤 OAuth 유틸을 호출하도록 분기한다.
2. 비-Gemini provider 동작은 유지한다.

### Task 3: 문서 및 검증

**Files:**
- Modify: `docs/development/NAVIGATION.md`

1. 새 core/test 파일 역할을 navigation 문서에 반영한다.
2. `./scripts/check.sh`를 실행해 회귀를 확인한다.
