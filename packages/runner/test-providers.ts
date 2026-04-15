import { execFile, spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const providers = ["claude", "codex", "gemini"] as const;

async function which(name: string): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile(cmd, [name], { timeout: 5_000 }, (error, stdout) => {
        if (error) { reject(error); return; }
        resolve(stdout.trim().split("\n")[0]);
      });
    });
  } catch { return null; }
}

async function runCmd(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), shell: false });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error("timeout")); }, 10_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? -1 }); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

async function testProvider(id: string) {
  console.log(`\n=== ${id.toUpperCase()} ===`);

  // 1. PATH 확인
  console.log(`  process.env.PATH includes npm global: ${(process.env.PATH ?? "").includes("Roaming\\npm")}`);

  // 2. which/where
  const loc = await which(id);
  console.log(`  which(${id}): ${loc ?? "NOT FOUND"}`);

  // 3. --version
  try {
    const ver = await runCmd(id, ["--version"]);
    console.log(`  ${id} --version: exit=${ver.exitCode} stdout="${ver.stdout.trim()}" stderr="${ver.stderr.trim().slice(0, 100)}"`);
  } catch (e) {
    console.log(`  ${id} --version: ERROR ${e instanceof Error ? e.message : e}`);
  }

  // 4. auth status
  try {
    if (id === "claude") {
      const r = await runCmd(id, ["auth", "status"]);
      console.log(`  claude auth status: exit=${r.exitCode} stdout=${r.stdout.trim().slice(0, 200)}`);
    } else if (id === "codex") {
      const r = await runCmd(id, ["login", "status"]);
      console.log(`  codex login status: exit=${r.exitCode} stdout="${r.stdout.trim()}"`);
    } else if (id === "gemini") {
      const oauthPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
      console.log(`  gemini oauth_creds.json exists: ${fs.existsSync(oauthPath)}`);
    }
  } catch (e) {
    console.log(`  auth check: ERROR ${e instanceof Error ? e.message : e}`);
  }

  // 5. Known paths check
  const home = os.homedir();
  const isWin = process.platform === "win32";
  const exe = isWin ? `${id}.exe` : id;
  const cmd = isWin ? `${id}.cmd` : id;
  const knownPaths = [
    path.join(home, ".local", "bin", exe),
    path.join(home, "AppData", "Roaming", "npm", cmd),
    path.join(home, "AppData", "Roaming", "npm", id),
    ...(isWin ? [path.join(process.env["LOCALAPPDATA"] ?? "", "Programs", id, exe)] : []),
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) console.log(`  EXISTS: ${p}`);
  }
}

async function main() {
  console.log("Platform:", process.platform);
  console.log("PATH:", process.env.PATH?.split(path.delimiter).join("\n      "));
  for (const id of providers) {
    await testProvider(id);
  }
}

main().catch(console.error);
