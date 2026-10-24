export type SourceTextMatch = {
  text: string;
  start: number;
  end: number;
};

export type NormalizedTextView = {
  original: string;
  normalized: string;
  compact: string;
  normalizedToOriginal: readonly { start: number; end: number }[];
  compactToOriginal: readonly { start: number; end: number }[];
};

export type RequestedActionClause = {
  text: string;
  start: number;
  end: number;
  index: number;
};

/**
 * Hide Markdown code spans from deterministic action matching while retaining
 * every UTF-16 source position. Newlines stay visible so clause boundaries
 * outside code remain unchanged.
 */
export function maskMarkdownCode(message: string): string {
  const protectedOffsets = new Uint8Array(message.length);
  protectFencedCode(message, protectedOffsets);
  protectInlineCode(message, protectedOffsets);

  let masked = "";
  for (let index = 0; index < message.length; index += 1) {
    const character = message[index];
    masked +=
      protectedOffsets[index] && character !== "\n" && character !== "\r"
        ? " "
        : character;
  }
  return masked;
}

function protectFencedCode(message: string, protectedOffsets: Uint8Array) {
  const opener = /^( {0,3})(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(message)) !== null) {
    if (protectedOffsets[match.index]) {
      continue;
    }
    const fence = match[2];
    const closingFence = new RegExp(
      `^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`,
      "gm",
    );
    closingFence.lastIndex = opener.lastIndex;
    const closingMatch = closingFence.exec(message);
    const end = closingMatch
      ? closingMatch.index + closingMatch[0].length
      : message.length;
    protectedOffsets.fill(1, match.index, end);
    opener.lastIndex = end;
  }
}

