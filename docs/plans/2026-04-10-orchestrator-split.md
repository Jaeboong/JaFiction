# orchestrator.ts 모듈 분리 설계안

> 작성: 2026-04-10 (Opus Plan)  
> 기준 상태: Part A + Part B 완료, P1/P2 픽스 완료 후

---

## 현재 구조 요약

- `packages/shared/src/core/orchestrator.ts` — 4616줄
- 외부 export: `OrchestratorGateway`, `ReviewOrchestrator`, `UserInterventionRequest` 3개만
- 클래스 실질 메서드: `run()` (1395줄), `executeTurn()`, `recordEvent()`
- 나머지 ~2850줄 = 파일 레벨 순수 헬퍼 함수 → 클래스에 전혀 의존하지 않음 → 분리 유리

---

## 책임 덩어리 (변경 이유 기준)

| # | 모듈 | 변경 이유 | 예상 라인 |
|---|------|---------|---------|
| A | 프롬프트 빌더 (4개 서브파일) | 프롬프트 문구·지시사항·규칙 수정 | ~1200 |
| B | 응답 파싱 | LLM 출력 포맷 변경, 파서 견고성 | ~550 |
| C | Discussion Ledger & Challenge Ticket | ledger transition, deferred-close, ticket ID 규칙 | ~600 |
| D | Reviewer 합의·수렴 평가 | majority verdict, convergence 기준 | ~200 |
| E | 참가자 구성 | 역할 매핑 변경 | ~100 |
| G | Notion 요청 / realtime 섹션 정의 | Notion 규칙, 기본 섹션 변경 | ~150 |
| H | Chat 이벤트 뷰 | 메시지 표시 규칙 변경 | ~60 |
| I | Continuation 조립 | 이어쓰기 UX 규칙 변경 | ~130 |
| J | TurnExecutor (선택) | gateway 호출/이벤트 기록 규칙 | ~150 |
| K | **orchestrator.ts (잔존)** | 워크플로우 순서/모드 간 흐름 | ~1500 |

---

## 최종 디렉터리 구조

```
packages/shared/src/core/
  orchestrator.ts                        # ReviewOrchestrator, run(), 2개 export 인터페이스
  orchestrator/
    chatEvents.ts                        # H
    continuation.ts                      # I
    notionRequest.ts                     # G
    realtimeSections.ts                  # G
    participants.ts                      # E
    parsing/
      responseParsers.ts                 # B
    discussion/
      discussionLedger.ts                # C
      convergenceEvaluator.ts            # D
    prompts/
      languageRules.ts                   # A4 — 존댓말/어조 규칙
      promptBlocks.ts                    # A3 — 범용 블록 빌더
      deepFeedbackPrompts.ts             # A1 — Deep 모드 프롬프트
      realtimePrompts.ts                 # A2 — Realtime 모드 프롬프트
    turnExecutor.ts                      # J (선택)
```

---

## 모듈 상세

### A1. `prompts/deepFeedbackPrompts.ts`
`buildDeepSectionCoordinatorPrompt`, `buildSectionDrafterPrompt`, `buildDeepReviewerPrompt`, `buildDeepCoordinatorDecisionPrompt`, `buildDeepFinalizerPrompt`, `getPerspectiveInstruction` 및 관련 block builder.  
의존: A3, A4, B 타입, continuation, 참가자

### A2. `prompts/realtimePrompts.ts`
`buildRealtimeCoordinatorDiscussionPrompt`, `buildRealtimeCoordinatorRedirectPrompt`, `buildRealtimeReviewerPrompt`, `buildRealtimeFinalDraftPrompt`, `buildRealtimeSectionDrafterPrompt`, `buildInterventionCoordinatorPrompt`, `buildDevilsAdvocatePrompt`, `buildWeakConsensusPolishPrompt`, `buildNotionPrePassPrompt` 및 관련 block builder.  
의존: A3, A4, C, D, B, G

### A3. `prompts/promptBlocks.ts`
`buildPrompt`, `finalizePromptMetrics`, `sumPromptBlockChars`, `escapeRegExp`, `buildSessionSnapshotBlock`, `buildBindingDirectiveBlock`, `buildUserGuidanceBlock`, `buildDiscussionLedgerBlock`, `buildChallengeTicketBlock`, `buildValidSectionKeysBlock`.  
의존: `types.ts`만 (가장 하위 레이어)

### A4. `prompts/languageRules.ts`
`buildStructuredKoreanResponseInstruction`, `buildRealtimeKoreanResponseInstruction`, `buildFinalEssayKoreanInstruction`, `buildNotionPrePassKoreanInstruction`, `buildFormalToneRuleBlock`.  
의존: 없음. 순수 상수 문자열 빌더.

### B. `parsing/responseParsers.ts`
`splitCoordinatorSections`, `extractNotionBrief`, `extractMarkdownSection`, `splitSectionCoordinationBrief`, `extractSectionDraft`, `splitCoordinatorDecisionOutput`, `splitFinalizerOutput`, `extractDiscussionLedger`, `parseDiscussionLedgerItems`, `extractSectionOutcome`, `extractChallengeDecisions`, `extractRealtimeReviewerObjection`, `extractRealtimeReviewerSection`, `extractNormalizedReviewerChallenge`, `extractRealtimeReviewerChallengeAction`, `extractInterventionCoordinatorDecision`, `extractCoordinatorEscalationQuestion` 등.  
의존: `types.ts`, C (`seedTicketsFromLegacyLedger` 방향 주의)

