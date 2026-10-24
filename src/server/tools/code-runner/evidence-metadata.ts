import type { CodeRunResult } from "@/types/code-runner";

export function readProviderUsed(runResult: Pick<CodeRunResult, "rawResult">) {
  const rawResult = runResult.rawResult;

  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
    return undefined;
  }

  const providerUsed = (rawResult as Record<string, unknown>).providerUsed;

  return typeof providerUsed === "string" && providerUsed.trim()
    ? providerUsed
    : undefined;
}

export function formatRunnerProvider(providerUsed: string | undefined) {
  if (!providerUsed) {
    return "Unknown";
  }

  if (providerUsed.startsWith("lc_")) {
    return "LeetCode";
  }

  if (
    providerUsed === "piston" ||
    providerUsed === "piston_fallback" ||
    providerUsed === "local_hot150" ||
    providerUsed === "remote_unavailable_local_fallback"
  ) {
    return "Piston";
  }

  if (providerUsed === "mock") {
    return "Mock";
  }

  return "Unknown";
}

export function formatEvidenceSource(providerUsed: string | undefined) {
  if (providerUsed === "lc_submit") {
    return "LeetCode judge evidence";
  }

  if (providerUsed === "lc_run") {
    return "LeetCode visible tests";
  }

  if (providerUsed === "local_hot150") {
    return "Local Hot-150 visible tests";
  }

  if (providerUsed === "remote_unavailable_local_fallback") {
    return "Remote unavailable; local visible-test fallback";
  }

  if (providerUsed === "mock") {
    return "Mock visible tests";
  }

  return "Local visible tests";
}
