# 핸드오프: 프로바이더 CLI 자동 설치 + 인증

## 현재 상태

"연결" 버튼 클릭 → CLI 설치까지는 동작 확인. **인증 테스트에서 타임아웃 발생**.

### 완료된 것
- CLI 자동 설치 로직 (`ensureProviderCli`) 구현 완료
- Windows에서 Claude CLI 경로 탐색 (`.exe` 확장자, `.local\bin` 경로) 수정 완료
- 웹에 `startProviderCliAuth` / `submitProviderCliCode` RPC 메서드 추가
- 웹에 인증 코드 입력 모달 (`AuthCodeModal`) 추가
- 웹 `onTest` 핸들러: 설치 완료 후 자동 인증 흐름 연결
- check.sh 전체 통과, 바이너리 재빌드 완료

### 현재 버그
`testProvider()` → `execute("Reply with the single word OK.")` 호출 시, Claude CLI가 **설치는 됐지만 인증 안 된 상태**에서 명령이 무한 대기하거나 오래 걸려 RPC 타임아웃 발생.

- `AbortSignal.timeout(10_000)` 추가했지만, RPC 레이어 타임아웃과의 관계가 미검증
- **Windows에서 직접 테스트 필요**: `claude -p "Reply with the single word OK."` 를 미인증 상태에서 실행했을 때 어떤 동작을 하는지 확인

### 디버깅 방법
```powershell
# 1. Claude CLI가 설치되어 있는지 확인
where claude
# 결과: C:\Users\SSAFY\.local\bin\claude.exe

# 2. 미인증 상태에서 명령 실행 시 동작 확인
claude -p "Reply with the single word OK." --output-format text

# 3. 인증 상태 확인
claude auth status

# 4. 러너 바이너리 직접 실행하여 로그 확인
.\jasojeon-runner-windows-local.exe start
```

## 수정된 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `packages/runner/src/providers/resolve.ts` | `ensureProviderCli`, `installClaudeCli`, `downloadPortableNodeJs`, `ensureNpm` 추가. Windows 경로+PATH 처리 |
| `packages/runner/src/routes/providersHandlers.ts` | `callProviderTest`에서 `installed===false`시 자동 설치 → 재테스트 |
| `packages/shared/src/core/providers.ts` | `testProvider` 인증 테스트에 `AbortSignal.timeout(10_000)` 추가 |
| `packages/shared/src/core/providerCommandResolver.ts` | Windows `.exe` 확장자 + `%LOCALAPPDATA%\Programs\claude` 경로 추가 |
| `packages/web/src/api/client.ts` | `startProviderCliAuth`, `submitProviderCliCode` 메서드 추가 |
| `packages/web/src/App.tsx` | `onTest`에 자동 인증 흐름 + `AuthCodeModal` 컴포넌트 추가 |
| `packages/web/src/pages/ProvidersPage.tsx` | 수동 설치 가이드 UI 제거, `lastError` 표시로 대체 |
| `packages/web/src/styles/providers.css` | 모달 CSS + `.providers-install-error` 추가 |
| `packages/runner/src/test/rpcDispatcher.test.ts` | fake registry에 `installed: true` 추가 |

## 남은 작업

1. **인증 테스트 타임아웃 해결** — 위 디버깅 방법으로 원인 확인 후 수정
2. **자동 인증 플로우 E2E 테스트** — Claude: 코드 입력 모달, Codex/Gemini: 자동 콜백
3. **러너 종료 버튼** — 사용자 요청. 웹에서 러너 프로세스 종료할 수 있는 버튼 추가

## 계획서
`/home/cbkjh0225/.claude/plans/snoopy-launching-donut.md` 참조

## 빌드/실행 명령

```powershell
# 바이너리 재빌드 (WSL에서)
cd packages/runner && bun run build.ts --local

# 검증
./scripts/check.sh

# Windows에서 러너 직접 실행
.\jasojeon-runner-windows-local.exe start
```
