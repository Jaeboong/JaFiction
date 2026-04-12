# 프로바이더 탭 아키텍처

## 개요

프로바이더 탭은 사용자가 Claude, Codex, Gemini 등의 AI 프로바이더를 연결·테스트·해제할 수 있는 UI다.  
요청 흐름은 다음과 같다.

```
Web (React, localhost:4124)
  → Backend (Docker, localhost:4000)
  → Runner (bun 바이너리, WebSocket outbound)
  → CLI subprocess
```

- Backend의 `deviceHub.sendRpc` 기본 타임아웃: **30초**
- Runner는 백엔드에 **WebSocket outbound** 방식으로 연결한다 (인바운드 서버 없음)

---

## RPC 플로우

```
사용자 클릭
  → packages/web/src/App.tsx  (onTest / onLogout)
  → packages/web/src/api/client.ts  (rpc 호출)
  → Backend HTTP  (deviceHub.sendRpc, timeout 30s)
  → WebSocket → Runner
  → packages/runner/src/routes/providersHandlers.ts
      또는 packages/runner/src/routes/providerCliHandlers.ts
  → packages/shared/src/core/providers.ts  (ProviderRegistry)
  → CLI subprocess
```

---

## 프론트엔드 (`packages/web/src/App.tsx`)

| 함수/핸들러 | 동작 |
|---|---|
| `refreshProviderState()` | `get_state` RPC → `setState`로 React 상태 갱신 |
| `onTest` | `testProvider` RPC → `refreshProviderState()` → 인증 미완료 시 `startProviderCliAuth` RPC → 폴링 또는 즉시 완료 |
| `onLogout` | `logoutProvider` RPC → `refreshProviderState()` |
| `onSaveNotionToken` | `client.connectNotion(providerId, token)` → RPC `notion_connect` (토큰 저장 + MCP 연결 + 상태 확인) |
| `onDeleteNotionToken` | `client.disconnectNotion(providerId)` → RPC `notion_disconnect` (MCP 해제) |
| `onConnectNotion` | `client.connectNotion(providerId)` → RPC `notion_connect` (토큰 없이 MCP 연결만) |

### 폴링 로직

`startProviderCliAuth`가 아래 값을 반환하면 프론트엔드가 5초 간격, 최대 24회 폴링한다.

- `{ success: false, message }` — Gemini: CLI가 백그라운드에서 인증 대기 중
- `{ success: true, authUrl }` — Claude: 브라우저에서 URL 열기 + 폴링으로 완료 감지

---

## 러너 RPC 핸들러 (`packages/runner/src/routes/`)

### `providersHandlers.ts`

| RPC | 동작 |
|---|---|
| `callProviderTest` | `testProvider` + `stateStore.refreshProvider` + 캐시된 `runtimeState` 반환 |
| `notionConnect` | `payload.provider`로 대상 프로바이더 결정 (기본 `claude`), `payload.token` 있으면 저장 → `connectNotionMcp` → `checkNotionMcp` → `refreshProvider` |
| `notionDisconnect` | `disconnectNotionMcp` → `refreshProvider` |
| `notionCheck` | `checkNotionMcp` → `refreshProvider` |

### `providerCliHandlers.ts`

| RPC | 동작 |
|---|---|
| `startProviderCliAuth` | `startProviderAuth` + `testProvider` + `stateStore.refreshProvider` (인증 후 캐시 갱신) |
| `callProviderLogout` | `logoutProvider` + `testProvider` + `stateStore.refreshProvider` |

> **중요**: `testProvider` + `stateStore.refreshProvider` 호출이 없으면 `runtimeStateCache`가 갱신되지 않아 `get_state`가 옛날 값을 반환한다.

---

## ProviderRegistry (`packages/shared/src/core/providers.ts`)

| 메서드 | 설명 |
|---|---|
| `testProvider()` | `detectInstallation` → `loadProviderCapabilities` → `checkProviderAuthStatus` → 결과를 캐시에 저장 |
| `refreshRuntimeState()` | `buildRuntimeState` 실행 (바이너리 읽기 포함) — **무거움** |
| `getCachedRuntimeState()` | `runtimeStateCache`에서 즉시 반환 |

`runtimeStateCache`는 `Map<ProviderId, ProviderRuntimeState>` 타입의 인메모리 캐시다.

---

## capabilities 캐싱 (`packages/shared/src/core/providerOptions.ts`)

| 항목 | 내용 |
|---|---|
| 함수 | `loadProviderCapabilities` |
| 역할 | 바이너리에서 모델 목록 추출 (Claude CLI 바이너리 약 232 MB) |
| TTL | 5분 메모리 캐시로 반복 호출 최적화 |
| 캐시 키 | `${providerId}:${command}` |

