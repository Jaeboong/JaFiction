import type { SourceTier } from "../../sourceTier";
import type { FieldExtraction, SiteAdapterResult } from "./types";

const selectorPartPattern = /(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])|(^[a-z][\w-]*)/gi;

export function verifySignature(html: string, selectors: string[]): boolean {
  return selectors.some((selector) => selectorMatchesHtml(html, selector));
}

export function downgradeTier(tier: SourceTier): SourceTier {
  switch (tier) {
    case "factual":
      return "contextual";
    case "contextual":
      return "role";
    case "role":
      return "role";
  }
}

export function downgradeAllFields(result: SiteAdapterResult): SiteAdapterResult {
  const downgradedFields = Object.entries(result.fields).reduce<SiteAdapterResult["fields"]>((accumulator, [fieldKey, extraction]) => {
    if (!extraction) {
      return accumulator;
    }

    accumulator[fieldKey as keyof SiteAdapterResult["fields"]] = downgradeFieldExtraction(extraction);
    return accumulator;
  }, {});

  return {
    ...result,
    fields: downgradedFields,
    warnings: [...result.warnings]
  };
}

function downgradeFieldExtraction(extraction: FieldExtraction): FieldExtraction {
  return {
    ...extraction,
    tier: downgradeTier(extraction.tier)
  };
}

function selectorMatchesHtml(html: string, selector: string): boolean {
  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    return false;
  }

  const selectorParts = normalizedSelector.match(selectorPartPattern);
  if (!selectorParts || selectorParts.length === 0) {
    return html.includes(normalizedSelector);
  }

  return selectorParts.every((part) => selectorPartMatchesHtml(html, part));
}

function selectorPartMatchesHtml(html: string, selectorPart: string): boolean {
  if (selectorPart.startsWith("#")) {
    const id = selectorPart.slice(1);
    return extractAttributeValues(html, "id").some((value) => value.trim() === id);
  }

  if (selectorPart.startsWith(".")) {
    const className = selectorPart.slice(1);
    return extractAttributeValues(html, "class").some((value) => value.split(/\s+/).includes(className));
  }

  if (selectorPart.startsWith("[")) {
    return attributeSelectorMatchesHtml(html, selectorPart);
  }

  return new RegExp(`<${escapeRegExp(selectorPart)}\\b`, "i").test(html);
}

function attributeSelectorMatchesHtml(html: string, selectorPart: string): boolean {
  const content = selectorPart.slice(1, -1).trim();
  if (!content) {
    return false;
  }

  const equalsIndex = content.indexOf("=");
  if (equalsIndex === -1) {
    return new RegExp(`\\b${escapeRegExp(content)}\\s*=`, "i").test(html);
  }

  const attributeName = content.slice(0, equalsIndex).trim();
  const rawValue = content.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
  return new RegExp(`\\b${escapeRegExp(attributeName)}\\s*=\\s*["'][^"']*${escapeRegExp(rawValue)}[^"']*["']`, "i").test(html);
}

function extractAttributeValues(html: string, attributeName: string): string[] {
  const pattern = new RegExp(`\\b${escapeRegExp(attributeName)}\\s*=\\s*["']([^"']*)["']`, "gi");
  const values: string[] = [];

  let match = pattern.exec(html);
  while (match) {
    values.push(match[1] || "");
    match = pattern.exec(html);
  }

  return values;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
