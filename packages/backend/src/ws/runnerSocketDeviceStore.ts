/**
 * runnerSocketDeviceStore.ts — re-export for tests
 *
 * This module exists solely to re-export the RunnerSocketDeviceStore interface
 * so test files can import it without reaching into runnerSocket.ts internals.
 */
export type { RunnerSocketDeviceStore } from "./runnerSocket";
