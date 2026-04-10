import * as fs from "node:fs/promises";
import * as path from "node:path";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const markdownFiles = await collectMarkdownFiles(repoRoot);
  const failures: string[] = [];
  let checkedLinks = 0;

  for (const filePath of markdownFiles) {
    const source = await fs.readFile(filePath, "utf8");
    for (const target of extractMarkdownLinks(source)) {
      const resolved = resolveLocalTarget(repoRoot, filePath, target);
      if (!resolved) {
        continue;
      }
      checkedLinks += 1;
      try {
        await fs.access(resolved);
      } catch {
        failures.push(`${relative(repoRoot, filePath)} -> ${target} (resolved to ${relative(repoRoot, resolved)})`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("Documentation link validation failed:\n");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${checkedLinks} local markdown link(s) across ${markdownFiles.length} file(s).`);
}

async function collectMarkdownFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = [];
  const explicitFiles = [
    "README.md",
    path.join(".github", "pull_request_template.md")
  ];

  for (const file of explicitFiles) {
    const resolved = path.join(repoRoot, file);
    if (await exists(resolved)) {
      files.push(resolved);
    }
  }

  for (const directory of [
    path.join(repoRoot, "docs", "development"),
    path.join(repoRoot, "docs", "plans")
  ]) {
    if (!(await exists(directory))) {
      continue;
    }
    await walkMarkdownFiles(directory, files);
  }

  return [...new Set(files)].sort();
}

async function walkMarkdownFiles(directory: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
}

function extractMarkdownLinks(source: string): string[] {
  const matches = source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  return [...matches].map((match) => match[1].trim()).filter(Boolean);
}

function resolveLocalTarget(repoRoot: string, fromFile: string, rawTarget: string): string | undefined {
  const target = stripAngleBrackets(rawTarget).split(/\s+/)[0];
  if (!target || target.startsWith("#")) {
    return undefined;
  }
  if (/^(?:https?:|mailto:|data:)/i.test(target)) {
    return undefined;
  }

  const [targetPath] = target.split("#", 1);
  if (!targetPath) {
    return undefined;
  }

  if (path.isAbsolute(targetPath)) {
    const resolvedAbsolute = resolveAbsoluteRepoPath(repoRoot, targetPath);
    if (resolvedAbsolute) {
      return resolvedAbsolute;
    }
    return targetPath;
  }

  if (targetPath.startsWith("/")) {
    return path.join(repoRoot, targetPath.slice(1));
  }

  return path.resolve(path.dirname(fromFile), targetPath);
}

function resolveAbsoluteRepoPath(repoRoot: string, absoluteTarget: string): string | undefined {
  if (absoluteTarget.startsWith(repoRoot)) {
    return absoluteTarget;
  }

  for (const marker of ["/docs/", "/packages/", "/scripts/", "/tools/", "/.github/"]) {
    const index = absoluteTarget.indexOf(marker);
    if (index >= 0) {
      return path.join(repoRoot, absoluteTarget.slice(index + 1));
    }
  }

  for (const singleton of ["/README.md", "/package.json", "/tsconfig.json", "/tsconfig.tools.json", "/.gitignore"]) {
    const index = absoluteTarget.indexOf(singleton);
    if (index >= 0) {
      return path.join(repoRoot, absoluteTarget.slice(index + 1));
    }
  }

  return undefined;
}

function stripAngleBrackets(value: string): string {
  return value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1).trim() : value;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function relative(repoRoot: string, targetPath: string): string {
  const relativePath = path.relative(repoRoot, targetPath);
  return relativePath || ".";
}

void main().catch((error) => {
  console.error(`validate-doc-links failed: ${String(error)}`);
  process.exitCode = 1;
});
