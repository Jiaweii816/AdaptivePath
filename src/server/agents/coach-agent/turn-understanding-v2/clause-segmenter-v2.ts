import type {
  TurnClauseConnector,
  TurnClauseV2,
} from "./turn-understanding-v2.types";

type ConnectorMatch = {
  token: string;
  kind: TurnClauseConnector;
};

const CONNECTORS: readonly ConnectorMatch[] = [
  { token: "and finally", kind: "then" },
  { token: "after that", kind: "then" },
  { token: "and also", kind: "and" },
  { token: "meanwhile", kind: "meanwhile" },
  { token: "however", kind: "but" },
  { token: "然后", kind: "then" },
  { token: "接着", kind: "then" },
  { token: "之后", kind: "then" },
  { token: "最后再", kind: "then" },
  { token: "最后", kind: "then" },
  { token: "同时", kind: "meanwhile" },
  { token: "但是", kind: "but" },
  { token: "不过", kind: "but" },
  { token: "另外", kind: "and" },
  { token: "顺便", kind: "and" },
  { token: "以及", kind: "and" },
  { token: "并且", kind: "and" },
  { token: "并", kind: "and" },
  { token: "then", kind: "then" },
  { token: "finally", kind: "then" },
  { token: "also", kind: "and" },
  { token: "and", kind: "and" },
  { token: "but", kind: "but" },
  { token: "但", kind: "but" },
];

const OPEN_TO_CLOSE = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
] as const);

const QUOTE_CLOSE = new Map([
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
] as const);

const TOP_LEVEL_SEPARATORS = new Set([
  ",",
  "，",
  ".",
  "。",
  ";",
  "；",
  "—",
  "、",
  "\n",
  "\r",
]);

