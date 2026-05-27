# 서버 데이터 동기화 v1 — 구현 플랜

> 작성일: 2026-05-27
> 브랜치: develop
> 상태: 구현 대기 (스코핑 확정 기반)
> 선행: [서버 동기화 스코핑](2026-05-27-server-sync-scoping.md) · [내 경험 저장소](2026-05-27-my-experience-store-design.md)

---

## 0. 한 줄 요약

설정 탭의 **옵트인 토글 + "지금 동기화" 버튼**을 누르면, 러너가 백엔드 `POST /api/sync`를 1회 호출해
로컬 경험 데이터(프로필 문서 + 지원서 컨텍스트 문서 + 프로젝트 메타)를 서버와 **합산(union)·중복제거**한다.
서버는 **암호화 저장**, 병합 결과를 돌려주고 러너가 로컬에 반영 → 웹은 기존 경로 그대로 통합 데이터를 본다.

## 1. 범위 (스코핑 확정)

- **포함**: 프로필 문서(내 경험), 프로젝트 컨텍스트 문서(지원서), 프로젝트 레코드(메타).
- **제외(v2)**: 실행 기록(runs)·트랜스크립트, 삭제 전파(tombstone), 지속 백그라운드 동기화, 다기기 동시 편집.
- **트리거**: 수동 1회(버튼). **충돌**: 문서=sha256 dedup, 프로젝트=필드별 병합(빈값 채움, 둘 다면 최신 `updatedAt`).

## 2. 아키텍처 결정

| 결정 | 선택 | 근거 |
|------|------|------|
| 러너↔서버 채널 | **HTTP `Authorization: Bearer <deviceToken>`** | `/api/runner/dart-key` 선례 그대로. 새 인프라 0 |
| 전송 방식 | **단일 `POST /api/sync` 전체 전송 + 서버측 병합 + 병합결과 반환** | v1 데이터 소량(이력서·포폴 몇 개). 콘텐츠 주소화(sha256 델타 전송)는 v2 최적화 |
| 병합 위치 | **서버** (shared 병합 유틸 import) | 한 곳에 병합 로직, 단위 테스트 용이. 서버가 at-rest 키 보유라 메모리 내 병합 가능 |
| 웹 데이터 경로 | **불변** (웹←러너 `state_snapshot`) | 동기화 후 로컬==서버라 자동으로 통합 데이터 표시. 별도 경로 전환 폐기(advisor) |
| 암호화 | **AES-256-GCM, 서버 보유 키(env `SYNC_ENCRYPTION_KEY`), ciphertext를 `bytea`** | at-rest(DB 덤프/백업 유출 방어). E2E(서버 무지)는 키 분배 문제로 v2 |
| 옵트인 상태 | **`AppPreferences.serverSyncEnabled`** (preferences.json, SidebarState로 웹 노출) | 로컬 단순 플래그 |

> **at-rest의 한계 명시**: 서버 프로세스는 병합을 위해 메모리에서 복호화한다 → 침해된 서버로부터는 보호 못 함.
> 보호 대상은 "저장 매체/백업 덤프". E2E는 v2 검토. 옵트인 모달에 이 범위를 정확히 고지한다.

## 3. 데이터 모델 (백엔드 신규 테이블)

`packages/backend/src/db/schema.ts`에 추가 (기존 `devices` 패턴: `uuid` PK `gen_random_uuid()`, `timestamp now()`, FK `onDelete:"cascade"`, `unique().on(...)`).

**원칙(advisor 반영): 평문 컬럼은 dedup/병합/락에 꼭 필요한 키만. 그 외 모든 콘텐츠·메타는 암호화 봉투 안.**

