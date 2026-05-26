/**
 * runnerInstanceId.test.ts
 *
 * Tests for getOrCreateRunnerInstanceId:
 * - Creates and persists a UUID when the file doesn't exist.
 * - Returns the same value on subsequent calls (idempotent).
 * - Reads the value correctly when the file already exists.
 */
import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { getOrCreateRunnerInstanceId } from "../hosted/runnerInstanceId";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-rid-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("runnerInstanceId: creates UUID file when missing", async () => {
  await withTempDir(async (dir) => {
    const idFile = path.join(dir, "instance-id");
    const result = await getOrCreateRunnerInstanceId(idFile);

    assert.match(
      result,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "Should be a valid v4 UUID"
    );

    const stored = (await fs.readFile(idFile, "utf8")).trim();
    assert.equal(stored, result, "Written file should match returned value");
  });
});

test("runnerInstanceId: returns same UUID on second call (idempotent)", async () => {
  await withTempDir(async (dir) => {
    const idFile = path.join(dir, "instance-id");
    const first = await getOrCreateRunnerInstanceId(idFile);
    const second = await getOrCreateRunnerInstanceId(idFile);
    assert.equal(first, second, "Second call must return the same UUID");
  });
});

test("runnerInstanceId: reads existing UUID without overwriting", async () => {
  await withTempDir(async (dir) => {
    const idFile = path.join(dir, "instance-id");
    const preset = crypto.randomUUID();
    await fs.writeFile(idFile, preset + "\n", "utf8");

    const result = await getOrCreateRunnerInstanceId(idFile);
    assert.equal(result, preset, "Must return the pre-existing UUID");

    const stored = (await fs.readFile(idFile, "utf8")).trim();
    assert.equal(stored, preset, "File must not be overwritten");
  });
});

test("runnerInstanceId: creates parent directory if missing", async () => {
  await withTempDir(async (dir) => {
    const nestedDir = path.join(dir, "nested", ".jasojeon");
    const idFile = path.join(nestedDir, "instance-id");

    const result = await getOrCreateRunnerInstanceId(idFile);
    assert.match(
      result,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const exists = await fs.stat(idFile).then(() => true).catch(() => false);
    assert.ok(exists, "File should have been created in the nested directory");
  });
});
