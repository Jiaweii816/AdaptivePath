/**
 * Before submission the coach may not judge any option or state the correct
 * option's value (spec §10.3). Judging any option counts, to block behavioral leaks.
 */
type LeakContext = Readonly<{ correctOption: string; options: readonly Readonly<{ id: string; text: string }>[]; quotedSpans: readonly string[] }>;

const VERDICT_PATTERNS: readonly RegExp[] = [
  /(?:答案|正确答案|正确选项)\s*(?:是|为|应该是|就是)?\s*[:：]?\s*[（(]?[A-D](?![A-Za-z])/g,
  /(?<!你)选\s*[A-D](?![A-Za-z])/g,
  /(?<![A-Za-z])[A-D]\s*(?:选项)?\s*(?:是对的|是正确的|正确|对了|不对|是错的|错了|错误)/g,
  /[Aa]nswer\s+is\s+[(]?[A-D](?![A-Za-z])/g,
  /(?<![A-Za-z])(?:[Oo]ption\s+|[Cc]hoice\s+)?[(]?[A-D][)]?\s+is\s+(?:the\s+)?(?:correct|right|wrong|incorrect)\b/g,
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withoutQuotes(reply: string, quotedSpans: readonly string[]): string {
  return quotedSpans.reduce((text, span) => text.split(span).join(" "), reply);
}

/** Whole-token match: "0" must not hit "0.5", "1/8" must still hit "1/8." at a sentence end. */
function tokenPattern(text: string): RegExp {
  return new RegExp(`(?<![\\w/.])${escapeRegExp(text.trim())}(?![\\w/]|\\.\\d)`, "g");
}

export function findAnswerLeaks(reply: string, ctx: LeakContext): string[] {
  const text = withoutQuotes(reply, ctx.quotedSpans);
  const correct = ctx.options.find((o) => o.id === ctx.correctOption);
  if (!correct) throw new Error(`Correct option ${ctx.correctOption} is not among the options`);
  const patterns = [...VERDICT_PATTERNS, tokenPattern(correct.text)];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
}
