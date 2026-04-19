import { z } from "zod";

export const SOURCE_TIERS = ["factual", "contextual", "role"] as const;

export type SourceTier = (typeof SOURCE_TIERS)[number];

export const SourceTierSchema = z.enum(SOURCE_TIERS);

export function isFactual(t: SourceTier): boolean {
  return t === "factual";
}

// 현재는 "role"만 weak tier. 추후 contextual 등급 강등 시 여기에 추가.
export function isWeakTier(t: SourceTier): boolean {
  return t === "role";
}

export function compareTiers(a: SourceTier, b: SourceTier): -1 | 0 | 1 {
  const ia = SOURCE_TIERS.indexOf(a);
  const ib = SOURCE_TIERS.indexOf(b);
  if (ia < ib) return 1;
  if (ia > ib) return -1;
  return 0;
}
