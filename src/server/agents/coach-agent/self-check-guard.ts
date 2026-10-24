export type SelfCheck = { question: string; answer: string };

const BANNED_SUBSTRINGS = [
  "structured json",
  "structured diagnosis",
  "evidence-only",
  "evidence only",
  "did not return",
  "diagnosis was unavailable",
  "正确思路是先锁定这题的关键决策",
  "你应该先检查哪条规则",
];

const BANNED_PATTERNS = [
  /wrong answer/i,
  /expected\s*\[/i,
  /actual\s*\[/i,
  /\btraceback\b/i,
  /\bkeyerror\b/i,
  /\bindexerror\b/i,
  /\bno_search_logic\b/i,
  /\bhardcoded_return\b/i,
  /\brun_status_[a-z_]+\b/i,
];

function isBanned(text: string) {
  const lower = text.toLowerCase();
  if (BANNED_SUBSTRINGS.some((needle) => lower.includes(needle))) {
    return true;
  }
  return BANNED_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCleanSelfCheck(value: SelfCheck | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const question = value.question?.trim() ?? "";
  const answer = value.answer?.trim() ?? "";
  if (!question || !answer) {
    return false;
  }

  return !isBanned(question) && !isBanned(answer);
}

export function sanitizeSelfCheck(
  value: SelfCheck | null | undefined,
): SelfCheck | null {
  if (!value) {
    return null;
  }

  const selfCheck = {
    question: value.question.trim(),
    answer: value.answer.trim(),
  };

  return isCleanSelfCheck(selfCheck) ? selfCheck : null;
}
