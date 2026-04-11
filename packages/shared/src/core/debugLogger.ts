import fs from "node:fs";

const DEBUG_FILE = process.env.JASOJEON_DRAFTER_DEBUG_FILE;
const ENABLED = process.env.JASOJEON_DRAFTER_DEBUG === "1" && !!DEBUG_FILE;

export function logDrafterDebug(event: string, data: Record<string, unknown>): void {
  if (!ENABLED || !DEBUG_FILE) {
    return;
  }

  try {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;
    fs.appendFileSync(DEBUG_FILE, line, "utf8");
  } catch {
    // Never throw from the debug logger.
  }
}
