# "내 경험" 워크스페이스 경험 저장소 설계서

> 작성일: 2026-05-27
> 브랜치: develop
> 상태: 설계 확정 — Phase 1 구현 대기
> 결정권자 확인 완료: 단계적 진행 / GitHub PAT / 컴파일 digest / hybrid / Notion 섹션=연결 상태만

---

## 1. 문제 정의

현재 컨텍스트(경험 자료)는 **지원서(프로젝트) 단위로만** 저장·관리된다. 그래서
새 지원서를 만들 때마다 같은 경험 자료를 다시 올리거나, 멀티 에이전트 파이프라인이
"경험 데이터가 없다"고 말하는 상황이 반복된다. 사용자에게 매번 경험을 되묻는 구조
자체가 비효율이다.

경험은 **사람 단위로 한 번** 정리되고, 지원서는 그걸 **가져다 쓰기만** 해야 한다.

## 2. 목표

- 비어 있는 **개요 페이지**를 **"내 경험"** 페이지로 대체하여 워크스페이스 단위 경험
  저장소의 단일 관리 화면으로 만든다.
- 경험 소스는 세 종류: **GitHub / Notion / 업로드된 컨텍스트(파일)**.
- 지원서 탭은 기존 기능을 유지하면서 **"내 경험에서 가져오기"** 를 추가한다 (hybrid).
- 지원서에서의 선택 단위:
  - GitHub → **레포 단위** 다중 선택
  - Notion → **자연어 지시문** 입력 ("무엇을 봐라")
  - 파일 → 기존처럼 **파일 단위** 다중 선택

## 3. 범위와 가정

### 3.1 범위
- 개요 → "내 경험" 페이지 전환 (UI + 워크스페이스 저장소 노출).
- GitHub PAT 연결 + 레포 선택 + 컴파일 digest 주입 (Phase 2).
- Notion 연결 상태 표시 (Phase 3, 자연어 지시문은 지원서 탭).
- 지원서 `experienceRefs` 데이터 모델 + ContextCompiler 소비 경로.

### 3.2 가정
- 러너는 사용자 로컬 머신에서 동작하며 `FileSecretStore`로 시크릿을 안전 보관한다
  (GitHub PAT 저장소로 재사용).
- Notion MCP는 provider 단위 연결(`configured + connected`)이며, 한 번 연결되면 실행 중
  에이전트가 라이브로 읽는다. 실행별 게이트가 아니다 (`notionMcp*.ts` 확인 완료).
- single-user 로컬 러너 전제 — GitHub OAuth 앱 등록 같은 멀티유저 인프라는 YAGNI.

## 4. 현재 상태 진단 (재사용 가능 자산)

| 소스 | 현재 상태 | 함의 |
|------|-----------|------|
| 업로드 컨텍스트 | 워크스페이스(`profile/`) 문서 저장소 + `profile_*` RPC(list/save/upload/pin/preview) + `SidebarState.profileDocuments` **이미 존재**. `ContextDocument.scope="profile"` | 파일 축은 **UI만** 필요 |
| Notion | `notionMcp*.ts` provider별 MCP 연결 **이미 존재** (`mcp.notion.com/mcp`, OAuth) | 연결 상태 노출 + 지시문 주입만 |
| GitHub | 전무 | 신규 구축 (가장 무거움) |

근거 파일:
- 워크스페이스 저장소: `packages/shared/src/core/storage.ts` (`listProfileDocuments`,
  `saveProfileTextDocument`, `importProfileUpload`, `setProfileDocumentPinned`),
  `storagePaths.ts` (`storageRoot/profile/{raw,normalized}/` + `manifest.json`).
- 스키마: `packages/shared/src/core/schemas.ts` `ContextDocumentSchema`(scope 필드),
  `ProjectRecord.pinnedDocumentIds`.
- 컴파일러: `packages/shared/src/core/contextCompiler.ts` — `profileDocuments` +
  `projectDocuments`를 `pinnedByDefault` 또는 `selectedDocumentIds` 기준으로 병합.
- RPC: `packages/shared/src/core/hostedRpc.ts` (`profile_*` op 패밀리).
- 상태 흐름: `SidebarState`(`viewModels.ts`)가 WS `state_snapshot`으로 push.
- Notion: `notionMcp.ts` / `notionMcpClaude|Gemini|Codex.ts` — provider별 `configured/connected`.
- GitHub / 개요 페이지: 연동 전무, `packages/web/src/pages/OverviewPage.tsx`는 hero만.

## 5. 확정된 설계 결정

| 결정 | 선택 | 근거 |
|------|------|------|
| GitHub 인증 | **PAT** | `FileSecretStore` 재사용, OAuth 백엔드 앱등록 불필요, single-user 로컬 적합 |
| GitHub 컨텍스트 전달 | **컴파일 시점 digest** (README + 언어 비율 + 파일 트리) | 자소서는 고정·검증 가능한 산출물 필요. 라이브 레포 탐색은 v2 |
| 지원서 컨텍스트 모델 | **hybrid** (기존 per-project 업로드 유지 + 내 경험 참조 추가) | 사용자 명시 "기존 기능에 +" |
| Notion 섹션(내 경험) | **연결 상태만** | 자연어 지시문은 지원서에서 입력 → 내 경험 쪽은 OAuth 연결/해제만 |
| 진행 방식 | **단계적** (Phase 1 → 2 → 3, 각 독립 배포) | profile 저장소 재사용으로 Phase 1은 즉시, GitHub가 무거움 |

