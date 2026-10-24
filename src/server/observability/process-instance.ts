import { randomUUID } from "node:crypto";

const PROCESS_INSTANCE_SYMBOL = Symbol.for("patterncoach.trace.process-instance-id");

type ProcessGlobal = typeof globalThis & {
  [PROCESS_INSTANCE_SYMBOL]?: string;
};

/**
 * One id per Node process, retained across Next.js development module reloads.
 * It identifies ownership; it is not a durable worker or retry mechanism.
 */
export function getProcessInstanceId() {
  const processGlobal = globalThis as ProcessGlobal;
  processGlobal[PROCESS_INSTANCE_SYMBOL] ??= randomUUID();
  return processGlobal[PROCESS_INSTANCE_SYMBOL];
}
