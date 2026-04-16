import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { createFileRpc, FileRpc } from "../hosted/fileRpc";

const IS_WIN = process.platform === "win32";

interface Fixture {
  root: string;
  rpc: FileRpc;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-filerpc-"));
  // Realpath the root up front — on macOS `/var/folders/...` is a symlink
  // to `/private/var/...`, and the rpc internally realpaths root, so tests
  // must compare against the real one.
  const real = await fs.realpath(root);
  const rpc = createFileRpc({ workspaceRoot: real });
  return {
    root: real,
    rpc,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

async function assertInvalidInput(promise: Promise<unknown>, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`${label}: expected invalid_input error`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    assert.equal(code, "invalid_input", `${label}: got code=${String(code)}`);
  }
}

async function assertNotFound(promise: Promise<unknown>, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`${label}: expected not_found error`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    assert.equal(code, "not_found", `${label}: got code=${String(code)}`);
  }
}

// ---------------------------------------------------------------------------
// Traversal rejections
// ---------------------------------------------------------------------------
test("fileRpc: rejects parent traversal", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.readFile({ path: "../etc/passwd" }),
      "readFile ../etc/passwd"
    );
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: rejects absolute path outside root", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.readFile({ path: "/etc/passwd" }),
      "readFile /etc/passwd"
    );
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: rejects nested traversal foo/../../etc/passwd", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.readFile({ path: "foo/../../etc/passwd" }),
      "readFile nested traversal"
    );
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: rejects null byte in path", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.readFile({ path: "foo\u0000bar" }),
      "readFile null byte"
    );
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: rejects empty path", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.readFile({ path: "" }),
      "readFile empty string"
    );
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Symlink escape
// ---------------------------------------------------------------------------
test("fileRpc: rejects read via symlink escaping the root", { skip: IS_WIN ? "Windows에서 symlink 생성에 관리자 권한 또는 Developer Mode가 필요하여 EPERM 발생" : false }, async () => {
  const f = await makeFixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-outside-"));
  try {
    const outsideReal = await fs.realpath(outside);
    await fs.writeFile(path.join(outsideReal, "secret.txt"), "top-secret");
    await fs.symlink(outsideReal, path.join(f.root, "escape"));

    await assertInvalidInput(
      f.rpc.readFile({ path: "escape/secret.txt" }),
      "readFile via escape symlink"
    );
  } finally {
    await f.cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("fileRpc: rejects write into symlinked-out directory", { skip: IS_WIN ? "Windows에서 symlink 생성에 관리자 권한 또는 Developer Mode가 필요하여 EPERM 발생" : false }, async () => {
  const f = await makeFixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-outside-"));
  try {
    const outsideReal = await fs.realpath(outside);
    await fs.symlink(outsideReal, path.join(f.root, "escape"));

    await assertInvalidInput(
      f.rpc.writeFile({ path: "escape/new.txt", contentBase64: Buffer.from("x").toString("base64") }),
      "writeFile via escape symlink"
    );
  } finally {
    await f.cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Happy-path read/write/list inside root
// ---------------------------------------------------------------------------
test("fileRpc: round-trips write and read inside root", async () => {
  const f = await makeFixture();
  try {
    const payload = "hello world";
    const res = await f.rpc.writeFile({
      path: "hello.txt",
      contentBase64: Buffer.from(payload).toString("base64")
    });
    assert.equal(res.ok, true);
    assert.equal(res.bytes, Buffer.byteLength(payload));

    const read = await f.rpc.readFile({ path: "hello.txt" });
    assert.equal(Buffer.from(read.contentBase64, "base64").toString(), payload);
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: write to non-existent nested path creates intermediate dirs", async () => {
  const f = await makeFixture();
  try {
    const payload = "deep";
    const res = await f.rpc.writeFile({
      path: "a/b/c/deep.txt",
      contentBase64: Buffer.from(payload).toString("base64")
    });
    assert.equal(res.ok, true);

    const read = await f.rpc.readFile({ path: "a/b/c/deep.txt" });
    assert.equal(Buffer.from(read.contentBase64, "base64").toString(), payload);

    // Verify it actually lives inside the root on disk.
    const stat = await fs.stat(path.join(f.root, "a", "b", "c", "deep.txt"));
    assert.ok(stat.isFile());
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: read non-existent path returns not_found", async () => {
  const f = await makeFixture();
  try {
    await assertNotFound(f.rpc.readFile({ path: "does-not-exist.txt" }), "readFile missing");
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: listWorkspaceFiles returns top-level entries", async () => {
  const f = await makeFixture();
  try {
    await f.rpc.writeFile({ path: "a.txt", contentBase64: Buffer.from("a").toString("base64") });
    await f.rpc.writeFile({ path: "sub/b.txt", contentBase64: Buffer.from("bb").toString("base64") });

    const res = await f.rpc.listWorkspaceFiles({});
    const names = res.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["a.txt", "sub"]);

    const aEntry = res.entries.find((e) => e.name === "a.txt");
    assert.ok(aEntry);
    assert.equal(aEntry?.isDirectory, false);
    assert.equal(aEntry?.sizeBytes, 1);

    const subEntry = res.entries.find((e) => e.name === "sub");
    assert.equal(subEntry?.isDirectory, true);
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: listWorkspaceFiles rejects subdir escape", async () => {
  const f = await makeFixture();
  try {
    await assertInvalidInput(
      f.rpc.listWorkspaceFiles({ subdir: "../" }),
      "list ../"
    );
  } finally {
    await f.cleanup();
  }
});

test("fileRpc: listWorkspaceFiles on subdir lists its entries", async () => {
  const f = await makeFixture();
  try {
    await f.rpc.writeFile({ path: "sub/x.txt", contentBase64: Buffer.from("xx").toString("base64") });
    const res = await f.rpc.listWorkspaceFiles({ subdir: "sub" });
    assert.equal(res.entries.length, 1);
    assert.equal(res.entries[0]?.name, "x.txt");
    assert.equal(res.entries[0]?.path, path.join("sub", "x.txt"));
  } finally {
    await f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case sensitivity: behavior is host-FS-dependent. We document and assert
// that the rpc does not invent its own case mapping — it defers to the FS.
// On Linux (case-sensitive): "FOO.txt" and "foo.txt" are different files.
// On macOS/Windows (case-insensitive): the FS may treat them as the same.
// ---------------------------------------------------------------------------
test("fileRpc: case sensitivity matches host filesystem", async () => {
  const f = await makeFixture();
  try {
    await f.rpc.writeFile({
      path: "Case.txt",
      contentBase64: Buffer.from("A").toString("base64")
    });
    // Reading by exact case always works.
    const exact = await f.rpc.readFile({ path: "Case.txt" });
    assert.equal(Buffer.from(exact.contentBase64, "base64").toString(), "A");

    // Reading by wrong case: either succeeds (case-insensitive FS) or returns
    // not_found (case-sensitive FS). Both are acceptable — we just verify we
    // never leak a file outside the root.
    try {
      const wrong = await f.rpc.readFile({ path: "case.txt" });
      // If it succeeded, it must have read the same file.
      assert.equal(Buffer.from(wrong.contentBase64, "base64").toString(), "A");
    } catch (err) {
      const code = (err as { code?: string }).code;
      assert.equal(code, "not_found");
    }
  } finally {
    await f.cleanup();
  }
});