## 6. 제안 데이터 모델

### 6.1 ProjectRecord 확장
```ts
experienceRefs: {
  profileDocumentIds: string[];   // 내 경험 업로드 파일 참조 (파일 단위)
  githubRepos: string[];          // "owner/repo" full name (레포 단위)
  notionDirective: string | null; // 자연어 지시문
}
```
- 기존 `pinnedDocumentIds`(per-project 자체 업로드)는 그대로 유지 (hybrid).

### 6.2 워크스페이스 GitHub 연결 (Phase 2)
- PAT는 `FileSecretStore`에 보관 (snapshot/로그 노출 금지).
- 선택된 레포 목록은 워크스페이스 manifest 또는 별도 `github.json`에 저장.
- digest 캐시는 `storageRoot/github/{owner__repo}/digest.md` 형태 검토.

## 7. ContextCompiler 소비 경로

- **파일**: 기존 경로 그대로 — `experienceRefs.profileDocumentIds`를
  `selectedDocumentIds`에 합류시켜 profile 문서 본문 주입.
- **GitHub**: 컴파일 시점에 선택 레포 digest를 가져와(캐시 우선) 컨텍스트 문서로 주입.
- **Notion**: `notionDirective`를 프롬프트에 주입 + provider Notion MCP가 라이브 fetch
  (연결되어 있을 때만; 미연결 시 안내 메시지).

## 8. 단계별 구현 계획

### Phase 1 — "내 경험" 페이지 + 파일 축 (즉시, 신규 인프라 0)
- `OverviewPage` → "내 경험" 페이지로 전환. 탭 라벨/라우팅 갱신.
- 기존 `profile_*` RPC + `SidebarState.profileDocuments`를 노출하는 업로드/목록/핀 UI.
  (방금 지원서 탭에 추가한 핀 토글 패턴 재사용.)
- 지원서 탭: `experienceRefs.profileDocumentIds` 다중 선택 UI + ContextCompiler 합류.
- 스키마: `ProjectRecord.experienceRefs` 추가 (github/notion 필드는 빈 기본값).
- 테스트: profile 문서 참조가 compile 컨텍스트에 포함되는지 (compiler 단위 테스트).
- **게이트**: `./scripts/check.sh` → push → deploy-dev → 별도 지시 후 적용.

### Phase 2 — GitHub (PAT + 레포 선택 + digest)
- 내 경험 GitHub 섹션: PAT 입력/검증 → 레포 목록 → 포함 토글.
- 새 RPC: `github_connect`(PAT 저장+검증), `github_list_repos`, `github_set_repo_selected`,
  (선택) `github_disconnect`.
- 러너: GitHub API 클라이언트(가벼운 fetch, octokit 검토) — repo digest 생성기.
- 지원서: 연결 레포 다중 선택 → `experienceRefs.githubRepos`.
- ContextCompiler: digest 주입 (캐시 전략).
- 테스트: digest 생성기 단위 테스트(고정 fixture), PAT는 시크릿 마스킹 검증.
- **게이트**: check.sh → push → 적용.

### Phase 3 — Notion (연결 상태 + 자연어 지시문)
- 내 경험 Notion 섹션: 기존 `notionMcp*` 연결 상태 표시 + 연결/해제 트리거.
- 지원서: `notionDirective` 자유 입력 필드.
- ContextCompiler/런 프롬프트: 지시문 주입 + 미연결 시 안내.
- 테스트: 지시문이 프롬프트에 반영되는지, 미연결 분기.
- **게이트**: check.sh → push → 적용.

## 9. 비범위 (이번 설계 밖)

- GitHub OAuth 앱(멀티유저), 레포 내 파일 경로 단위 선택, 라이브 레포 탐색(MCP).
- Notion 페이지 미리보기/조회 UI (연결 상태만).
- 기존 per-project 업로드 제거(완전 마이그레이션) — hybrid 유지.

## 10. 테스트 관점

- ContextCompiler: experienceRefs 세 소스 각각이 컨텍스트에 반영/제외되는 단위 테스트.
- 시크릿: PAT가 `SidebarState`/로그/에러 메시지에 절대 노출되지 않는지 (회귀 포인트).
- RPC 스키마: op 추가 시 `hostedRpc.test.ts` / `rpcDispatcher.test.ts` op 카운트 동기화.

## 11. 리스크 / 열린 항목

- GitHub digest 크기/속도 — 큰 모노레포 트리 절단 정책 필요 (Phase 2에서 결정).
- PAT 권한 범위(read-only repo) 안내 — 사용자에게 최소 권한 PAT 발급 가이드.
- 러너 재빌드 필수: 러너 측 RPC/소스 변경 시 재빌드 + 기존 프로세스 종료 한 세트.

## 12. 결론

업로드 파일 축은 기존 `profile` 저장소 재사용으로 **Phase 1에서 신규 인프라 없이** 완성
가능하다. GitHub는 PAT + 컴파일 digest로 신규 구축(Phase 2), Notion은 기존 MCP 연결을
노출하고 자연어 지시문을 지원서에서 주입(Phase 3)한다. 각 Phase는 독립 배포·검증 가능.
