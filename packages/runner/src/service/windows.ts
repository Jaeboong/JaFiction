import { execSync } from "node:child_process";

const TASK_NAME = "JasojeonRunner";

export async function installWindowsService(exePath: string): Promise<void> {
  const taskRun = `"${exePath}" start`;

  try {
    execSync(
      `schtasks /Create /SC ONLOGON /TN "${TASK_NAME}" /TR "${taskRun}" /RL LIMITED /F`,
      { stdio: "pipe" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[jasojeon-runner] Failed to create Windows scheduled task: ${msg}`);
  }

  try {
    execSync(`schtasks /Run /TN "${TASK_NAME}"`, { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[jasojeon-runner] Warning: task created but failed to start immediately: ${msg}\n`
    );
  }

  process.stdout.write(`[jasojeon-runner] Windows scheduled task "${TASK_NAME}" registered.\n`);
}

export async function uninstallWindowsService(): Promise<void> {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: "pipe" });
    process.stdout.write(`[jasojeon-runner] Windows scheduled task "${TASK_NAME}" removed.\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[jasojeon-runner] Failed to remove Windows scheduled task: ${msg}`);
  }
}
