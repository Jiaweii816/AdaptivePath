import { z } from "zod";

export const MEMORY_ORIGIN_ENV = "PATTERNCOACH_MEMORY_ORIGIN";

export const memoryOriginSchema = z.enum([
  "learner",
  "development",
  "test",
  "demo",
  "evaluation",
  "seed",
  "legacy_unknown",
]);

export type MemoryOrigin = z.infer<typeof memoryOriginSchema>;

export type MemoryWritePolicy = {
  origin: MemoryOrigin;
  durableWrites: boolean;
};

/**
 * Product-ledger visibility is not the same as semantic-memory eligibility.
 * The real learner may see preserved pre-provenance activity, while isolated
 * development/test/evaluation processes remain scoped to their own origin.
 */
export function resolveLearnerActivityLedgerOrigins(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MemoryOrigin[] {
  const origin = resolveMemoryOrigin(env);
  return origin === "learner" ? ["learner", "legacy_unknown"] : [origin];
}

/**
 * Origin is process-owned provenance, not user input. An unconfigured process
 * is deliberately quarantined as legacy_unknown instead of being guessed from
 * NODE_ENV, a user handle, a writer source, or the current database path.
 */
export function resolveMemoryOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MemoryOrigin {
  const configured = env[MEMORY_ORIGIN_ENV]?.trim();
  if (!configured) return "legacy_unknown";

  const parsed = memoryOriginSchema.safeParse(configured);
  if (!parsed.success) {
    throw new Error(
      `${MEMORY_ORIGIN_ENV} must be one of ${memoryOriginSchema.options.join(", ")}; got ${configured}`,
    );
  }
  return parsed.data;
}

/** Only an explicitly configured learner process may create durable L2/L3. */
export function resolveMemoryWritePolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MemoryWritePolicy {
  const origin = resolveMemoryOrigin(env);
  return { origin, durableWrites: origin === "learner" };
}

export function parseMemoryOrigin(value: unknown): MemoryOrigin {
  return memoryOriginSchema.parse(value);
}
