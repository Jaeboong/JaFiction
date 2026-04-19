import type { JobPostingFieldKey } from "../../jobPosting";
import type { SourceTier } from "../../sourceTier";
import type { JsonLdJobPostingFields } from "../jsonLd";

export interface SiteAdapterMatch {
  siteKey: string;
  canonicalUrl?: string;
}

export interface FieldExtraction {
  value: string;
  tier: SourceTier;
}

export interface SiteAdapterResult {
  fields: Partial<Record<JobPostingFieldKey, FieldExtraction>>;
  signatureVerified: boolean;
  adapterTrust: "high" | "medium" | "low";
  warnings: string[];
}

export interface SiteAdapterContext {
  url: string;
  jsonLdFields?: JsonLdJobPostingFields;
  normalizedText: string;
}

export interface SiteAdapter {
  readonly siteKey: string;
  match(url: string): SiteAdapterMatch | undefined;
  extract(html: string, ctx: SiteAdapterContext): SiteAdapterResult | undefined;
}
