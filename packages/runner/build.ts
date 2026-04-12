import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const OUTDIR = path.join(__dirname, "dist-bin");

interface BuildTarget {
  readonly target: string;
  readonly outfile: string;
}

const TARGETS: readonly BuildTarget[] = [
  { target: "bun-windows-x64", outfile: path.join(OUTDIR, "jasojeon-runner-windows.exe") },
  { target: "bun-darwin-arm64", outfile: path.join(OUTDIR, "jasojeon-runner-mac-arm64") },
  { target: "bun-darwin-x64", outfile: path.join(OUTDIR, "jasojeon-runner-mac-x64") },
  { target: "bun-linux-x64", outfile: path.join(OUTDIR, "jasojeon-runner-linux") },
];

const ENTRYPOINT = path.join(__dirname, "src", "cli.ts");

fs.mkdirSync(OUTDIR, { recursive: true });

for (const { target, outfile } of TARGETS) {
  console.log(`Building ${target} → ${outfile}`);
  try {
    execSync(
      `bun build --compile --target=${target} --outfile="${outfile}" "${ENTRYPOINT}"`,
      { stdio: "inherit", cwd: __dirname }
    );
    console.log(`  OK: ${path.basename(outfile)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log("\nAll binaries built successfully.");
