const HAN_SCRIPT = /\p{Script=Han}/u;

export function hasHanScript(value: string | null | undefined) {
  return Boolean(value && HAN_SCRIPT.test(value));
}

export function englishSystemText(
  value: string | null | undefined,
  fallback: string,
) {
  const text = value?.trim();

  if (!text || hasHanScript(text)) {
    return fallback;
  }

  return text;
}
