#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function usage(reason) {
  const message = reason ? `${reason}\n` : "";
  process.stderr.write(
    `${message}Usage: supervise.mjs --label <label> --pidfile <path> --logfile <path> -- <command> <args...>\n`
  );
  process.exit(1);
}

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    usage("Missing -- separator between supervisor args and child command");
  }
  const supervisorArgs = argv.slice(0, separator);
  const childArgs = argv.slice(separator + 1);
  if (childArgs.length === 0) {
    usage("No child command specified");
  }

  const options = {};
  for (let i = 0; i < supervisorArgs.length; i += 1) {
    const arg = supervisorArgs[i];
    if (!arg.startsWith("--")) {
      usage(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = supervisorArgs[i + 1];
    if (!value || value.startsWith("--")) {
      usage(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }

  const label = options.label ?? "process";
  const pidfile = options.pidfile;
  const logfile = options.logfile;

  if (!pidfile || !logfile) {
    usage("--pidfile and --logfile are required");
  }

  return { label, pidfile, logfile, childArgs };
}

async function main() {
  const { label, pidfile, logfile, childArgs } = parseArgs(process.argv.slice(2));

  mkdirSync(dirname(pidfile), { recursive: true });
  mkdirSync(dirname(logfile), { recursive: true });

  const logStream = createWriteStream(logfile, { flags: "a" });
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] [${label}] ${msg}\n`;
    logStream.write(line);
  };

  writeFileSync(pidfile, String(process.pid));
  const cleanup = () => {
    try {
      rmSync(pidfile);
    } catch {
      // ignore cleanup failures
    }
    logStream.end();
  };

  let stopping = false;
  let currentChild = null;
  let backoffMs = 1000;
  let firstFailureTs = 0;
  let consecutiveFailures = 0;
  const FAILURE_WINDOW_MS = 30_000;
  const MAX_FAILURES = 5;

  const handleSignal = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    log(`Received ${signal}, forwarding to child and shutting down.`);
    if (currentChild && !currentChild.killed) {
      currentChild.kill(signal);
    }
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  const runChildOnce = () =>
    new Promise((resolve) => {
      const child = spawn(childArgs[0], childArgs.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      currentChild = child;

      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        currentChild = null;
        resolve(result);
      };

      child.stdout?.on("data", (chunk) => logStream.write(chunk));
      child.stderr?.on("data", (chunk) => logStream.write(chunk));

      child.on("error", (error) => {
        log(`Child process error: ${error.message}`);
        finish({ code: null, signal: null });
      });

      child.on("exit", (code, signal) => {
        finish({ code, signal });
      });
    });

  try {
    while (!stopping) {
      log(`Starting child: ${childArgs.join(" ")}`);
      const result = await runChildOnce();

      if (stopping) {
        break;
      }

      if (result.code === 0 && result.signal === null) {
        log("Child exited cleanly; shutting down supervisor.");
        break;
      }

      const now = Date.now();
      if (firstFailureTs === 0 || now - firstFailureTs > FAILURE_WINDOW_MS) {
        firstFailureTs = now;
        consecutiveFailures = 0;
      }
      consecutiveFailures += 1;

      log(
        `Child exited (code=${result.code ?? "null"}, signal=${result.signal ?? "null"}). Restarting in ${Math.min(
          backoffMs,
          30_000
        )}ms.`
      );

      if (consecutiveFailures >= MAX_FAILURES && now - firstFailureTs < FAILURE_WINDOW_MS) {
        log("Too many failures in a short window; giving up.");
        process.exitCode = 1;
        break;
      }

      await delay(Math.min(backoffMs, 30_000));
      backoffMs = Math.min(backoffMs * 2, 30_000);
    }
  } finally {
    cleanup();
  }

  if (currentChild && !currentChild.killed) {
    currentChild.kill("SIGTERM");
  }
}

await main();
