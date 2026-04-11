/**
 * logRedaction.test.ts
 *
 * Asserts the backend logger's pino redact config masks secrets that may
 * appear in RPC payloads. Operates on the exported `BACKEND_LOG_REDACT_PATHS`
 * array and a real pino instance — the same instance shape Fastify builds
 * from `app.ts`. We write to a captured stream so we can inspect the
 * serialized line and verify the secret is absent and the censor sentinel
 * is present.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { BACKEND_LOG_REDACT_PATHS } from "../app";

interface CapturedLine {
  readonly raw: string;
  readonly parsed: Record<string, unknown>;
}

function makeCapturedLogger(): {
  readonly logger: pino.Logger;
  readonly lines: readonly CapturedLine[];
} {
  const lines: CapturedLine[] = [];
  const stream = {
    write(chunk: string) {
      const trimmed = chunk.trim();
      if (trimmed.length === 0) return;
      lines.push({ raw: trimmed, parsed: JSON.parse(trimmed) as Record<string, unknown> });
    }
  };
  const logger = pino(
    {
      redact: {
        paths: [...BACKEND_LOG_REDACT_PATHS],
        censor: "[REDACTED]"
      }
    },
    stream
  );
  return { logger, lines };
}

describe("backend logger redaction", () => {
  it("masks save_provider_api_key payload.key", () => {
    const { logger, lines } = makeCapturedLogger();
    logger.info({ payload: { key: "sk-SUPER-SECRET-abc123" } }, "rpc:save_provider_api_key");
    assert.equal(lines.length, 1);
    const raw = lines[0]!.raw;
    assert.ok(!raw.includes("SUPER-SECRET"), `raw log should not include secret: ${raw}`);
    assert.ok(raw.includes("[REDACTED]"), `raw log should include censor: ${raw}`);
  });

  it("masks notion_connect payload.token", () => {
    const { logger, lines } = makeCapturedLogger();
    logger.info({ payload: { token: "secret_REAL-NOTION-TOKEN" } }, "rpc:notion_connect");
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.raw.includes("REAL-NOTION-TOKEN"));
    assert.ok(lines[0]!.raw.includes("[REDACTED]"));
  });

  it("masks opendart_save_key payload.apiKey", () => {
    const { logger, lines } = makeCapturedLogger();
    logger.info({ payload: { apiKey: "DART-KEY-raw" } }, "rpc:opendart_save_key");
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.raw.includes("DART-KEY-raw"));
    assert.ok(lines[0]!.raw.includes("[REDACTED]"));
  });

  it("masks session cookies in headers", () => {
    const { logger, lines } = makeCapturedLogger();
    logger.info({ req: { headers: { cookie: "jasojeon_session=TOPSECRETCOOKIE" } } }, "req");
    assert.equal(lines.length, 1);
    assert.ok(!lines[0]!.raw.includes("TOPSECRETCOOKIE"));
  });

  it("lets non-secret fields through unmodified", () => {
    const { logger, lines } = makeCapturedLogger();
    logger.info({ payload: { provider: "claude", slug: "alpha" } }, "rpc:ok");
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.raw.includes("\"provider\":\"claude\""));
    assert.ok(lines[0]!.raw.includes("\"slug\":\"alpha\""));
  });
});