const ENGLISH_ACTION_START = /^(?:please\s+)?(?:only\s+)?(?:run|execute|explain|tell|show|diagnose|debug|inspect|analy[sz]e|optimi[sz]e|fix|change|give|provide|recommend|save|remember|recall|find|try|test|check|continue|walk|help|don['’]t|do\s+not|never)\b/i;
const CHINESE_ACTION_START = /^(?:(?:请|麻烦)(?:你)?|帮我|给我)?\s*(?:运行|执行|跑|解释|说明|讲解|告诉|展示|分析|诊断|调试|检查|优化|修改|修复|给|提供|推荐|保存|记录|记住|回忆|查找|查看|测试|继续|帮)/u;
const LEADING_FIRST_STEP = /^(?:(?:请|麻烦)(?:你)?)?\s*先/u;

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function isEscaped(message: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && message[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isApostrophe(message: string, index: number): boolean {
  return (
    (message[index] === "'" || message[index] === "’") &&
    isWordCharacter(message[index - 1]) &&
    isWordCharacter(message[index + 1])
  );
}

function previousNonWhitespace(message: string, index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = message[cursor];
    if (character !== undefined && !/\s/u.test(character)) return character;
  }
  return undefined;
}

function nextNonWhitespace(message: string, index: number): string | undefined {
  for (let cursor = index + 1; cursor < message.length; cursor += 1) {
    const character = message[cursor];
    if (character !== undefined && !/\s/u.test(character)) return character;
  }
  return undefined;
}

function isProtectedNumericSeparator(
  message: string,
  index: number,
  segmentStart: number,
): boolean {
  const character = message[index];
  if (character === "," || character === "，") {
    return (
      /\d/.test(previousNonWhitespace(message, index) ?? "") &&
      /\d/.test(nextNonWhitespace(message, index) ?? "")
    );
  }
  if (character !== ".") return false;
  if (/\d/.test(message[index - 1] ?? "") && /\d/.test(message[index + 1] ?? "")) {
    return true;
  }
  return /^\s*\d+$/.test(message.slice(segmentStart, index)) && /\s/u.test(message[index + 1] ?? "");
}

function startsAction(message: string, index: number): boolean {
  const suffix = message.slice(index).trimStart();
  return ENGLISH_ACTION_START.test(suffix) || CHINESE_ACTION_START.test(suffix);
}

function tokenMatches(message: string, index: number, token: string): boolean {
  const actual = message.slice(index, index + token.length);
  if (actual.toLocaleLowerCase() !== token.toLocaleLowerCase()) return false;
  if (!/^[A-Za-z]/.test(token)) return true;
  return (
    !isWordCharacter(message[index - 1]) &&
    !isWordCharacter(message[index + token.length])
  );
}

function matchConnector(
  message: string,
  index: number,
  hasFirstStep: boolean,
  currentText: string,
): ConnectorMatch | undefined {
  if (
    message[index] === "再" &&
    (hasFirstStep || LEADING_FIRST_STEP.test(currentText.trimStart()))
  ) {
    return { token: "再", kind: "then" };
  }
  if (message[index] === "和" && startsAction(message, index + 1)) {
    return { token: "和", kind: "and" };
  }

  return CONNECTORS.find(({ token, kind }) => {
    if (!tokenMatches(message, index, token)) return false;
    if (kind !== "and") return true;
    if (token === "另外" || token === "顺便") return true;
    return startsAction(message, index + token.length);
  });
}

function trimRange(message: string, rawStart: number, rawEnd: number) {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(message[start] ?? "")) start += 1;
  while (end > start && /\s/u.test(message[end - 1] ?? "")) end -= 1;
  return { start, end };
}

/**
 * Splits only top-level syntax while preserving exact UTF-16 source spans.
 * Clause count and connectors are parsing evidence; this module never chooses a route.
 */
export function segmentClausesV2(message: string): TurnClauseV2[] {
  const clauses: TurnClauseV2[] = [];
  const bracketClosers: string[] = [];
  let segmentStart = 0;
  let connectorBefore: TurnClauseConnector | undefined;
  let quoteClose: string | undefined;
  let inInlineCode = false;
  let inFence = false;
  let hasFirstStep = false;

  const appendRange = (rawEnd: number): boolean => {
    const { start, end } = trimRange(message, segmentStart, rawEnd);
    if (start >= end) return false;
    const text = message.slice(start, end);
    const clause: TurnClauseV2 = {
      id: `c${clauses.length}`,
      text,
      start,
      end,
      ...(connectorBefore ? { connectorBefore } : {}),
    };
    clauses.push(clause);
    if (LEADING_FIRST_STEP.test(text)) hasFirstStep = true;
    connectorBefore = undefined;
    return true;
  };

  for (let index = 0; index < message.length; index += 1) {
    if (inFence) {
      if (message.startsWith("```", index) && !isEscaped(message, index)) {
        inFence = false;
        index += 2;
      }
      continue;
    }
    if (inInlineCode) {
      if (message[index] === "`" && !isEscaped(message, index)) inInlineCode = false;
      continue;
    }
    if (quoteClose) {
      if (message[index] === quoteClose && !isEscaped(message, index)) quoteClose = undefined;
      continue;
    }

    if (message.startsWith("```", index) && !isEscaped(message, index)) {
      inFence = true;
      index += 2;
      continue;
    }
    if (message[index] === "`" && !isEscaped(message, index)) {
      inInlineCode = true;
      continue;
    }
    const possibleQuoteClose = QUOTE_CLOSE.get(message[index] as never);
    if (possibleQuoteClose && !isApostrophe(message, index)) {
      quoteClose = possibleQuoteClose;
      continue;
    }

    const bracketClose = OPEN_TO_CLOSE.get(message[index] as never);
    if (bracketClose) {
      bracketClosers.push(bracketClose);
      continue;
    }
    if (bracketClosers.at(-1) === message[index]) {
      bracketClosers.pop();
      continue;
    }
    if (bracketClosers.length > 0) continue;

    const character = message[index] ?? "";
    if (
      TOP_LEVEL_SEPARATORS.has(character) &&
      (character !== "、" || startsAction(message, index + 1)) &&
      !isProtectedNumericSeparator(message, index, segmentStart)
    ) {
      appendRange(index);
      segmentStart = index + 1;
      continue;
    }

    const currentText = message.slice(segmentStart, index);
    const connector = matchConnector(message, index, hasFirstStep, currentText);
    if (!connector) continue;
    const hasCurrentText = trimRange(message, segmentStart, index).start < index;
    if (!hasCurrentText && clauses.length === 0) continue;

    appendRange(index);
    connectorBefore = connector.kind;
    segmentStart = index + connector.token.length;
    index += connector.token.length - 1;
  }

  appendRange(message.length);
  return clauses;
}
