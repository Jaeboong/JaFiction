import "./pdfjsPolyfills";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ExtractionStatus, SourceType } from "./types";

export interface ExtractionResult {
  extractionStatus: ExtractionStatus;
  content?: string;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const plainTextExtensions = new Set([".txt", ".md", ".markdown", ".text"]);

export function inferSourceType(filePath: string): SourceType {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    return "pdf";
  }

  if (extension === ".pptx") {
    return "pptx";
  }

  if (imageExtensions.has(extension)) {
    return "image";
  }

  if (plainTextExtensions.has(extension)) {
    return extension === ".md" || extension === ".markdown" ? "md" : "txt";
  }

  return "other";
}

export class ContextExtractor {
  async extract(filePath: string, sourceType: SourceType): Promise<ExtractionResult> {
    if (sourceType === "image" || sourceType === "other") {
      return { extractionStatus: "rawOnly" };
    }

    if (sourceType === "text" || sourceType === "txt" || sourceType === "md") {
      const content = await fs.readFile(filePath, "utf8");
      return { extractionStatus: "normalized", content: normalizeText(content) };
    }

    if (sourceType === "pdf") {
      const buffer = await fs.readFile(filePath);
      const content = await extractPdfWithPdfJs(buffer);
      return { extractionStatus: "normalized", content: normalizeText(content) };
    }

    if (sourceType === "pptx") {
      const buffer = await fs.readFile(filePath);
      const zip = await JSZip.loadAsync(buffer);
      const parser = new XMLParser({ ignoreAttributes: false });
      const slideNames = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

      const slides: string[] = [];
      for (const slideName of slideNames) {
        const slideText = await zip.file(slideName)?.async("string");
        if (!slideText) {
          continue;
        }

        const parsed = parser.parse(slideText);
        const collected: string[] = [];
        collectTextNodes(parsed, collected);
        if (collected.length > 0) {
          slides.push(collected.join(" ").trim());
        }
      }

      return { extractionStatus: "normalized", content: normalizeText(slides.join("\n\n")) };
    }

    return { extractionStatus: "rawOnly" };
  }
}

function collectTextNodes(node: unknown, bucket: string[]): void {
  if (typeof node === "string") {
    const value = node.trim();
    if (value) {
      bucket.push(value);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectTextNodes(item, bucket);
    }
    return;
  }

  if (!node || typeof node !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "a:t" || key === "t" || key.endsWith(":t")) {
      collectTextNodes(value, bucket);
      continue;
    }

    collectTextNodes(value, bucket);
  }
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfWithPdfJs(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const textItems = (content.items as Array<{ str?: string }>).map((item) => item.str?.trim()).filter(Boolean);
    pages.push(textItems.join(" "));
  }
  return pages.join("\n\n");
}