> **순환 의존 주의**: `extractDiscussionLedger`(B)가 `seedTicketsFromLegacyLedger`(C)를 호출 → B+C를 같은 단계에서 이동, B → C 단방향으로 정리.

### C. `discussion/discussionLedger.ts`
`buildChallengeTicketId`, `normalizeSectionKey`, `seedTicketsFromLegacyLedger`, `applyCoordinatorChallengeDecisions`, `deriveLedgerViewsFromTickets`, `dedupeStrings`, `getLedgerTargetSectionKey`, `getLedgerTickets`, `pickNextTargetSectionCluster`, `transitionDiscussionLedgerToNextCluster`, `transitionDiscussionLedgerAfterDeferredClose`, `deferCurrentSectionTickets`, `forceAcceptCurrentSection`, `hasForceCloseDirective`, `normalizeRealtimeInterventionMessages`.  
의존: `types.ts`, B 타입

### D. `discussion/convergenceEvaluator.ts`
`summarizeRealtimeReviewerVerdicts`, `hasAllApprovingRealtimeReviewers`, `hasBlockingRealtimeReviewer`, `isCurrentSectionReady`, `isWholeDocumentReady`, `validateSectionOutcome`, `forceSectionClosureOutcome`, `shouldRunWeakConsensusPolish`, `normalizeMaxRoundsPerSection`.  
의존: C, types, B의 `RealtimeReviewerStatus`

### E. `participants.ts`
`ReviewParticipant` interface, `buildResearchParticipant`, `buildCoordinatorParticipant`, `buildDrafterParticipant`, `buildFinalizerParticipant`, `buildReviewerParticipants`, `turnLabel`.  
의존: `types.ts`, `roleAssignments`

### G. `notionRequest.ts` + `realtimeSections.ts`
Notion: `normalizeNotionRequest`, `resolveNotionRequestDescriptor`, `compressNotionBrief`, `deriveImplicitNotionRequest`, `buildAutoNotionRequest`.  
Section: `baseRealtimeSectionDefinitions` (L187), `buildRealtimeSectionDefinitions`.  
의존: `types.ts`만

### H. `chatEvents.ts`
`applyChatEvent`, `chatSpeakerLabel`, `providerLabel`.  
의존: `types.ts`만

### I. `continuation.ts`
`appendContinuationContext`, `buildContinuationBlock`, `buildPreviousConversationHighlights`, `truncateContinuationText`.  
의존: types, storage의 `RunContinuationContext` 타입

### J. `turnExecutor.ts` (선택)
`ReviewOrchestrator.executeTurn`, `recordEvent`를 `TurnExecutor` 클래스로 추출, `createLinkedAbortController`.  
의존: gateway, storage, types, A3.  
**리스크**: `executeTurn`이 `this.storage.storageRoot` 참조, 호출부 다수. 마지막 단계에서 적용하거나 생략 가능.

### K. `orchestrator.ts` (잔존)
- `OrchestratorGateway` 인터페이스 (외부 계약)
- `UserInterventionRequest` 인터페이스 (외부 계약)
- `ReviewOrchestrator` — `run()` 메서드 + 내부 클로저 전부 유지
- (J 미적용 시) `executeTurn`, `recordEvent`

> `run()` 내 클로저들(`emitUserIntervention`, `buildCompiledContextMarkdown`, `updateDiscussionLedger`, `persistTurnsAndChat` 등)은 모두 `run()`의 지역 상태 캡처 → 추출 금지. 변경 이유가 같은 코드는 같이 둔다.

---

## 분리 순서 (leaf → root)

각 단계 후 `./scripts/with-npm.sh run test -- --testPathPattern=orchestrator` 통과 확인. 37개 테스트 전부 통과 필수.

### Phase 1 — leaf (의존성 없음)
1. **H** `chatEvents.ts`
2. **G** `notionRequest.ts` + `realtimeSections.ts`
3. **I** `continuation.ts`
4. **E** `participants.ts`
5. **A4** `prompts/languageRules.ts`

### Phase 2 — 파싱·도메인 로직
6. **B + C** `parsing/responseParsers.ts` + `discussion/discussionLedger.ts` (함께 이동, B → C 단방향)
7. **D** `discussion/convergenceEvaluator.ts`

### Phase 3 — 프롬프트 빌더
8. **A3** `prompts/promptBlocks.ts`
9. **A1** `prompts/deepFeedbackPrompts.ts`
10. **A2** `prompts/realtimePrompts.ts`

### Phase 4 — 선택
11. **J** `turnExecutor.ts` (선택, 가장 위험 → 마지막 또는 생략)

### Phase 5 — 정리
12. `orchestrator.ts` import 재정리, 불필요한 타입 alias 제거, 최종 빌드+테스트

---

## 공통 주의사항

1. **함수 본문과 문자열 리터럴은 1바이트도 바꾸지 않는다.** 프롬프트 테스트가 문자열 assertion을 포함함.
2. 함수 이동 후 원본 파일에는 **import만 추가**. 호출 코드 수정 금지.
3. 타입 interface는 **가장 많이 참조되는 파일에 선언** (B 생성, C 소비 → B에 선언하고 C가 import).
4. 각 단계 후 `./scripts/check.sh` 통과 확인.
5. **커밋 단위 = 모듈 1개** — 실패 시 되돌리기 쉬워야 함.
6. DIP/ISP interface 추상화는 도입하지 않음. 구현체가 하나인 시스템에서 오버엔지니어링.
