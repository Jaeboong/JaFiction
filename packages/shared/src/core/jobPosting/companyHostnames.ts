export interface HostnameCompanyHint {
  readonly hostPattern: RegExp;
  readonly companyName: string;
}

export const HOSTNAME_COMPANY_HINTS: readonly HostnameCompanyHint[] = [
  { hostPattern: /(?:^|\.)idis\./i, companyName: "아이디스" }
];

export function deriveCompanyNameHintsFromHostname(hostname: string | undefined): string[] {
  if (!hostname?.trim()) {
    return [];
  }

  const normalizedHostname = hostname.trim();
  const companyNames = new Set<string>();
  for (const hint of HOSTNAME_COMPANY_HINTS) {
    if (hint.hostPattern.test(normalizedHostname)) {
      companyNames.add(hint.companyName);
    }
  }
  return [...companyNames];
}
