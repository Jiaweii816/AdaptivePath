export function isTraceUiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeEnv = process.env.NODE_ENV,
) {
  const configured = env.TRACE_UI_ENABLED?.trim().toLowerCase();
  if (configured !== undefined) {
    return configured === "1" || configured === "true" || configured === "yes";
  }
  return nodeEnv === "development";
}
