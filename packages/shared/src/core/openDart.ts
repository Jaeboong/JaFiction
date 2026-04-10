import * as fs from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { OpenDartCandidate } from "./types";
import { ensureDir, fileExists, nowIso, readJsonFile, writeJsonFile } from "./utils";

interface CorpCodeEntry extends OpenDartCandidate {
  modifyDate?: string;
}

interface CorpCodeCache {
  fetchedAt: string;
  entries: CorpCodeEntry[];
}

export interface OpenDartCompanyOverview {
  corpName: string;
  corpCode: string;
  stockCode?: string;
  ceoName?: string;
  corpClass?: string;
  address?: string;
  homepageUrl?: string;
  irUrl?: string;
  phoneNumber?: string;
  establishedAt?: string;
  fiscalMonth?: string;
}

export interface OpenDartFinancialSummary {
  year: number;
  fsDivision: "CFS" | "OFS";
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
  assets?: number;
  liabilities?: number;
  equity?: number;
}

export type OpenDartCompanyResolution =
  | {
      status: "resolved";
      match: OpenDartCandidate;
      overview: OpenDartCompanyOverview;
      financials: OpenDartFinancialSummary[];
      notices: string[];
    }
  | {
      status: "ambiguous";
      candidates: OpenDartCandidate[];
    }
  | {
      status: "notFound";
      notices: string[];
    }
  | {
      status: "unavailable";
      notices: string[];
    };

interface OpenDartJsonResponse {
  status: string;
  message?: string;
  [key: string]: unknown;
}

export class OpenDartClient {
  constructor(
    private readonly storageRoot: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async testConnection(): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    try {
      const entries = await this.loadCorpCodes(true);
      if (entries.length === 0) {
        return {
          ok: false,
          message: "OpenDART 응답은 받았지만 회사 고유번호 목록이 비어 있습니다."
        };
      }

      return {
        ok: true,
        message: `OpenDART 연결이 확인되었습니다. 회사 고유번호 ${entries.length.toLocaleString()}건을 확인했습니다.`
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async resolveAndFetchCompany(companyName: string, selectedCorpCode?: string): Promise<OpenDartCompanyResolution> {
    const entries = await this.loadCorpCodes();
    const matchResult = resolveCompanyCandidates(entries, companyName, selectedCorpCode);
    if (matchResult.status !== "resolved") {
      return matchResult;
    }

    const overview = await this.fetchCompanyOverview(matchResult.match.corpCode);
    const financials = await this.fetchFinancials(matchResult.match.corpCode);
    const notices: string[] = [];
    if (financials.length === 0) {
      notices.push("OpenDART에서 최근 연간 재무제표를 찾지 못했습니다.");
    }

    return {
      status: "resolved",
      match: matchResult.match,
      overview,
      financials,
      notices
    };
  }

  async loadCorpCodes(forceRefresh = false): Promise<CorpCodeEntry[]> {
    const cachePath = this.cachePath("corp-codes.json");
    if (!forceRefresh && (await fileExists(cachePath))) {
      const cached = await readJsonFile<CorpCodeCache>(cachePath, { fetchedAt: "", entries: [] });
      if (cached.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < 7 * 24 * 60 * 60 * 1000 && cached.entries.length > 0) {
        return cached.entries;
      }
    }

    await ensureDir(path.dirname(cachePath));
    const response = await this.fetchWithRetry(
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(this.apiKey)}`
    );
    if (!response.ok) {
      throw new Error(`OpenDART 고유번호 목록을 가져오지 못했습니다 (${response.status}).`);
    }

    const zipBuffer = Buffer.from(await response.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);
    const xmlFile = zip.file(/\.xml$/i)[0];
    const xmlText = xmlFile ? await xmlFile.async("string") : undefined;
    if (!xmlText) {
      throw new Error("OpenDART 고유번호 ZIP에서 XML 파일을 찾지 못했습니다.");
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false
    });
    const parsed = parser.parse(xmlText);
    const rawEntries = asArray(parsed?.result?.list ?? parsed?.list);
    const entries = rawEntries
      .map((entry) => ({
        corpCode: entry?.corp_code ? String(entry.corp_code).trim() : "",
        corpName: entry?.corp_name ? String(entry.corp_name).trim() : "",
        stockCode: entry?.stock_code ? String(entry.stock_code).trim() || undefined : undefined,
        modifyDate: entry?.modify_date ? String(entry.modify_date).trim() : undefined
      }))
      .filter((entry) => entry.corpCode && entry.corpName);

    await writeJsonFile(cachePath, {
      fetchedAt: nowIso(),
      entries
    } satisfies CorpCodeCache);

    return entries;
  }

  async fetchCompanyOverview(corpCode: string): Promise<OpenDartCompanyOverview> {
    const result = await this.requestJson("company.json", { corp_code: corpCode });
    return {
      corpName: String(result.corp_name ?? ""),
      corpCode,
      stockCode: stringOrUndefined(result.stock_code),
      ceoName: stringOrUndefined(result.ceo_nm),
      corpClass: stringOrUndefined(result.corp_cls),
      address: stringOrUndefined(result.adres),
      homepageUrl: stringOrUndefined(result.hm_url),
      irUrl: stringOrUndefined(result.ir_url),
      phoneNumber: stringOrUndefined(result.phn_no),
      establishedAt: stringOrUndefined(result.est_dt),
      fiscalMonth: stringOrUndefined(result.acc_mt)
    };
  }

  async fetchFinancials(corpCode: string): Promise<OpenDartFinancialSummary[]> {
    const currentYear = new Date().getFullYear() - 1;
    const years = [currentYear, currentYear - 1, currentYear - 2];
    const summaries: OpenDartFinancialSummary[] = [];

    for (const year of years) {
      const consolidated = await this.fetchFinancialStatement(corpCode, year, "CFS");
      if (consolidated) {
        summaries.push(consolidated);
        continue;
      }
      const standalone = await this.fetchFinancialStatement(corpCode, year, "OFS");
      if (standalone) {
        summaries.push(standalone);
      }
    }

    return summaries;
  }

  private async fetchFinancialStatement(
    corpCode: string,
    year: number,
    fsDivision: "CFS" | "OFS"
  ): Promise<OpenDartFinancialSummary | undefined> {
    try {
      const result = await this.requestJson("fnlttSinglAcntAll.json", {
        corp_code: corpCode,
        bsns_year: String(year),
        reprt_code: "11011",
        fs_div: fsDivision
      });
      const rows = asArray(result.list).filter(
        (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
      );
      if (rows.length === 0) {
        return undefined;
      }

      return {
        year,
        fsDivision,
        revenue: findAccountAmount(rows, ["매출액", "영업수익", "수익(매출액)"]),
        operatingIncome: findAccountAmount(rows, ["영업이익", "영업손익"]),
        netIncome: findAccountAmount(rows, ["당기순이익", "당기순이익(손실)", "당기순이익(손실)귀속"]),
        assets: findAccountAmount(rows, ["자산총계"]),
        liabilities: findAccountAmount(rows, ["부채총계"]),
        equity: findAccountAmount(rows, ["자본총계"])
      };
    } catch (error) {
      if (error instanceof OpenDartApiError && ["013", "014", "020"].includes(error.code)) {
        if (error.code === "020") {
          throw error;
        }
        return undefined;
      }
      throw error;
    }
  }

  private async requestJson(endpoint: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://opendart.fss.or.kr/api/${endpoint}`);
    url.searchParams.set("crtfc_key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchWithRetry(url);
    if (!response.ok) {
      throw new Error(`OpenDART 요청이 실패했습니다 (${response.status}).`);
    }

    const payload = (await response.json()) as OpenDartJsonResponse;
    if (payload.status !== "000") {
      throw new OpenDartApiError(String(payload.status), payload.message ?? "OpenDART 요청이 실패했습니다.");
    }

    return payload as Record<string, unknown>;
  }

  private cachePath(fileName: string): string {
    return path.join(this.storageRoot, "open-dart", fileName);
  }

  private async fetchWithRetry(input: string | URL, attempts = 2): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(input);
        if (response.ok || (response.status < 500 && response.status !== 429)) {
          return response;
        }
        lastError = new Error(`OpenDART 요청이 실패했습니다 (${response.status}).`);
      } catch (error) {
        lastError = error;
      }

      if (attempt < attempts) {
        await delay(250 * attempt);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("OpenDART 요청이 실패했습니다.");
  }
}

export class OpenDartApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OpenDartApiError";
  }
}

