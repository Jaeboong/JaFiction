import type { SourceTier } from "../sourceTier";

export interface JsonLdJobPostingFields {
  title?: string;
  companyName?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  locationText?: string;
  baseSalaryText?: string;
  sourceTier: SourceTier;
}

type JsonLdRecord = Record<string, unknown>;

const jsonLdScriptPattern = /<script\b[^>]*\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
const metaTagPattern = /<meta\b[^>]*>/gi;
const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const stripTagsPattern = /<[^>]+>/g;
const lineBreakTagPattern = /<br\s*\/?>/gi;
const paragraphTagPattern = /<\/?p\b[^>]*>/gi;
const collapseSpacesPattern = /[ \t\u00a0]+/g;
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})[tT ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:[zZ]|[+-]\d{2}:\d{2})?$/;

export function extractJsonLdJobPosting(html: string): JsonLdJobPostingFields | undefined {
  for (const match of html.matchAll(jsonLdScriptPattern)) {
    try {
      const raw = JSON.parse(match[1]);
      const jobPosting = findJobPosting(raw);
      if (jobPosting) {
        return mapJobPosting(jobPosting);
      }
    } catch {
      // 파싱 실패 블록은 건너뛰고 다음 블록을 확인한다.
    }
  }

  return undefined;
}

export function normalizeJobPostingRoleName(title: string, hiringOrgName?: string): string {
  let s = title.trim();
  if (hiringOrgName) {
    const orgEsc = hiringOrgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`^${orgEsc}\\s*(?:직원\\s*)?채용\\s*`), "").trim();
  }
  const parenMatch = s.match(/^\(([^)]+)\)$/);
  if (parenMatch) {
    s = parenMatch[1].trim();
  }
  s = s.replace(/\s*채용\s*$/, "").trim();
  return s;
}

export function stripJobPostingDescriptionHtml(description: string): string {
  return normalizeMultilineText(
    decodeHtmlEntities(
      description
        .replace(/\r\n/g, "\n")
        .replace(lineBreakTagPattern, "\n")
        .replace(paragraphTagPattern, "\n")
        .replace(stripTagsPattern, " ")
    )
  );
}

export function normalizeEmploymentType(raw: string): string | undefined {
  const normalized = raw.trim().toUpperCase().replace(/[\s_-]+/g, "");
  switch (normalized) {
    case "FULLTIME":
      return "정규직";
    case "PARTTIME":
    case "CONTRACTOR":
    case "CONTRACT":
      return "계약직";
    case "INTERN":
      return "인턴";
    case "TEMPORARY":
      return "임시직";
    default:
      return undefined;
  }
}

export function normalizeValidThroughIso(iso: string): string | undefined {
  const value = iso.trim();
  if (!value) {
    return undefined;
  }

  const dateOnlyMatch = value.match(dateOnlyPattern);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return isValidDate(Number(year), Number(month), Number(day))
      ? `${year}년 ${month}월 ${day}일`
      : undefined;
  }

  const dateTimeMatch = value.match(dateTimePattern);
  if (!dateTimeMatch) {
    return undefined;
  }

  const [, year, month, day, hour, minute] = dateTimeMatch;
  if (
    !isValidDate(Number(year), Number(month), Number(day)) ||
    !isValidTime(Number(hour), Number(minute))
  ) {
    return undefined;
  }

  return `${year}년 ${month}월 ${day}일, ${hour}:${minute}`;
}

export function extractOgSiteName(html: string): string | undefined {
  for (const tagMatch of html.matchAll(metaTagPattern)) {
    const attributes = parseHtmlAttributes(tagMatch[0]);
    const property = attributes.get("property")?.toLowerCase() || attributes.get("name")?.toLowerCase();
    if (property !== "og:site_name") {
      continue;
    }

    const content = attributes.get("content");
    if (content?.trim()) {
      return normalizeMultilineText(decodeHtmlEntities(content));
    }
  }

  return undefined;
}

function findJobPosting(raw: unknown): JsonLdRecord | undefined {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = findJobPosting(item);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(raw)) {
    return undefined;
  }

  if (hasJobPostingType(raw["@type"])) {
    return raw;
  }

  const graph = raw["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      const found = findJobPosting(item);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function hasJobPostingType(typeValue: unknown): boolean {
  if (typeof typeValue === "string") {
    return typeValue === "JobPosting";
  }

  if (Array.isArray(typeValue)) {
    return typeValue.some((item) => item === "JobPosting");
  }

  return false;
}

function mapJobPosting(jobPosting: JsonLdRecord): JsonLdJobPostingFields {
  const description = getString(jobPosting.description);

  return {
    title: getString(jobPosting.title),
    companyName: extractOrganizationName(jobPosting.hiringOrganization),
    description: description ? stripJobPostingDescriptionHtml(description) || undefined : undefined,
    datePosted: getString(jobPosting.datePosted),
    validThrough: getString(jobPosting.validThrough),
    employmentType: extractEmploymentType(jobPosting.employmentType),
    locationText: extractLocationText(jobPosting.jobLocation),
    baseSalaryText: extractBaseSalaryText(jobPosting.baseSalary),
    sourceTier: "factual"
  };
}

function extractOrganizationName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return getString(value.name);
}

function extractEmploymentType(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
  }

  return undefined;
}

function extractLocationText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const location = extractLocationText(item);
      if (location) {
        return location;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  const address = isRecord(value.address) ? value.address : undefined;
  if (address) {
    return joinDefined([
      getString(address.addressLocality),
      getString(address.streetAddress),
      getString(address.addressRegion),
      getString(address.addressCountry)
    ]);
  }

  return joinDefined([getString(value.name), getString(value.address)]);
}

function extractBaseSalaryText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const currency = getString(value.currency);
  const salaryValue = isRecord(value.value) ? value.value : undefined;
  if (!salaryValue) {
    const directValue = getNumberish(value.value);
    return directValue ? joinDefined([currency, directValue]) : undefined;
  }

  const minValue = getNumberish(salaryValue.minValue);
  const maxValue = getNumberish(salaryValue.maxValue);
  const exactValue = getNumberish(salaryValue.value);
  const unitText = getString(salaryValue.unitText);

  let amountText: string | undefined;
  if (minValue && maxValue) {
    amountText = `${minValue} ~ ${maxValue}`;
  } else {
    amountText = minValue || maxValue || exactValue;
  }

  if (!amountText) {
    return undefined;
  }

  return joinDefined([currency, amountText, unitText ? `/ ${unitText}` : undefined]);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberish(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is JsonLdRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinDefined(values: Array<string | undefined>): string | undefined {
  const parts = values.filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function normalizeMultilineText(text: string): string {
  return text
    .replace(collapseSpacesPattern, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n(?=&(?:[a-z]+|#x?[0-9a-f]+);)/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized in namedEntities) {
      return namedEntities[normalized];
    }

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function parseHtmlAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
