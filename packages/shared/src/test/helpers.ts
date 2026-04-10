import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { ForJobStorage } from "../core/storage";

export async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "forjob-"));
}

export async function createStorage(workspaceRoot: string): Promise<ForJobStorage> {
  const storage = new ForJobStorage(workspaceRoot, ".forjob");
  await storage.ensureInitialized();
  return storage;
}

export async function cleanupTempWorkspace(workspaceRoot: string): Promise<void> {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}

export async function writeTextFile(workspaceRoot: string, fileName: string, content: string): Promise<string> {
  const filePath = path.join(workspaceRoot, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

export async function writePngPlaceholder(workspaceRoot: string, fileName = "image.png"): Promise<string> {
  const filePath = path.join(workspaceRoot, fileName);
  await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), "binary");
  return filePath;
}

export async function writeMinimalPdf(workspaceRoot: string, fileName: string, text: string): Promise<string> {
  const filePath = path.join(workspaceRoot, fileName);
  const PDFDocument = require("pdfkit");

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36 });
    const stream = doc.pipe(require("node:fs").createWriteStream(filePath));
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.text(text);
    doc.end();
  });
  return filePath;
}

export async function writeMinimalPptx(workspaceRoot: string, fileName: string, slides: string[]): Promise<string> {
  const zip = new JSZip();
  slides.forEach((slideText, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  });
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const filePath = path.join(workspaceRoot, fileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function assertTextContains(filePath: string, expected: string): Promise<void> {
  const text = await fs.readFile(filePath, "utf8");
  assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