function protectInlineCode(message: string, protectedOffsets: Uint8Array) {
  let cursor = 0;
  while (cursor < message.length) {
    if (protectedOffsets[cursor] || message[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const openerStart = cursor;
    while (message[cursor] === "`" && !protectedOffsets[cursor]) {
      cursor += 1;
    }
    const delimiterLength = cursor - openerStart;
    let closingStart = cursor;

    while (closingStart < message.length) {
      if (protectedOffsets[closingStart]) {
        closingStart += 1;
        continue;
      }
      if (message[closingStart] !== "`") {
        closingStart += 1;
        continue;
      }

      let closingEnd = closingStart;
      while (message[closingEnd] === "`" && !protectedOffsets[closingEnd]) {
        closingEnd += 1;
      }
      if (closingEnd - closingStart === delimiterLength) {
        protectedOffsets.fill(1, openerStart, closingEnd);
        cursor = closingEnd;
        break;
      }
      closingStart = closingEnd;
    }
  }
}

/**
 * Normalize text for matching without losing the source offsets needed for
 * ordering and audit evidence. The maps use UTF-16 offsets, matching RegExp's
 * index semantics in JavaScript.
 */
export function normalizeActionText(original: string): NormalizedTextView {
  let normalized = "";
  const normalizedToOriginal: { start: number; end: number }[] = [];

  for (let originalIndex = 0; originalIndex < original.length;) {
    const codePoint = original.codePointAt(originalIndex);
    const source = String.fromCodePoint(codePoint ?? 0);
    const sourceEnd = originalIndex + source.length;
    const transformed = source.normalize("NFKC").toLocaleLowerCase("en-US");

    normalized += transformed;
    for (let index = 0; index < transformed.length; index += 1) {
      normalizedToOriginal.push({ start: originalIndex, end: sourceEnd });
    }
    originalIndex = sourceEnd;
  }

  let compact = "";
  const compactToOriginal: { start: number; end: number }[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (/\s|[-_]/u.test(character)) {
      continue;
    }
    compact += character;
    compactToOriginal.push(normalizedToOriginal[index]);
  }

  return {
    original,
    normalized,
    compact,
    normalizedToOriginal,
    compactToOriginal,
  };
}

export const WRITE_ACTION_PATTERNS = [
  /保存|存储|存进|存到|存入|存(?!在)|记录|记住|记下|记到|记进|收进|收入(?=\s*(?:到|进)?\s*(?:错题本|错题簿|知识手册|知识本|知识库|知识卡(?:片)?|手册|mistake[\s_-]*(?:book|notebook)|handbook|knowledge[\s_-]*(?:book|handbook|note|card)))|收录|加入|添加|放进|放到|放(?=(?:复习|手册))|留到|留进|留在|写入|更新|扩展|补充|编辑|整理|归纳/u,
  /\b(?:save|store|record|remember|add|put|write|update|extend|organize)\b/iu,
] as const;

export const REQUEST_PREFIX_PATTERNS = [
  /(?:请|请你|请帮我|帮我|给我|麻烦|麻烦你|能不能帮我|可以帮我|能否帮我|劳烦)/u,
  /\b(?:please|can you|could you|would you|help me|i want(?: you)? to|i(?:'d| would) like(?: you)? to)\b/iu,
] as const;

export const CLAUSE_CONNECTOR_PATTERN =
  /^(?:也|另外|同时|顺便|再|还有|并且|而且|also\b|and\b|plus\b)/iu;

export function splitRequestedActionClauses(
  message: string,
): RequestedActionClause[] {
  const clauses: RequestedActionClause[] = [];
  const delimiter =
    /[。！？!?;；，,\n]+|(?:但是|不过|然而|然后|但)|(?:并且|同时|另外|顺便|并)(?=(?:请|把|将|保存|存储|存进|存到|存入|存|记录|记住|收录|加入|添加|放进|放到|写入|更新))|\b(?:but|however|then|and)\b/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = delimiter.exec(message)) !== null) {
    pushClause(message, cursor, match.index, clauses);
    cursor = match.index + match[0].length;
  }
  pushClause(message, cursor, message.length, clauses);

  return clauses;
}

function pushClause(
  message: string,
  start: number,
  end: number,
  clauses: RequestedActionClause[],
) {
  const raw = message.slice(start, end);
  const leadingWhitespace = raw.match(/^\s*/u)?.[0].length ?? 0;
  const trailingWhitespace = raw.match(/\s*$/u)?.[0].length ?? 0;
  const clauseStart = start + leadingWhitespace;
  const clauseEnd = Math.max(clauseStart, end - trailingWhitespace);
  if (clauseEnd <= clauseStart) {
    return;
  }
  clauses.push({
    text: message.slice(clauseStart, clauseEnd),
    start: clauseStart,
    end: clauseEnd,
    index: clauses.length,
  });
}

export function findFirstSourceMatch(
  view: NormalizedTextView,
  patterns: readonly RegExp[],
  useCompact = false,
): SourceTextMatch | null {
  return findSourceMatches(view, patterns, useCompact)[0] ?? null;
}

export function findSourceMatches(
  view: NormalizedTextView,
  patterns: readonly RegExp[],
  useCompact = false,
): SourceTextMatch[] {
  const haystack = useCompact ? view.compact : view.normalized;
  const sourceMap = useCompact
    ? view.compactToOriginal
    : view.normalizedToOriginal;
  const spans = new Map<string, { index: number; length: number }>();

  for (const pattern of patterns) {
    const flags = `${pattern.flags.replaceAll("g", "")}g`;
    const matcher = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(haystack)) !== null) {
      if (match[0].length === 0) {
        matcher.lastIndex += 1;
        continue;
      }
      spans.set(`${match.index}:${match[0].length}`, {
        index: match.index,
        length: match[0].length,
      });
    }
  }

  return [...spans.values()]
    .sort(
      (left, right) => left.index - right.index || right.length - left.length,
    )
    .flatMap((span) => {
      const first = sourceMap[span.index];
      const last = sourceMap[span.index + span.length - 1];
      return first && last
        ? [
            {
              text: view.original.slice(first.start, last.end),
              start: first.start,
              end: last.end,
            },
          ]
        : [];
    });
}

export function hasPattern(text: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => {
    const flags = pattern.flags.replaceAll("g", "");
    return new RegExp(pattern.source, flags).test(text);
  });
}
