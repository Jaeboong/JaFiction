import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";

/**
 * 시스템에서 CLI 바이너리 경로를 찾는다.
 * Windows: where, Unix: which
 */
export async function resolveCommand(name: string): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "where" : "which";

  try {
    const allLines = await new Promise<string[]>((resolve, reject) => {
      execFile(cmd, [name], { timeout: 5_000 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean));
      });
    });

    // Windows에서 `where` 결과에는 확장자 없는 bash 스크립트도 포함됨.
    // 실행 가능한 파일 우선순위: .exe > .cmd/.bat > 나머지
    const candidates = isWindows
      ? [
          ...allLines.filter((l) => l.toLowerCase().endsWith(".exe")),
          ...allLines.filter((l) => l.toLowerCase().endsWith(".cmd") || l.toLowerCase().endsWith(".bat")),
          ...allLines.filter((l) => !/\.(exe|cmd|bat|ps1)$/i.test(l)),
        ]
      : allLines;

    const result = candidates[0];

    // 경로가 실제로 존재하는지 확인
    if (result && fs.existsSync(result)) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/** npm 글로벌 패키지를 설치하고 CLI 바이너리 경로를 반환한다. */
export async function installGlobalPackage(
  packageName: string,
  commandName: string,
  npmPath?: string
): Promise<string> {
  const npm = npmPath ?? await resolveCommand("npm");
  if (!npm) {
    throw new Error("npm이 설치되어 있지 않습니다. Node.js를 먼저 설치해주세요.");
  }

  // .cmd/.bat 파일은 cmd.exe /c 로 실행 (공백 포함 경로 처리)
  const isCmd = npm.toLowerCase().endsWith(".cmd") || npm.toLowerCase().endsWith(".bat");
  const installArgs = isCmd
    ? ["cmd", ["/c", npm, "install", "-g", packageName]] as const
    : [npm, ["install", "-g", packageName]] as const;

  await new Promise<void>((resolve, reject) => {
    execFile(installArgs[0], [...installArgs[1]], { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${packageName} 설치 실패: ${stderr || error.message}`));
        return;
      }
      resolve();
    });
  });

  // 설치 후 커맨드 경로 재확인
  const bin = await resolveCommand(commandName);
  if (!bin) {
    throw new Error(`${packageName} 설치 후에도 ${commandName} 명령어를 찾을 수 없습니다.`);
  }
  return bin;
}

/** CLI 패키지 이름 매핑 */
export const CLI_PACKAGES: Record<string, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
};

/** 플랫폼별 Jasojeon 데이터 디렉토리 반환 */
export function getJasojeonDataDir(): string {
  const platform = process.platform;
  if (platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "jasojeon");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "jasojeon");
  }
  // Linux and others
  return path.join(os.homedir(), ".local", "share", "jasojeon");
}

/** 포터블 Node.js 설치 디렉토리 반환 */
export function getPortableNodeDir(): string {
  return path.join(getJasojeonDataDir(), "node");
}

/**
 * 포터블 Node.js가 이미 설치되어 있으면 npm 절대경로 반환, 없으면 null.
 */
export function getPortableNpmPath(): string | null {
  const nodeDir = getPortableNodeDir();
  const npmPath = process.platform === "win32"
    ? path.join(nodeDir, "npm.cmd")
    : path.join(nodeDir, "bin", "npm");
  return fs.existsSync(npmPath) ? npmPath : null;
}

/** https.get을 따라가며 파일을 다운로드한다 (리다이렉트 지원). */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const attempt = (currentUrl: string, redirectCount: number): void => {
      if (redirectCount > 10) {
        reject(new Error("리다이렉트가 너무 많습니다."));
        return;
      }
      https.get(currentUrl, (res) => {
        if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          attempt(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`다운로드 실패: HTTP ${res.statusCode ?? "unknown"}`));
          return;
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      }).on("error", reject);
    };
    attempt(url, 0);
  });
}

/** spawn을 Promise로 래핑하여 실행한다. */
function spawnAsync(
  cmd: string,
  args: readonly string[],
  options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args as string[], { shell: false });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeout !== undefined) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`명령어 타임아웃: ${cmd}`));
      }, options.timeout);
    }

    proc.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`명령어 실패 (종료 코드 ${code ?? "unknown"}): ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    proc.on("error", (err) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Node.js 포터블을 다운로드하여 압축 해제한다.
 * npm 절대경로를 반환한다.
 */
export async function downloadPortableNodeJs(
  onProgress?: (msg: string) => void
): Promise<string> {
  // 이미 설치되어 있으면 바로 반환
  const existing = getPortableNpmPath();
  if (existing !== null) return existing;

  const NODE_VERSION = "v22.16.0";
  const platform = process.platform;
  const arch = process.arch;

  let archiveName: string;
  let extractExt: "zip" | "tar.gz" | "tar.xz";

  if (platform === "win32") {
    archiveName = `node-${NODE_VERSION}-win-x64.zip`;
    extractExt = "zip";
  } else if (platform === "darwin") {
    const archStr = arch === "arm64" ? "arm64" : "x64";
    archiveName = `node-${NODE_VERSION}-darwin-${archStr}.tar.gz`;
    extractExt = "tar.gz";
  } else {
    // Linux and others
    const archStr = arch === "arm64" ? "arm64" : "x64";
    archiveName = `node-${NODE_VERSION}-linux-${archStr}.tar.xz`;
    extractExt = "tar.xz";
  }

  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}`;
  const targetDir = getPortableNodeDir();
  const tmpDir = os.tmpdir();
  const archivePath = path.join(tmpDir, archiveName);

  fs.mkdirSync(targetDir, { recursive: true });

  onProgress?.("Node.js 다운로드 중...");
  await downloadFile(url, archivePath);

  onProgress?.("Node.js 설치 중...");
  if (extractExt === "zip") {
    // Expand-Archive는 strip-components를 지원하지 않으므로
    // 임시 디렉토리에 풀고 내부 디렉토리를 targetDir로 이동
    const tmpExtract = path.join(tmpDir, `node-extract-${Date.now()}`);
    fs.mkdirSync(tmpExtract, { recursive: true });
    await spawnAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${tmpExtract}"`,
    ], { timeout: 120_000 });
    // zip 안에 node-v22.16.0-win-x64/ 폴더가 있으므로 해당 내용을 targetDir로 이동
    const innerDirs = fs.readdirSync(tmpExtract);
    const innerDir = innerDirs.find((d) => d.startsWith("node-")) ?? innerDirs[0];
    if (innerDir) {
      const src = path.join(tmpExtract, innerDir);
      // targetDir 내용을 src에서 복사
      await spawnAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Copy-Item -Path "${src}\\*" -Destination "${targetDir}" -Recurse -Force`,
      ], { timeout: 30_000 });
    }
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { /* ignore */ }
  } else {
    await spawnAsync("tar", ["xf", archivePath, "-C", targetDir, "--strip-components=1"], {
      timeout: 120_000,
    });
  }

  // 아카이브 삭제
  try {
    fs.unlinkSync(archivePath);
  } catch {
    // 삭제 실패는 무시 (임시 파일이므로)
  }

  const npmPath = getPortableNpmPath();
  if (npmPath === null) {
    throw new Error("Node.js 설치 후에도 npm을 찾을 수 없습니다.");
  }
  return npmPath;
}

/** Claude CLI가 설치될 수 있는 알려진 경로 목록 */
function getKnownClaudeCliPaths(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    return [
      path.join(localAppData, "Programs", "claude", "claude.exe"),
      path.join(home, ".claude", "local", "bin", "claude.exe"),
    ];
  }
  return [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "bin", "claude"),
  ];
}

/**
 * Claude Code CLI 설치 스크립트를 실행한다.
 * 설치 후 PATH에 바이너리 디렉토리를 추가한다.
 */
export async function installClaudeCli(onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.("Claude Code CLI 설치 중...");

  const platform = process.platform;
  if (platform === "win32") {
    await spawnAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"],
      { timeout: 120_000 }
    );
  } else {
    await spawnAsync(
      "bash",
      ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      { timeout: 120_000 }
    );
  }

  // 설치 후 알려진 경로에서 바이너리를 찾아 PATH에 추가
  for (const binPath of getKnownClaudeCliPaths()) {
    if (fs.existsSync(binPath)) {
      const binDir = path.dirname(binPath);
      const currentPath = process.env["PATH"] ?? "";
      if (!currentPath.split(path.delimiter).includes(binDir)) {
        process.env["PATH"] = `${binDir}${path.delimiter}${currentPath}`;
      }
      return;
    }
  }
}

/**
 * npm 바이너리 경로를 확인하고, 없으면 포터블 Node.js를 설치한다.
 */
export async function ensureNpm(onProgress?: (msg: string) => void): Promise<string> {
  // 1. 시스템 npm 확인
  const systemNpm = await resolveCommand("npm");
  if (systemNpm) return systemNpm;

  // 2. 포터블 npm 확인
  const portableNpm = getPortableNpmPath();
  if (portableNpm) return portableNpm;

  // 3. 포터블 Node.js 다운로드
  return downloadPortableNodeJs(onProgress);
}

async function verifyCliWorks(binPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isCmd = binPath.toLowerCase().endsWith(".cmd") || binPath.toLowerCase().endsWith(".bat");
    const [cmd, args] = isCmd
      ? ["cmd", ["/c", binPath, "--version"]] as const
      : [binPath, ["--version"]] as const;
    execFile(cmd, [...args], { timeout: 5_000 }, (error) => {
      resolve(error === null);
    });
  });
}

/**
 * 프로바이더 CLI를 확인하고, 없으면 설치한다.
 */
export async function ensureProviderCli(
  providerId: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const commandName = providerId === "claude" ? "claude" : providerId;
  const existing = await resolveCommand(commandName);
  if (existing) {
    const works = await verifyCliWorks(existing);
    if (works) return;
  }

  switch (providerId) {
    case "claude":
      onProgress?.("Claude Code CLI 설치 중...");
      await installClaudeCli(onProgress);
      break;
    case "codex": {
      const npm = await ensureNpm(onProgress);
      onProgress?.("Codex CLI 설치 중...");
      await installGlobalPackage("@openai/codex", "codex", npm);
      break;
    }
    case "gemini": {
      const npm = await ensureNpm(onProgress);
      onProgress?.("Gemini CLI 설치 중...");
      await installGlobalPackage("@google/gemini-cli", "gemini", npm);
      break;
    }
    default:
      throw new Error(`지원하지 않는 프로바이더: ${providerId}`);
  }
}
