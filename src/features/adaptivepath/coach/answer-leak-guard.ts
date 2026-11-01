/**
 * Before submission the coach may not judge the student's answer or state any
 * option's value as the result (spec §10.3). Every option is checked the same
 * way, so a blocked reply never singles out the correct one.
 */
type LeakContext = Readonly<{ correctOption: string; options: readonly Readonly<{ id: string; text: string }>[]; quotedSpans: readonly string[] }>;

/** Options this long are flagged when restated anywhere; shorter ones (1/2, aa, One) only when asserted as the result. */
const MIN_VERBATIM_WORDS = 4;

const LETTER_VERDICTS: readonly RegExp[] = [
  /(?:答案|正确答案|正确选项)\s*(?:是|为|应该是|就是)?\s*[:：]?\s*[（(]?[A-D](?![A-Za-z])/g,
  /(?<!你)选\s*[A-D](?![A-Za-z])/g,
  /(?<![A-Za-z])[A-D]\s*(?:选项)?\s*(?:是对的|是正确的|正确|对了|不对|是错的|错了|错误)/g,
  /[Aa]nswer\s+is\s+[(]?[A-D](?![A-Za-z])/g,
  /(?<![A-Za-z])(?:[Oo]ption\s+|[Cc]hoice\s+)?[(]?[A-D][)]?\s+is\s+(?:the\s+)?(?:correct|right|wrong|incorrect)\b/g,
];
const STUDENT_VERDICTS: readonly RegExp[] = [
  /你的?(?:推理|答案|选择|思路|想法|判断|做法)?\s*(?:是|很)?\s*(?:对的|正确(?!地)|没错|不对|错了|错误)/g,
  /你(?:选|答|做|想)得(?:很)?(?:对|不对)/g,
  /没错[，,。!！]/g,
  /\b(?:that's|that is|you're|you are|this is|it's|it is)\s+(?:exactly\s+|absolutely\s+)?(?:right|correct|wrong|incorrect)\b/gi,
  /\byour\s+(?:answer|reasoning|choice|pick|logic)\s+is\s+(?:right|correct|wrong|incorrect)\b/gi,
  /\bexactly right\b/gi,
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeOption = (text: string) => text.trim().replace(/[.。!！?？;；,，]+$/u, "").toLowerCase();
/** "1/2" must not hit "1/2x" or "0.5", but must hit "1/2." or "1/2," at a clause end. */
const VALUE_END = "(?![\\w/]|\\.\\d)";

function withoutQuotes(reply: string, quotedSpans: readonly string[]): string {
  return quotedSpans.reduce((text, span) => text.split(span).join(" "), reply);
}

function assertionPatterns(value: string): RegExp[] {
  const v = escapeRegExp(value);
  return [
    new RegExp(`\\b(?:answer|probability|chance|ratio|result|fraction|proportion|it|that)\\s+(?:is|equals|would be|should be|must be|will be)\\s+(?:the\\s+)?${v}${VALUE_END}`, "gi"),
    new RegExp(`=\\s*${v}${VALUE_END}`, "gi"),
    new RegExp(`(?:答案|概率|比例|结果|比值|应该|应当)\\s*(?:就)?\\s*(?:是|为|=|等于)\\s*${v}${VALUE_END}`, "gi"),
    new RegExp(`(?<![\\w/.])${v}${VALUE_END}\\s*(?:是对的|是正确的|正确|is (?:correct|right|the answer))`, "gi"),
  ];
}

function optionValueLeaks(text: string, options: LeakContext["options"]): string[] {
  const lowered = text.toLowerCase();
  return options.flatMap((option) => {
    const value = normalizeOption(option.text);
    if (!value) return [];
    if (value.split(/\s+/).length >= MIN_VERBATIM_WORDS) return lowered.includes(value) ? [option.text] : [];
    return assertionPatterns(value).flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
  });
}

export function findAnswerLeaks(reply: string, ctx: LeakContext): string[] {
  if (!ctx.options.some((o) => o.id === ctx.correctOption)) throw new Error(`Correct option ${ctx.correctOption} is not among the options`);
  const text = withoutQuotes(reply, ctx.quotedSpans);
  const verdicts = [...LETTER_VERDICTS, ...STUDENT_VERDICTS].flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
  return [...verdicts, ...optionValueLeaks(text, ctx.options)];
}