캐시가 없으면 바이너리를 직접 읽기 때문에 최초 호출 시 수십 초가 소요될 수 있다.

---

## 프로바이더별 auth 핸들러 (`packages/runner/src/providers/`)

### Codex (`codex.ts`)

```
codex login spawn
  → 블로킹 대기
  → 브라우저 OAuth
  → CLI exit
  → { success: true }
```

### Claude (`claude.ts`)

```
claude auth login spawn
  → stdout에서 URL 파싱
  → { success: true, authUrl } 반환
  → 프론트엔드에서 브라우저 열기 + 폴링
```

### Gemini (`gemini.ts`)

```
gemini auth login spawn (detached: true, stdin "Y\n")
  → 3초 대기
  → 즉시 반환 { success: false, message }
  → 프론트엔드에서 5초 간격 폴링
```

Gemini는 백그라운드에서 CLI가 인증을 진행하고 프론트엔드가 폴링으로 완료를 감지한다.

---

## 커맨드 해석 (`packages/shared/src/core/providerCommandResolver.ts`)

| 항목 | 내용 |
|---|---|
| 함수 | `resolveProviderCommand` |
| 탐색 경로 | 기본 명령어 → nvm, `.local/bin`, npm global 등 known locations |
| Windows 추가 경로 | `AppData\Roaming\npm\{command}.cmd` |

`withCommandDirectoryInPath`: 커맨드 디렉토리와 Node.js `binDir`을 `PATH`에 주입한다.

> **주의**: Windows 환경에서 `.cmd` 파일은 `shell: true` 없이 `spawn`이 불가하다.  
> `.cmd` 경로가 감지되면 해당 spawn 옵션에 `shell: true`를 설정해야 한다.

---

## Notion MCP 연결 아키텍처

### 프로바이더별 Notion 연결 방식

| 프로바이더 | 인증 방식 | 연결 명령어 | 비고 |
|---|---|---|---|
| Claude | Integration Token (수동 입력) | `claude mcp add` | 토큰을 `jasojeon.notionToken` 시크릿에 저장, `mcp add` 시 `--header` 옵션으로 전달 |
| Codex | OAuth (브라우저) | `codex mcp add` → `codex mcp login` | `mcp login`은 interactive → detached spawn 필수 |
| Gemini | Custom OAuth | `gemini mcp add` → `performGeminiNotionOAuth` | `~/.gemini/settings.json` + `mcp-oauth-tokens.json` 기반 |

### RPC 기반 토큰 저장 (REST 엔드포인트 아님)

`onSaveNotionToken`과 `onDeleteNotionToken`은 **RPC `notion_connect` / `notion_disconnect`**를 통해 처리한다.  
기존 REST `POST /api/providers/:id/notion-token` 엔드포인트는 hosted 모드에서 존재하지 않으므로 사용하지 않는다.

```
토큰 저장 + 연결:  client.connectNotion(providerId, token)  →  RPC notion_connect { provider, token }
토큰 삭제 + 해제:  client.disconnectNotion(providerId)       →  RPC notion_disconnect { provider }
```

### Gemini MCP 상태 체크 fallback

`gemini mcp list`가 CLI v0.37.1에서 빈 출력을 반환하는 버그가 있다.  
`parseGeminiNotionStatus()`는 CLI 출력이 비었을 때 `checkGeminiSettingsFile()`로 fallback하여 `~/.gemini/settings.json`을 직접 읽는다.

관련 파일: `packages/shared/src/core/notionMcpGemini.ts`

### `mcp login` detached spawn

Codex의 `codex mcp login`은 interactive 명령어 (브라우저 OAuth 대기)이므로 `runProcess`를 사용하면 RPC가 무한 블로킹된다.  
`runNotionPlan()`에서 `mcp login` 스텝을 감지하면 `detached: true, stdio: "ignore"`로 spawn하고 `child.unref()`한다.

관련 파일: `packages/shared/src/core/providers.ts` (`runNotionPlan` 메서드)

---

## 프로세스 실행 — windowsHide

모든 `child_process.spawn` 호출에 `windowsHide: true`를 설정하여 Windows에서 CMD 창이 나타나지 않도록 한다.

적용 위치:
- `providers.ts` `runProcess()` — CLI 명령 실행 (mcp list, mcp add, auth status 등)
- `providers.ts` `runNotionPlan()` — detached `mcp login` spawn
- `notionOAuth.ts` `spawnBrowser()` — OAuth 브라우저 열기
