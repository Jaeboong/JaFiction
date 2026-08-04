# Runner 페어링 Robustness (2026-05-26)

> 목표: "러너 실행 → Connect 클릭"이 **타이밍·재시작·중복 실행·버전업**과 무관하게 항상 성공하도록.
> 정상 종료/재시작/버전업에선 저장된 토큰으로 **재페어링 없이 WS 재연결**되는 것이 정상 경로이며,
> claim/approve 단계는 최초 1회 또는 토큰 revoke 시에만 탄다.
> "무조건 성공"은 승인이 사람 행위라 불가능 — 발 헛디딜 곳(foot-gun)을 제거하는 것이 범위.

## 배경 — 관측된 실패 모드

| # | 실패 | 근본 원인 (코드) |
|---|------|------------------|
| M1 | 2분 창 만료 후 영영 승인 불가 | approve `registeredAt >= twoMinutesAgo`(2분, `pairing.ts`) vs 러너는 한 claim을 10분 폴링하며 재등록 안 함 → 좀비 claim |
| M2 | `multiple_claims` 로 승인 거부 | register 시 기존 pending claim 정리 없음 → 누적 |
| M3 | 중복 러너 인스턴스 | 러너에 단일 인스턴스 가드 없음 |
| M4 | IP 격리 무의미 + rate-limit 깨짐 | `Fastify({})` 에 `trustProxy` 미설정 → `request.ip` 가 nginx 내부 IP |

## 범위 (이번 작업 = "핵심 3 + trustProxy")

프론트엔드 안전망(multiple_claims/no_claim 처리)과 self-heal 재시도 증가는 **이번 범위 밖** (후속).

### 계약 (양 레이어 공통)
- 새 필드명: **`runnerInstanceId`** (camelCase). 러너→백엔드 register body 에 실어 보냄. optional (구버전 호환).

---

## Fix-1 (백엔드) — trustProxy 설정 · M4

- `packages/backend/src/app.ts` 의 `Fastify({...})` 에 `trustProxy: true` 추가.
- 근거: 백엔드는 nginx 뒤(127.0.0.1 바인드 + 내부망)에서만 도달 → 모든 프록시 신뢰 OK.
- 효과: `request.ip` 가 실제 클라이언트 IP(X-Forwarded-For), claim IP 매칭·`claim-rate:<ip>` rate-limit 정상화.
- `pairing.ts` 의 "trustProxy is enabled" 주석이 사실이 됨.

## Fix-2 (백엔드) — register 시 같은 러너의 옛 pending claim supersede · M1·M2

- `packages/backend/src/routes/pairing.ts` `POST /auth/device-claim` 핸들러:
  - body 에서 `runnerInstanceId` 수신 (RegisterClaimBodySchema 에 optional string 추가).
  - 새 claim 을 Redis 에 쓰기 **전**, `scanClaimKeys` 로 순회하며
    `status === "pending" && entry.runnerInstanceId === runnerInstanceId` 인 키를 `del`.
    - **반드시 instanceId 기준** (IP 기준 금지 — 공유 NAT/미수정 trustProxy 에서 남의 claim 삭제 위험).
    - `runnerInstanceId` 가 body 에 없으면(구버전) supersede 생략(기존 동작 유지).
  - `ClaimEntry` 에 `runnerInstanceId?` 필드 저장.
- 효과: 한 러너는 항상 pending claim 1개만 → 좀비 누적 제거, `multiple_claims` 미발생.

## Fix-3 (백엔드) — approve 2분 창 제거 · M1

- `pairing.ts` approve 핸들러: `entry.registeredAt >= twoMinutesAgo` 조건 제거.
- 근거: Redis TTL(`CLAIM_TTL_SECONDS = 600`)이 이미 만료를 관장 → 2분 창은 중복이며 좀비 함정의 원인.
- 매칭 조건은 `status === "pending" && entry.ip === ip` 로 단순화.
- **`multiple_claims` 가드(>1 → 아무것도 승인 안 함)는 유지** (안전망). Fix-2 로 실질 미발동.

