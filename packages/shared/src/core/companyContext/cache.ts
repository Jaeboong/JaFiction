import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WebSearchResult } from "../webSearch/provider";

export interface WebSearchCacheEntry {
  companyName: string;
  providerId: "naver" | "brave";
  fetchedAt: string;
  expiresAt: string;
  query: {
    companyName: string;
    roleName?: string;
    keywords?: readonly string[];
  };
  results: readonly WebSearchResult[];
}

function makeCacheKey(companyName: string, providerId: "naver" | "brave"): string {
  const normalized = companyName.trim().toLowerCase();
  return crypto.createHash("sha1").update(`${normalized}|${providerId}`).digest("hex");
}

function getCacheDir(storageRoot: string): string {
  return path.join(storageRoot, "company-context-cache");
}

function getCachePath(storageRoot: string, companyName: string, providerId: "naver" | "brave"): string {
  return path.join(getCacheDir(storageRoot), `${makeCacheKey(companyName, providerId)}.json`);
}

export async function readWebSearchCache(
  storageRoot: string,
  companyName: string,
  providerId: "naver" | "brave"
): Promise<WebSearchCacheEntry | undefined> {
  const filePath = getCachePath(storageRoot, companyName, providerId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entry = JSON.parse(raw) as WebSearchCacheEntry;
    if (new Date(entry.expiresAt) < new Date()) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

export async function writeWebSearchCache(
  storageRoot: string,
  entry: WebSearchCacheEntry
): Promise<void> {
  const cacheDir = getCacheDir(storageRoot);
  await fs.mkdir(cacheDir, { recursive: true });
  const filePath = getCachePath(storageRoot, entry.companyName, entry.providerId);
  await fs.writeFile(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

export function buildCacheEntry(
  companyName: string,
  providerId: "naver" | "brave",
  query: { companyName: string; roleName?: string; keywords?: readonly string[] },
  results: readonly WebSearchResult[],
  ttlDays: number
): WebSearchCacheEntry {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  return {
    companyName,
    providerId,
    fetchedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    query,
    results
  };
}