function resolveCompanyCandidates(
  entries: CorpCodeEntry[],
  companyName: string,
  selectedCorpCode?: string
): OpenDartCompanyResolution | { status: "resolved"; match: OpenDartCandidate } {
  const normalizedQuery = normalizeCorpName(companyName);
  if (!normalizedQuery) {
    return { status: "notFound", notices: ["회사명이 비어 있어 OpenDART 회사를 찾을 수 없습니다."] };
  }

  if (selectedCorpCode) {
    const selected = entries.find((entry) => entry.corpCode === selectedCorpCode);
    if (selected) {
      return {
        status: "resolved",
        match: {
          corpCode: selected.corpCode,
          corpName: selected.corpName,
          stockCode: selected.stockCode
        }
      };
    }
  }

  const exact = entries.filter((entry) => normalizeCorpName(entry.corpName) === normalizedQuery);
  if (exact.length === 1) {
    return {
      status: "resolved",
      match: exact[0]
    };
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      candidates: exact.slice(0, 8)
    };
  }

  const fuzzy = entries.filter((entry) => normalizeCorpName(entry.corpName).includes(normalizedQuery) || normalizedQuery.includes(normalizeCorpName(entry.corpName)));
  if (fuzzy.length === 1) {
    return {
      status: "resolved",
      match: fuzzy[0]
    };
  }
  if (fuzzy.length > 1) {
    return {
      status: "ambiguous",
      candidates: fuzzy.slice(0, 8)
    };
  }

  return {
    status: "notFound",
    notices: ["일치하는 OpenDART 회사를 찾지 못했습니다."]
  };
}

function normalizeCorpName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\(주\)|주식회사|corporation|corp\.?|inc\.?|ltd\.?/g, "")
    .trim();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  const stringValue = typeof value === "string" ? value.trim() : "";
  return stringValue || undefined;
}

function findAccountAmount(rows: Array<Record<string, unknown>>, accountNames: string[]): number | undefined {
  for (const row of rows) {
    const accountName = String(row.account_nm ?? "").replace(/\s+/g, "");
    const target = accountNames.find((name) => accountName === name.replace(/\s+/g, ""));
    if (!target) {
      continue;
    }

    const amount = parseNumericAmount(row.thstrm_amount ?? row.thstrm_add_amount);
    if (amount !== undefined) {
      return amount;
    }
  }
  return undefined;
}

function parseNumericAmount(value: unknown): number | undefined {
  const text = typeof value === "string" ? value : String(value ?? "");
  const cleaned = text.replace(/[^0-9-]/g, "");
  if (!cleaned) {
    return undefined;
  }
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
