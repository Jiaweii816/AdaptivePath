export type DeepSeekV4ThinkingMode = "enabled" | "disabled";

export function deepSeekV4ThinkingParams(
  model: string,
  mode: DeepSeekV4ThinkingMode,
): Record<string, unknown> {
  if (!isDeepSeekV4Model(model)) return {};

  return mode === "enabled"
    ? {
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      }
    : { thinking: { type: "disabled" } };
}

export function isDeepSeekV4Model(model: string) {
  return /^deepseek-v4-(?:flash|pro)$/i.test(model.trim());
}
