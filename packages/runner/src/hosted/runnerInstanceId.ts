/**
 * runnerInstanceId.ts
 *
 * Manages a stable, persistent runner instance ID stored at
 * ~/.jasojeon/instance-id (plain UUID — not a secret, just an identifier).
 *
 * Survives restarts and binary upgrades because it lives outside the binary.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_ID_PATH = path.join(os.homedir(), ".jasojeon", "instance-id");

/**
 * Returns the persistent runner instance ID, creating one if it doesn't exist.
 *
 * @param idFilePath Override the storage path (used in tests). Defaults to
 *   ~/.jasojeon/instance-id.
 */
export async function getOrCreateRunnerInstanceId(
  idFilePath: string = DEFAULT_ID_PATH
): Promise<string> {
  // Try reading the existing file first.
  try {
    const content = await fs.readFile(idFilePath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // File does not exist — fall through to create.
  }

  const newId = crypto.randomUUID();

  // Ensure the parent directory exists.
  const dir = path.dirname(idFilePath);
  await fs.mkdir(dir, { recursive: true });

  // Exclusive create: if another concurrent process wins the race, re-read.
  try {
    await fs.writeFile(idFilePath, newId, { flag: "wx", encoding: "utf8" });
    return newId;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      const content = await fs.readFile(idFilePath, "utf8");
      return content.trim();
    }
    throw err;
  }
}
