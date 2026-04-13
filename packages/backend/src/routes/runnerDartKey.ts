/**
 * runnerDartKey.ts
 *
 * GET /api/runner/dart-key
 *
 * runner 전용 엔드포인트. deviceToken 으로 인증한 runner 에게만
 * 서버 env 의 DART_API_KEY 를 반환한다. 일반 브라우저 세션으로는
 * 접근 불가.
 *
 * 인증: Authorization: Bearer <deviceToken>
 * 응답: { key: string }
 */

import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Env } from "../env";

export interface RunnerDartKeyDeviceStore {
  /** 토큰 해시로 비폐기 device id 조회. 없으면 undefined. */
  findDeviceIdByTokenHash(tokenHash: string): Promise<string | undefined>;
}

export interface RunnerDartKeyDeps {
  readonly deviceStore: RunnerDartKeyDeviceStore;
  readonly env: Pick<Env, "DART_API_KEY">;
}

export function registerRunnerDartKey(
  app: FastifyInstance,
  deps: RunnerDartKeyDeps
): void {
  app.get("/api/runner/dart-key", async (request, reply) => {
    const authHeader = request.headers["authorization"];
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const deviceToken = authHeader.slice("Bearer ".length).trim();
    if (!deviceToken) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const tokenHash = crypto.createHash("sha256").update(deviceToken).digest("hex");

    let deviceId: string | undefined;
    try {
      deviceId = await deps.deviceStore.findDeviceIdByTokenHash(tokenHash);
    } catch (err) {
      request.log.error({ err }, "[runnerDartKey] db lookup failed");
      return reply.code(500).send({ error: "internal_error" });
    }

    if (!deviceId) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    return reply.code(200).send({ key: deps.env.DART_API_KEY });
  });
}