```ts
// 동기화된 문서 (프로필 + 프로젝트 컨텍스트 공용)
export const synced_documents = pgTable("synced_documents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),                  // "profile" | "project" (저민감)
  project_slug_hash: text("project_slug_hash"),    // scope=project 일 때 sha256(slug) — 실제 slug 누출 방지
  content_sha256: text("content_sha256").notNull(),// dedup 키 (해시라 평문 무해)
  created_at_iso: text("created_at_iso").notNull(),// 메타 병합 tiebreak (콘텐츠 아님)
  enc_payload: bytea("enc_payload").notNull(),     // AES-GCM(JSON{ title, sourceType, note, pinnedByDefault, projectSlug, contentBase64 })
  created_at: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({ uniq: unique().on(t.user_id, t.scope, t.project_slug_hash, t.content_sha256) }));

// 동기화된 프로젝트 레코드 (필드별 병합 대상)
export const synced_projects = pgTable("synced_projects", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  slug_hash: text("slug_hash").notNull(),          // sha256(slug) — 키. 실제 slug 는 enc_record 안
  record_updated_at: timestamp("record_updated_at").notNull(), // 병합 tiebreak (콘텐츠 아님)
  enc_record: bytea("enc_record").notNull(),       // AES-GCM(JSON.stringify(ProjectRecord, experienceRefs=sha256기반))
  created_at: timestamp("created_at").notNull().default(sql`now()`),
}, (t) => ({ uniq: unique().on(t.user_id, t.slug_hash) }));
```

- **평문 노출 범위**: `scope`("profile"/"project"), `content_sha256`(해시), `*_slug_hash`(해시), `record_updated_at`/`created_at_iso`(시각) 뿐. **제목·회사명·문서 내용·slug 원문은 전부 암호화 봉투 안.** (advisor: title/note/slug 평문은 프라이버시 계약 위반.)
- `bytea`: drizzle 표준에 직접 없으면 `customType<{ data: Buffer }>`로 정의(A에서 확정).
- 마이그레이션: schema.ts 편집 → `packages/backend`에서 `pnpm db:generate` → 생성된 `.sql` + `_journal.json` 커밋. boot 시 `docker-entrypoint.sh`의 `drizzle-kit migrate`가 적용.

## 4. 동기화 프로토콜

### 4.1 엔드포인트 (백엔드 신규 `routes/sync.ts`, `registerSync(app, deps)` — `healthz.ts` 템플릿)

모두 `Authorization: Bearer <deviceToken>` → `sha256` → `devices`+`device_users` 조인으로 `user_id` 해석(`runnerDartKey.ts` 인라인 패턴; 공유 `requireDevice` 헬퍼 신규 추출 권장).

- **`POST /api/sync`** — body = 러너 로컬 전체 콘텐츠:
  ```jsonc
  { "documents": [ { "scope","projectSlug?","contentSha256","title","sourceType",
                     "pinnedByDefault","note?","contentBase64" } ],
    "projects":  [ { "slug","record": ProjectRecord, "updatedAt" } ] }
  ```
  서버 동작: ① 저장분 복호화 ② shared 병합(`mergeSyncSets`) ③ 재암호화·upsert ④ 병합된 전체 반환(문서는 contentBase64 포함, 프로젝트는 record).
- **`DELETE /api/sync`** — 해당 user 의 `synced_documents`/`synced_projects` 전부 삭제(연동 해제 wipe).

### 4.2 병합 규칙 (`packages/shared/src/core/syncMerge.ts` 신규, 순수 함수 → 단위 테스트)

```ts
export function mergeSyncSets(server: SyncSet, incoming: SyncSet): SyncSet
```
- **문서**: 키 = `(scope, projectSlugHash, contentSha256)`. 양쪽 합집합, 같은 키는 1개(dedup). **같은 sha256·다른 메타(title/note/pinned) 충돌 규칙**: `pinnedByDefault = OR`(어느 쪽이든 포함이면 포함), `title`/`note`/`sourceType` = `createdAt`(ISO) 최신 레코드 채택. (ContextDocument 엔 `updatedAt` 없고 `createdAt`만 있음 → tiebreak는 createdAt.)
- **프로젝트**: 키 = `slug`. 필드별 병합 — 한쪽이 빈/undefined 면 채운 값, 둘 다 값이면 `updatedAt` 큰 쪽. 배열 필드(essayQuestions 등) 규칙은 구현 시 확정(기본: 최신 updatedAt 레코드 통째).
- 결정성: 입력 순서 무관하게 동일 결과(테스트 포인트).
- **동시성**: read-merge-write는 race 가능 → 서버는 `pg_advisory_xact_lock(hashtext(user_id))`로 **user_id 단위 직렬화**. (또는 "각 sync는 monotonic union이라 interleave 허용"으로 명시 — A에서 advisory lock 채택 권장.)

### 4.3 러너 핸들러 (`packages/runner/src/routes/syncHandlers.ts` 신규)

