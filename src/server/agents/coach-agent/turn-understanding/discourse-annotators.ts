import type { SignalEvidence } from "./turn-understanding.types";

type AnnotationRule = {
  kind: string;
  pattern: RegExp;
};

type IndexedEvidence = {
  index: number;
  evidence: SignalEvidence;
};

const DISCOURSE_RULES: AnnotationRule[] = [
  { kind: "repeat_marker", pattern: /\bagain\b|再来一次|再解释一次|重新/giu },
  { kind: "continuation_marker", pattern: /\bstill\b|仍然|还是/giu },
  {
    kind: "reference_marker",
    pattern: /\bthat\b|\bit\b|之前那个|那个/giu,
  },
];

const NEGATION_RULES: AnnotationRule[] = [
  {
    kind: "negation",
    pattern:
      /先别|不要|禁止|不用|无需|不许|不能|避免|别|\b(?:don['’]t|do\s+not|never|without|not|no|cannot|can['’]t)\b/giu,
  },
];

function collectEvidence(
  message: string,
  rules: AnnotationRule[],
  strength: SignalEvidence["strength"],
  polarity: SignalEvidence["polarity"],
): SignalEvidence[] {
  const matches: IndexedEvidence[] = rules.flatMap(({ kind, pattern }) =>
    Array.from(message.matchAll(pattern), (match) => ({
      index: match.index,
      evidence: {
        kind,
        span: match[0],
        strength,
        polarity,
      },
    })),
  );

  return matches
    .sort((left, right) => left.index - right.index)
    .map(({ evidence }) => evidence);
}

export function annotateDiscourse(message: string): SignalEvidence[] {
  return collectEvidence(message, DISCOURSE_RULES, "soft", "positive");
}

export function annotateNegation(message: string): SignalEvidence[] {
  return collectEvidence(message, NEGATION_RULES, "hard", "negative");
}
