// ATS(Applicant Tracking System) 채용 사이트명 블랙리스트
// 이 패턴들은 <title>에 사이트명이 포함될 경우 해당 title이
// companyName / roleName 폴백 소스로 사용되면 안 되도록 걸러냅니다.
//
// 패턴 선정 기준: "대기업이 자체 공고 타이틀로 쓸 리 없는" 고유한 채용 플랫폼 명칭.
// 초기 5개만 포함 — Chunk 7 fixture 재측정 후 필요 시 확장.

const ATS_SITE_PATTERNS: readonly RegExp[] = [
  /점핏/,
  /원티드/,
  /사람인/,
  /기아\s*탤런트\s*라운지/i
] as const;

/**
 * title 문자열이 ATS 채용 사이트명을 포함하는지 검사합니다.
 * 매칭 시 해당 title은 companyName/roleName 추출에 사용하면 안 됩니다.
 */
export function isAtsSiteTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  return ATS_SITE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * title이 ATS 사이트명을 포함하면 undefined를 반환합니다.
 * 아니면 원본 title을 그대로 반환합니다.
 */
export function filterAtsFromTitle(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }
  return isAtsSiteTitle(title) ? undefined : title;
}