`syncNow(ctx, payload)` — **문서를 프로젝트보다 먼저** 처리(아래 experienceRefs 변환 전제):
1. `listProfileDocuments()` + 각 프로젝트 `listProjectDocuments(slug)` → raw 바이트(`fs.readFile(resolveStoredPath(doc.rawPath))`) → `sha256` 계산 → base64. **로컬 docId→sha256 맵**을 만들어 둔다.
2. `listProjects()` → ProjectRecord. **push 직전 변환**: 각 레코드의 `experienceRefs.profileDocumentIds`(로컬 id) → 1의 맵으로 **sha256 리스트로 치환**(§4.4). slug 은 sha256 해시.
3. `POST ${backendUrl}/api/sync` (Bearer deviceToken) 호출.
4. 응답(병합 전체) 로컬 반영: **문서 먼저** — 로컬에 없는 sha256은 `importProfileUpload`/`importProjectUpload`(바이트)로 기록 → 새 로컬 docId 확보 → **sha256→로컬 docId 역맵** 갱신. **그다음 프로젝트** — 병합 레코드의 sha256 기반 experienceRefs를 역맵으로 **로컬 docId로 재변환** 후 `updateProject`.
5. `ctx.stateStore.refresh*()` → 웹 snapshot 갱신.
- **선행 배선**: `RunnerContext`에 `backendUrl`·`deviceToken` 추가(현재 없음; `index.ts` `startInnerClient` 경유 주입) — 핸들러가 백엔드 HTTP 호출 가능하도록.

### 4.4 experienceRefs 다기기 안정성 (advisor — v1 핵심 설계, chunk B 아님)

문제: `experienceRefs.profileDocumentIds`는 **로컬 id**. 다른 기기에서 문서를 import하면 **새 id가 생성**되어 참조가 끊긴다(ContextCompiler dangling-ref 테스트가 조용히 제외 → UX 깨짐). 이는 v1 동기화 목적(다기기 일관성) 자체를 무력화하므로 반드시 해결.

**결정**: **sync 경계에서 id↔sha256 변환.** 기기 내부 표현(profileDocumentIds=로컬 id, Phase 1 컴파일러/UI 그대로)은 유지하고, **wire/서버 저장만 sha256 기반.**
- push: `profileDocumentIds`(로컬 id) → 각 프로필 문서의 content sha256 리스트로 치환해 전송·저장.
- pull: 서버 레코드의 sha256 리스트 → 수신 기기의 로컬 docId로 역변환(문서가 먼저 동기화되어 로컬에 존재함이 전제).
- 매핑 불가(해당 sha256 문서가 어떤 이유로 로컬에 없음) → 그 참조는 드롭(누적 union이라 다음 동기화에서 복구 가능).
- **검증 필요(B)**: Phase 1 ProjectRecord 스키마에 sha256 보조 필드를 둘지(`profileDocumentSha256s`) vs 변환을 순수 sync 계층에만 둘지. 후자(순수 sync 계층 변환) 우선 — Phase 1 스키마/컴파일러/지원서 멀티셀렉트 무수정 확인.

## 5. RPC op 추가 (`sync_now`, `sync_disable`)

shared `hostedRpc.ts` 3곳 (op마다): `OP_NAMES` 배열 + payload/result 스키마쌍 + `RpcRequestSchema` discriminated-union arm.
- `sync_now`: payload `{}`, result `{ syncedDocuments:number, syncedProjects:number, lastSyncedAt:string }`.
- `sync_disable`: payload `{}`, result `{ ok:true }` (서버 wipe + `serverSyncEnabled=false`).

dispatcher(`rpcDispatcher.ts`): `case "sync_now"`/`case "sync_disable"` → `syncHandlers`. (`default: assertNever`가 컴파일타임 누락 가드.)

## 6. 웹 UI (`SettingsPage.tsx` + `App.tsx` + `client.ts`)

- `SettingsSection`에 `"server-sync"` 추가 + `sectionMap` ref 항목.
- 신규 섹션(`settings-opendart-panel` 마크업 패턴 답습, overview-* 클래스):
  - **옵트인 토글** "서버 연동" — ON 시 **고지 모달**(무엇이 서버로 가는지: 프로필/컨텍스트 문서 내용·회사명 등 프로젝트 메타; at-rest 암호화·서버가 메모리 내 복호화 가능 범위 명시).
  - **"지금 동기화" 버튼** — `serverSyncEnabled` 일 때만 활성. 결과 토스트(N개 동기화).
  - **"연동 해제(서버 데이터 삭제)"** — 확인 모달 → `sync_disable`.
  - 마지막 동기화 시각 표시.
