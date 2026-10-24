import { maskProtectedProseV2 } from "../protected-prose-v2";

export type QueryScript = "han" | "latin";

export type ContentUnit = {
  readonly start: number;
  readonly end: number;
};

/** Modern Chinese vocabulary is predominantly bisyllabic, so folding runs of
 *  content characters by two makes Han unit density comparable to Latin word
 *  density. This is the only linguistic assumption in the coverage metric and
 *  is verified per-script by the calibration in Task 15. */
const HAN_CHARS_PER_UNIT = 2;

/** Function characters carrying no intent signal. Interrogatives (为/什/么)
 * remain content because explain evidence covers them. */
const HAN_FUNCTION_CHARS = new Set(
  "的了吗呢吧啊呀哦嗯好请帮我你他她它这那是在有和与就都也还很太把被让给个下一们之于其对着过要会能可以但而及至如此不没",
);

/** English function words. Negation markers are deliberately absent: they are
 *  intent-bearing and must stay in the denominator. */
const LATIN_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "am",
  "i", "me", "my", "you", "your", "it", "its", "this", "that", "these", "those",
  "of", "to", "in", "on", "at", "for", "with", "and", "or", "so", "then",
  "please", "can", "could", "would", "will", "do", "does", "did", "have", "has",
  "what", "which", "here", "there", "some", "any", "just", "about",
]);

const LATIN_WORD_CHAR = /[A-Za-z0-9_'’]/u;

export function detectQueryScript(message: string): QueryScript {
  return /\p{Script=Han}/u.test(message) ? "han" : "latin";
}

export function contentUnitsOf(message: string): ContentUnit[] {
  const masked = maskProtectedProseV2(message);
  const units: ContentUnit[] = [];
  let hanRunStart: number | undefined;
  let latinRunStart: number | undefined;

  for (let index = 0; index <= masked.length; index += 1) {
    const char = masked[index];
    const isHanContent = isHanContentChar(char);
    const isLatinWord = char !== undefined && LATIN_WORD_CHAR.test(char);
    if (!isHanContent) hanRunStart = closeHanRun(units, hanRunStart, index);
    if (!isLatinWord) {
      latinRunStart = closeLatinRun({
        units,
        message: masked,
        start: latinRunStart,
        end: index,
      });
    }
    if (isHanContent && hanRunStart === undefined) hanRunStart = index;
    if (isLatinWord && latinRunStart === undefined) latinRunStart = index;
  }
  return units.sort((left, right) => left.start - right.start);
}

function isHanContentChar(char: string | undefined): boolean {
  return char !== undefined && /\p{Script=Han}/u.test(char) && !HAN_FUNCTION_CHARS.has(char);
}

function closeHanRun(
  units: ContentUnit[],
  start: number | undefined,
  end: number,
): undefined {
  if (start === undefined) return undefined;
  units.push(...pairHanRun(start, end));
  return undefined;
}

function closeLatinRun({
  units,
  message,
  start,
  end,
}: {
  readonly units: ContentUnit[];
  readonly message: string;
  readonly start: number | undefined;
  readonly end: number;
}): undefined {
  if (start === undefined) return undefined;
  const word = message.slice(start, end).replace(/^['’]+|['’]+$/gu, "");
  if (word && !LATIN_STOPWORDS.has(word.toLowerCase())) {
    units.push({ start, end });
  }
  return undefined;
}

function pairHanRun(start: number, end: number): ContentUnit[] {
  const units: ContentUnit[] = [];
  for (let cursor = start; cursor < end; cursor += HAN_CHARS_PER_UNIT) {
    units.push({ start: cursor, end: Math.min(cursor + HAN_CHARS_PER_UNIT, end) });
  }
  return units;
}
