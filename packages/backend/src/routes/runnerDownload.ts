import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";

// dev: localhost에 연결되는 _local 바이너리, prod: 실서버에 연결되는 바이너리
const FILE_MAP: Readonly<Record<string, string>> = {
  windows: "jasojeon-runner-windows.exe",
  "mac-arm64": "jasojeon-runner-mac-arm64",
  "mac-x64": "jasojeon-runner-mac-x64",
  linux: "jasojeon-runner-linux",
};

const LOCAL_FILE_MAP: Readonly<Record<string, string>> = {
  windows: "jasojeon-runner-windows-local.exe",
  "mac-arm64": "jasojeon-runner-mac-arm64-local",
  "mac-x64": "jasojeon-runner-mac-x64-local",
  linux: "jasojeon-runner-linux-local",
};

// packages/backend/src/routes/ → packages/runner/dist-bin/
const BIN_DIR = path.resolve(__dirname, "../../../runner/dist-bin");

export function registerRunnerDownload(app: FastifyInstance): void {
  app.get("/api/runner/download", async (request, reply) => {
    const { os } = request.query as { os?: string };

    if (!os || !(os in FILE_MAP)) {
      return reply.code(400).send({
        error: "invalid_os",
        message: `os must be one of: ${Object.keys(FILE_MAP).join(", ")}`,
      });
    }

    const isDev = process.env["NODE_ENV"] !== "production";
    const map = isDev ? LOCAL_FILE_MAP : FILE_MAP;
    const filename = map[os] as string;
    const filePath = path.join(BIN_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({
        error: "binary_not_found",
        message: isDev
          ? `로컬 바이너리가 없습니다. packages/runner 에서 'bun run build.ts --local' 을 실행하세요.`
          : `서버 바이너리가 없습니다. packages/runner 에서 'bun run build.ts' 를 실행하고 배포하세요.`,
      });
    }

    const stat = fs.statSync(filePath);
    const contentType =
      os === "windows"
        ? "application/vnd.microsoft.portable-executable"
        : "application/octet-stream";

    return reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Content-Type", contentType)
      .header("Content-Length", stat.size)
      .send(fs.createReadStream(filePath));
  });
}
