import * as assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "../logging/redact";

test("redactSecrets — primitive passthrough", () => {
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  assert.equal(redactSecrets(42), 42);
  assert.equal(redactSecrets(true), true);
  assert.equal(redactSecrets("hello world"), "hello world");
});

test("redactSecrets — OpenAI style sk- key in string", () => {
  const input = "key=sk-ABCDEFGHIJKLMNOP_extra-tail";
  const out = redactSecrets(input);
  assert.equal(out, "key=[REDACTED]");
});

test("redactSecrets — GitHub PAT ghp_ key in string", () => {
  const input = "token=ghp_abcdefghijklmnopqrstuvwx";
  const out = redactSecrets(input);
  assert.equal(out, "token=[REDACTED]");
});

test("redactSecrets — Google API key AIza in string", () => {
  const input = "url?key=AIzaSyA-abcdefghijklmnopqrstuv";
  const out = redactSecrets(input);
  assert.equal(out, "url?key=[REDACTED]");
});

test("redactSecrets — Slack bot token xoxb in string", () => {
  const input = "auth=xoxb-1234-5678-abcdefg";
  const out = redactSecrets(input);
  assert.equal(out, "auth=[REDACTED]");
});

test("redactSecrets — Bearer authorization header in string", () => {
  const input = "Authorization: Bearer abcdef1234567890abcdef";
  const out = redactSecrets(input);
  assert.equal(out, "Authorization: [REDACTED]");
});

test("redactSecrets — nested objects redact values", () => {
  const input = {
    user: "alice",
    meta: { note: "sk-ABCDEFGHIJKLMNOP1234567890" },
  };
  const out = redactSecrets(input) as { user: string; meta: { note: string } };
  assert.equal(out.user, "alice");
  assert.equal(out.meta.note, "[REDACTED]");
});

test("redactSecrets — arrays are recursed", () => {
  const input = ["ghp_abcdefghijklmnopqrstuvwx", "safe"];
  const out = redactSecrets(input) as readonly string[];
  assert.equal(out[0], "[REDACTED]");
  assert.equal(out[1], "safe");
});

test("redactSecrets — sensitive keys always redacted regardless of value", () => {
  const input = {
    token: "innocent-looking-string",
    apiKey: "x",
    api_key: "y",
    Authorization: "whatever",
    password: "hunter2",
    secret: 42,
    cookie: "sid=abc",
    normal: "visible",
  };
  const out = redactSecrets(input) as Record<string, unknown>;
  assert.equal(out["token"], "[REDACTED]");
  assert.equal(out["apiKey"], "[REDACTED]");
  assert.equal(out["api_key"], "[REDACTED]");
  assert.equal(out["Authorization"], "[REDACTED]");
  assert.equal(out["password"], "[REDACTED]");
  assert.equal(out["secret"], "[REDACTED]");
  assert.equal(out["cookie"], "[REDACTED]");
  assert.equal(out["normal"], "visible");
});

test("redactSecrets — circular refs handled without stack overflow", () => {
  const input: Record<string, unknown> = { a: 1 };
  input["self"] = input;
  const out = redactSecrets(input) as Record<string, unknown>;
  assert.equal(out["a"], 1);
  assert.equal(out["self"], "[Circular]");
});

test("redactSecrets — input is not mutated", () => {
  const input = { token: "visible-in-input", note: "sk-ABCDEFGHIJKLMNOP12345" };
  redactSecrets(input);
  assert.equal(input.token, "visible-in-input");
  assert.equal(input.note, "sk-ABCDEFGHIJKLMNOP12345");
});

test("redactSecrets — Error objects preserve name/message with redaction", () => {
  const err = new Error("failed with sk-ABCDEFGHIJKLMNOP1234567890 in payload");
  const out = redactSecrets(err) as { name: string; message: string };
  assert.equal(out.name, "Error");
  assert.equal(out.message, "failed with [REDACTED] in payload");
});
