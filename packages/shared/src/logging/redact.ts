/**
 * redact.ts
 *
 * Pure helper that deep-clones a value and replaces secrets with
 * `"[REDACTED]"`. Handles strings, objects, arrays, and circular refs.
 *
 * Patterns matched in string values:
 *  - OpenAI/Anthropic style keys:  sk-[A-Za-z0-9_-]{16,}
 *  - GitHub PAT:                    ghp_[A-Za-z0-9]{20,}
 *  - Google API key:                AIza[A-Za-z0-9_-]{20,}
 *  - Slack bot token:               xoxb-[A-Za-z0-9-]+
 *  - Authorization bearer:          Bearer\s+[A-Za-z0-9_.+/=-]{10,}
 *
 * Sensitive object keys (case-insensitive) are replaced regardless of value:
 *   token, api_key, apiKey, authorization, password, secret, cookie
 *
 * Redaction format: `"[REDACTED]"`. This is intentionally coarse — the goal
 * is log safety, not reversible masking.
 */

const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /xoxb-[A-Za-z0-9-]+/g,
  /Bearer\s+[A-Za-z0-9_.+/=-]{10,}/gi,
];

const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "token",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "secret",
  "cookie",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  // Circular reference guard.
  if (seen.has(value as object)) {
    return "[Circular]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  // Handle Error objects (preserve message/stack but redact contents).
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  // Plain object / record.
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactValue(val, seen);
  }
  return out;
}

/**
 * Deep-clone `input` and replace any secret-looking values with `"[REDACTED]"`.
 * Pure function: no I/O, no mutation of `input`.
 */
export function redactSecrets(input: unknown): unknown {
  return redactValue(input, new WeakSet<object>());
}