## Fix-4 (러너) — runnerInstanceId 영구 저장 + register 에 전송 · Fix-2 의 짝

- 신규 모듈(예: `packages/runner/src/hosted/runnerInstanceId.ts`):
  - `~/.jasojeon/instance-id` (평문 UUID) 읽기, 없으면 생성 후 저장. **시크릿 아님**(식별자).
  - **바이너리 밖**(`~/.jasojeon`)에 저장 → 재시작·버전업에도 동일 ID 유지.
- `pairingClient.ts` `registerClaim` 의 POST body 에 `runnerInstanceId` 포함.

## Fix-5 (러너) — 단일 인스턴스 락 (PID 기반 · stale 내성 · last-wins) · M3

- 락 파일: `~/.jasojeon/runner.lock` → `{ pid, startedAt }`.
- 러너 시작 시(`index.ts`/`cli.ts` 초입):
  1. 락 파일 읽기.
  2. holder PID 생존 확인 (`process.kill(pid, 0)`).
     - 죽었으면(크래시/임의 종료 잔재) → 락 인계.
     - 살아있으면 → **그 프로세스가 jasojeon-runner 인지 검증 후** 종료(SIGTERM→필요시 SIGKILL/taskkill), 해제 대기.
       - 검증(재사용 PID 오살 방지): Windows `tasklist /FI "PID eq <pid>"` 이미지명, unix `ps -p <pid> -o comm=` 로 러너 바이너리명 확인. 불일치면 종료하지 말고 락만 인계.
  3. 자기 PID 로 락 갱신.
  4. 정상 종료 시 락 제거(best-effort).
- 정책: **last-wins** (새로 켠 게 주인) — 사용자가 자주 재실행/버전업하는 패턴에 맞춤.

---

## 시나리오 검증 (설계 의도)

| 시나리오 | 처리 | 경로 |
|----------|------|------|
| 임의 종료 후 재실행 | ✅ | 저장 토큰으로 WS 재연결(재페어링 X). 잔재 락은 stale 인계, 잔재 claim 은 Fix-2 supersede |
| 재시작 | ✅ | 위와 동일 |
| 버전업(새 바이너리 다운로드·실행) | ✅ | 새 바이너리도 `~/.jasojeon` 의 token·instanceId 재사용. 구버전 프로세스는 PID 락 인계로 종료(버전 무관) |
| `~/.jasojeon` 통째 삭제 | ⚠️ 불가피 | 신원 소실 → 최초 페어링 재수행 (설계상 어쩔 수 없음) |

## 보안 체크리스트
- supersede 대상은 `status === "pending"` 한정 (approved/authorized 불가침).
- supersede 키는 `runnerInstanceId` (IP 아님).
- `multiple_claims` 가드 코드 유지.
- 2분 창 제거는 trustProxy(Fix-1) 와 **반드시 함께** — 안 그러면 IP 격리가 가짜인 채 창만 넓어짐.

## 구현 분담 (파일 disjoint → 병렬 가능)
- **백엔드 에이전트**: `app.ts`(Fix-1), `pairing.ts` + RegisterClaimBodySchema 위치(Fix-2,3). TDD.
- **러너 에이전트**: `runnerInstanceId.ts`(신규), `pairingClient.ts`(Fix-4), `index.ts`/`cli.ts`(Fix-5). TDD.
- 공통 계약: body 필드명 `runnerInstanceId`.

## 검증
- 각 에이전트 `./scripts/check.sh` 통과 (기존 Windows EBUSY 플레이크 제외).
- 머지 후 deploy-dev 재빌드 → 러너 재다운로드 후: 재시작·버전업 시 재페어링 없이 재연결되는지 실측.

## 미포함 (후속)
- 프론트 `multiple_claims`/`no_claim` 처리 + claimId 명시 경로 (M5).
- self-heal 재시도 횟수 증가 (M6).
- deviceHub ping `frame missing {type} wrapper` 경고.
