export function buildStructuredKoreanResponseInstruction(): string {
  return [
    "IMPORTANT: Write all substantive content in Korean (한국어).",
    "Keep the required English section headings exactly as written.",
    "Do not switch to English unless the user explicitly asks for it."
  ].join(" ");
}

export function buildRealtimeKoreanResponseInstruction(): string {
  return [
    "IMPORTANT: Write your response sentences in Korean (한국어).",
    "Keep any required English status line exactly as written.",
    "Do not switch to English unless the user explicitly asks for it."
  ].join(" ");
}

export function buildFinalEssayKoreanInstruction(): string {
  return "IMPORTANT: Write the final essay draft in Korean (한국어) unless the user explicitly asks for another language.";
}

export function buildNotionPrePassKoreanInstruction(): string {
  return [
    "IMPORTANT: Write all substantive content in Korean (한국어).",
    "Keep the required English top-level section headings exactly as written.",
    "Do not switch to English unless the user explicitly asks for it."
  ].join(" ");
}

export function buildFormalToneRuleBlock(): string {
  return [
    "## 어조 규칙",
    "- 사용자에게 노출되는 모든 텍스트(초안, 설명, 피드백, 미니 초안)는 반드시 존댓말(해요체 또는 합쇼체)로 작성한다.",
    "- \"나는 ~한다\", \"~이다\", \"~한다\" 형태의 반말은 절대 사용하지 않는다.",
    "- 내부 구조 필드(섹션 키, verdict 토큰, 티켓 ID 등)는 이 규칙에서 제외된다."
  ].join("\n");
}

// 자소서 작성 규칙 — Drafter 전용. 두괄식·확정형 종결·How 있는 마무리·금지표현.
export function buildJasoWritingRulesBlock(): string {
  return [
    "## 자소서 작성 규칙",
    "- 두괄식: 각 문항/섹션의 첫 문장에 결론 1문장을 둔다.",
    "- 강점·경험은 [기술·방법 + 문제 + 해결 과정 + 결과]를 갖춰 서술한다. 단순 나열 금지.",
    "- 추상어 대신 구체(무엇을·어떻게·결과)로 쓴다. 보유한 수치가 있으면 본문으로 끌어올리되, 없는 수치는 날조하지 않는다.",
    "- 협업은 '내가 무엇을 판단·주도·완수했는지'(능동)에 분량을 둔다. '팀이 잘했다'(수동) 금지.",
    "- 종결은 확정형(~입니다/~하겠습니다). 추측형(~인 것 같습니다)·자기비하(부족하지만)·조건절(뽑아주신다면)은 금지.",
    "- 마무리는 How가 있는 인과로 닫는다: \"[역량]으로 [과제]를 [방법]으로 풀겠습니다\". How 없는 \"기여하겠습니다\"·\"성장하겠습니다\"는 금지.",
    "- 지원 대상이 아닌 제3 기업명·프로젝트 코드네임은 업종·서비스 설명으로 일반화한다(지원 대상 기업명만 실명)."
  ].join("\n");
}

// AI 말투 블랙리스트 — 어조(authenticity) 리뷰어 전용. 진정성 감점 신호 탐지.
export function buildAntiAiToneChecklist(): string {
  return [
    "## AI 말투 점검 (감점 신호)",
    "아래 패턴이 보이면 진정성 감점으로 보고 구체 사실로 교체·삭제를 요구한다.",
    "- 경험↔직무 연결 상투구: \"~로 이어진다 / 닿아 있다 / 맞물린다 / 잘 맞는다 / 그대로 살리고 싶다\"",
    "- 대조 프레이밍: \"단순히 ~이 아니라 / ~수준을 넘어 / ~에 그치지 않고\"",
    "- 추상 관용어·비유: \"체화했다 / 녹여냈다 / 하나의 흐름으로 붙었다 / 몸에 뱄다\"",
    "- 이중부정: \"낯설지 않다 / 어렵지 않다 / 막연하지 않다\"",
    "- 자기평가 헤지: \"~편이라 / ~인 것 같습니다 / ~라고 생각합니다(남발)\"",
    "- 공허한 의지표명 마무리: \"성장하겠습니다 / 힘을 보태겠습니다 / 최선을 다하겠습니다 / 배우는 자세로\"",
    "- 군더더기 강조어: \"직접 / 정말 / 매우 / 아주 / 바로 / 무엇보다\"",
    "판단 기준: 한 문장에서 '실제로 무슨 일을 했는지'가 안 나오면(느낌만) 감점."
  ].join("\n");
}
