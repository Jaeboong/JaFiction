import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const OUTDIR = path.join(__dirname, "dist-bin");

interface BuildTarget {
  readonly target: string;
  readonly outfile: string;
}

const isLocal = process.argv.includes("--local");
const suffix = isLocal ? "-local" : "";
const BACKEND_URL = isLocal
  ? "http://localhost:4000"
  : "https://xn--9l4b13i8j.com";

const TARGETS: readonly BuildTarget[] = [
  { target: "bun-windows-x64", outfile: path.join(OUTDIR, `jasojeon-runner-windows${suffix}.exe`) },
  { target: "bun-darwin-arm64", outfile: path.join(OUTDIR, `jasojeon-runner-mac-arm64${suffix}`) },
  { target: "bun-darwin-x64", outfile: path.join(OUTDIR, `jasojeon-runner-mac-x64${suffix}`) },
  { target: "bun-linux-x64", outfile: path.join(OUTDIR, `jasojeon-runner-linux${suffix}`) },
];

const ENTRYPOINT = path.join(__dirname, "src", "cli.ts");

fs.mkdirSync(OUTDIR, { recursive: true });

console.log(`Mode: ${isLocal ? "local (localhost:4000)" : "production (xn--9l4b13i8j.com)"}`);

for (const { target, outfile } of TARGETS) {
  console.log(`Building ${target} → ${outfile}`);
  try {
    execSync(
      `bun build --compile --target=${target} --outfile="${outfile}" --define="process.env.JASOJEON_DEFAULT_BACKEND_URL='${BACKEND_URL}'" "${ENTRYPOINT}"`,
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