- `App.tsx`: `onSyncNow`/`onSyncDisable` 콜백 → `client.rpcCall("sync_now"/"sync_disable", {})`. 토글은 기존 preferences 저장 경로 사용.
- `client.ts`: `syncNow()`/`syncDisable()` 래퍼.
- 스타일: 기존 토큰 재사용, 새 색/간격 금지([[reference-web-style-tokens]] 주입).

## 7. 암호화 (`packages/backend` 신규 유틸)

- `src/crypto/atRest.ts`: AES-256-GCM. `encrypt(buf): Buffer`(iv 12B ‖ tag 16B ‖ ciphertext), `decrypt(buf): Buffer`. 키 = `env.SYNC_ENCRYPTION_KEY`(32B hex, 부재 시 부팅 거부 또는 sync 라우트 비활성).
- `env` 스키마에 `SYNC_ENCRYPTION_KEY` 추가. 배포 시크릿에 주입(.env). **로그에 평문/키 금지.**

## 8. 프라이버시 체크리스트 (릴리스 게이트)

- [ ] 서버 콘텐츠 전부 `bytea` 암호화 저장.
- [ ] 옵트인 모달이 "무엇이 떠나는가 + at-rest 범위" 정확히 고지.
- [ ] 연동 해제 → 서버 wipe 동작 확인.
- [ ] 백엔드/러너 로그에 문서 내용·회사명·키 누출 없음. **구체 테스트**: 알려진 고유 문자열(예: 문서 본문 sentinel, 회사명)을 담은 문서로 `POST /api/sync` 수행 → fastify 로거 출력 캡처에 그 문자열이 등장하지 않음을 assert. slug 도 평문 로그 금지.
- [ ] `SYNC_ENCRYPTION_KEY` 미설정 시 sync 안전 비활성(평문 저장 절대 금지).

## 9. 구현 청크 (순서)

- **A. 백엔드 저장+엔드포인트**: schema 2테이블 + 마이그레이션 + `atRest.ts` + `routes/sync.ts`(POST/DELETE, device auth) + env. 단위 테스트(암호화 왕복, 병합).
- **B. shared+러너**: `syncMerge.ts`(+테스트) + `sync_now`/`sync_disable` op 3곳 + dispatcher + `syncHandlers.ts` + RunnerContext backendUrl/deviceToken 배선 + sha256/blob 읽기.
- **C. 웹**: 설정 섹션·토글·고지 모달·동기화/해제 버튼 + App/client 배선 + 스타일.
- 각 청크: `./scripts/check.sh` → **즉시 commit+push**(봇 공유 체크아웃 race 방지, [[feedback_commit_before_validate_shared_checkout]]).

## 10. 배포 / 운영

- 마이그레이션: develop push → deploy-dev → boot 시 자동 적용. `SYNC_ENCRYPTION_KEY` 서버 .env 주입 필요(미주입 시 sync 비활성).
- **러너 재빌드 필수**: RunnerContext/RPC/handler 변경 → 사용자 로컬 러너 재빌드·재시작 ([[feedback_rebuild_restart]]).

## 11. 리스크 / 오픈(구현 중 확정)

- `bytea` drizzle 타입 정의 방식(customType) — A에서 확정.
- 프로젝트 배열 필드(essayQuestions 등) 병합 세부 — B에서 확정(기본: 최신 updatedAt 레코드 통째).
- **전송 비용/크기 가드**: v1 전체 전송. PDF 1개 5~10MB·base64 +33% → 문서 10개면 100MB+ 가능. **착수 전 실제 `profile/raw/` + 프로젝트 `context/raw/` 용량 측정**(러너 머신). 총량이 큰 경우(>~50MB) 콘텐츠 주소화 델타(서버에 없는 sha256 만 전송)를 v1으로 당김. v1 안전장치: 단일 동기화 페이로드 상한(예 50MB) 초과 시 거부+안내.
- experienceRefs 다기기 안정성 → **§4.4에서 결정(sha256 변환)**. (해소됨.)
- 메타데이터/slug 암호화 봉투화 → **§3에서 결정**. (해소됨.)
