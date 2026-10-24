/** Transport provenance only: never infer BFF ownership from HTTP status. */
export function bffErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = value as Record<string, unknown>;
  if (error.source !== "bff" && error.type !== "bff_error") return null;
  const message = error.code === "AI_BUSY" ? "An AI request is already running. Please wait."
    : error.code === "RATE_LIMITED" ? "Too many requests. Please wait before trying again."
    : error.code === "TIMEOUT" ? "The request timed out. Its processing may still finish."
    : "The AI gateway is unavailable. Please try again later.";
  return message + (typeof error.requestId === "string" && /^[a-f0-9]{32}$/.test(error.requestId)
    ? ` (Request-ID: ${error.requestId})` : "");
}
