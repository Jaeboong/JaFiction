# 2026-05-27 — 멀티 러너 라우팅: 최근 활성 러너 우선

## 증상

회사 노트북에서 러너가 `auth OK` 떴는데도 웹 UI가 러너에 연결되지 않음.
설정에서 **집 데스크톱 device를 "연결 해제(revoke)"하면** 그제서야 노트북이 붙음.

## 근본 원인

`packages/backend/src/routes/rpc.ts:79-81`:

```ts
const deviceIds = await deps.deviceStore.listActiveDeviceIds(user.id);
const deviceId = deviceIds.find((id) => deps.hub.isConnected(id));
```

`listActiveDeviceIds`(`rpc.ts:37-44`)가 **정렬 없이** device id를 반환 → `find`가
"DB에서 먼저 나온 것"(보통 먼저 생성된 데스크톱)을 선택. 데스크톱이 꺼져 있어도
hub에 **죽은 WS 엔트리가 남아 `isConnected`가 true**(heartbeat/죽은연결 정리 없음)라,
RPC가 시체 데스크톱으로 가서 타임아웃. revoke 시 `disconnectDevice`가 그 엔트리를
강제로 제거해 노트북이 1순위가 됨.

## 이번 변경 (Small fix — 사용자 승인)

`listActiveDeviceIds`를 `last_seen_at DESC NULLS LAST`로 정렬.
→ 방금 붙은(=최신 `last_seen_at`) 러너가 1순위 → `find(isConnected)`가 그 러너 선택.
두 머신 모두 페어링 유지, "지금 켠 머신으로 자동 연결" 동작.

### 작업 (완료 2026-05-27)

- [x] `packages/backend/src/routes/rpc.ts` `createDrizzleRpcDeviceStore.listActiveDeviceIds`에
      `.orderBy(sql\`${devices.last_seen_at} DESC NULLS LAST\`)` 추가.
- [x] 이제 틀린 주석 갱신: 파일 상단 "single device per user" / line 79 "first active".
- [x] `packages/backend/src/test/rpcRoute.test.ts`: 러너 2대(dev-new/dev-old) 둘 다 연결,
      store가 `["dev-new","dev-old"]` 반환 시 응답이 dev-new에서 오는지 검증.
      (SQL `ORDER BY` 자체는 DB 하네스가 없어 단위테스트 미커버 — 리스크 낮음)
- [x] `./scripts/check.sh` — 통과 (backend 81 tests pass, web build OK, doc links OK).

구현은 Codex(`task-mpncp86j-kvhd6c`)에 위임, Claude가 diff 리뷰 + check.sh 직접 실행 검증.

## 후속 (이번 범위 아님)

1. **죽은 WS 정리 / heartbeat** — `packages/backend/src/ws/deviceHub.ts`에 ping/타임아웃
   기반 죽은연결 eviction. 시체 엔트리 자체를 제거하는 진짜 근본 수정.
2. **`pairing.ts:430` 크로스유저** — `getConnectedDeviceIds()`가 전역(유저 스코프 아님).
   현재 `NODE_ENV !== production` 게이트로 막혀있지만 유저 스코프로 좁혀야 함. (보안)

## 설치 마법사 관련

브라우저는 샌드박스 때문에 로컬 exe 실행 불가 → 마법사가 설치된 러너를 "실행"시킬 수 없음.
러너는 부팅 시 자동 실행되므로, 위 라우팅이 고쳐지면 이미 페어링된 머신은 `authorized`
분기로 빠져 "설치" 단계가 안 뜸. 마법사 자체는 손댈 것 없음.
