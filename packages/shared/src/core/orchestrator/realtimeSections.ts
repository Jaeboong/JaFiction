import { DiscussionLedger, RealtimeSectionDefinition } from "../types";
import { getLedgerTickets, normalizeSectionKey } from "./discussion/discussionLedger";

const baseRealtimeSectionDefinitions: readonly RealtimeSectionDefinition[] = [
  {
    key: "intro-section",
    label: "도입 문단",
    responsibilities: ["핵심 경험이나 문제의식을 첫 문단에서 선명하게 제시합니다."],
    deferredTo: ["motivation-section", "collaboration-section", "why-banking", "why-company", "future-impact"]
  },
  {
    key: "motivation-section",
    label: "지원 동기 문단",
    responsibilities: ["지원 동기와 본인 경험의 연결을 현재 섹션에서 정리합니다."],
    deferredTo: ["collaboration-section", "why-banking", "why-company", "future-impact"]
  },
  {
    key: "why-banking",
    label: "직무 지원 이유",
    responsibilities: ["직무 적합성과 지원 이유를 구체적 경험과 연결합니다."],
    deferredTo: ["why-company", "future-impact"]
  },
  {
    key: "why-company",
    label: "왜 회사인가",
    responsibilities: ["회사 선택 이유와 산업 맥락을 현재 섹션에서 설명합니다."],
    deferredTo: ["future-impact"]
  },
  {
    key: "collaboration-section",
    label: "협업 문단",
    responsibilities: ["협업 역할, 조율, 갈등 해결은 이 섹션에서 처리합니다."],
    deferredTo: ["future-impact"]
  },
  {
    key: "future-impact",
    label: "입행 후 포부",
    responsibilities: ["입행 후 포부와 기여 계획을 현재 섹션에서 정리합니다."]
  }
] as const;

export function buildRealtimeSectionDefinitions(ledger?: DiscussionLedger): RealtimeSectionDefinition[] {
  const definitions = new Map<string, RealtimeSectionDefinition>(
    baseRealtimeSectionDefinitions.map((definition) => [definition.key, { ...definition }])
  );

  const registerDefinition = (key: string | undefined, label: string | undefined): void => {
    if (!key && !label) {
      return;
    }

    const normalizedKey = normalizeSectionKey(key || label || "section");
    const normalizedLabel = label?.trim() || key?.trim() || normalizedKey;
    const existing = definitions.get(normalizedKey);
    if (existing) {
      if (!existing.label && normalizedLabel) {
        definitions.set(normalizedKey, { ...existing, label: normalizedLabel });
      }
      return;
    }

    definitions.set(normalizedKey, {
      key: normalizedKey,
      label: normalizedLabel
    });
  };

  if (ledger) {
    registerDefinition(ledger.targetSectionKey, ledger.targetSection);
    for (const ticket of getLedgerTickets(ledger)) {
      registerDefinition(ticket.sectionKey, ticket.sectionLabel);
    }
  }

  return [...definitions.values()];
}
