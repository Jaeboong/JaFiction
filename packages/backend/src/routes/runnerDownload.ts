import type { FastifyInstance } from "fastify";

const DEFAULT_BASE_URL =
  "https://github.com/Jaeboong/jasojeon/releases/latest/download";

const FILE_MAP: Readonly<Record<string, string>> = {
  windows: "jasojeon-runner-windows.exe",
  "mac-arm64": "jasojeon-runner-mac-arm64",
  "mac-x64": "jasojeon-runner-mac-x64",
  linux: "jasojeon-runner-linux",
};

// 로컬 dev 환경에서는 localhost에 붙는 _local 바이너리를 제공.
const LOCAL_FILE_MAP: Readonly<Record<string, string>> = {
  windows: "jasojeon-runner-windows-local.exe",
  "mac-arm64": "jasojeon-runner-mac-arm64-local",
  "mac-x64": "jasojeon-runner-mac-x64-local",
  linux: "jasojeon-runner-linux-local",
};

export function registerRunnerDownload(app: FastifyInstance): void {
  app.get("/api/runner/download", async (request, reply) => {
    const { os } = request.query as { os?: string };

    if (!os || !(os in FILE_MAP)) {
      return reply.code(400).send({
        error: "invalid_os",
        message: `os must be one of: ${Object.keys(FILE_MAP).join(", ")}`,
      });
    }

    const isLocal = process.env["NODE_ENV"] !== "production";
    const map = isLocal ? LOCAL_FILE_MAP : FILE_MAP;
    const baseUrl = process.env["RUNNER_DOWNLOAD_BASE_URL"] ?? DEFAULT_BASE_URL;
    const filename = map[os];
    const url = `${baseUrl}/${filename}`;

    return reply.redirect(302, url);
  });
}
