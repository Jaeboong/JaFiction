---
date: 2026-04-19
status: stub
parent: docs/plans/2026-04-19-posting-parser-p1-jsonld.md
---

# P1 §11 — dev-login endpoint for L3 CDP verification

**상태**: 설계 단계. 구현 보류 (후속 이슈).

**원본 plan**: docs/plans/2026-04-19-posting-parser-p1-jsonld.md §11

## 목적

Google OAuth 때문에 CDP 자동 로그인이 막혀있어 L3 (로그인 후 뷰) 검증이 불가. dev 환경 전용 로그인 우회 엔드포인트로 해결.

## 범위

- backend 라우트: dev 환경 한정 /auth/dev-login
- 세션 쿠키/토큰 발급 경로
- 보안 가드: NODE_ENV=development + 로컬 IP only + feature flag

## 제약

- 프로덕션 배포 절대 금지
- CI 에서 production 빌드 시 해당 라우트 완전 제거되어야 함

## 분리 이유

P1 posting parser refactor 본체와 scope 다름 (백엔드 인프라 작업). PR 크기 관리 + 리뷰 집중도를 위해 분리.
