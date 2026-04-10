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
