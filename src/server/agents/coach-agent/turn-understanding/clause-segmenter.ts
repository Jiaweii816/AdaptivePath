import type { TurnClause } from "./turn-understanding.types";

type ConnectorKind = NonNullable<TurnClause["connectorBefore"]>;

const CONNECTORS: ReadonlyArray<{
  token: string;
  kind: ConnectorKind;
}> = [
  { token: "after that", kind: "then" },
  { token: "meanwhile", kind: "meanwhile" },
  { token: "however", kind: "but" },
  { token: "另外", kind: "and" },
  { token: "顺便", kind: "and" },
  { token: "以及", kind: "and" },
  { token: "并且", kind: "and" },
  { token: "然后", kind: "then" },
  { token: "接着", kind: "then" },
  { token: "之后", kind: "then" },
  { token: "但是", kind: "but" },
  { token: "不过", kind: "but" },
  { token: "同时", kind: "meanwhile" },
  { token: "also", kind: "and" },
  { token: "and", kind: "and" },
  { token: "then", kind: "then" },
  { token: "but", kind: "but" },
  { token: "但", kind: "but" },
];

const TOP_LEVEL_SEPARATOR = /^[，,。；;、\r\n]+/;
const OPENING_BRACKETS = new Set(["(", "[", "{"]);
const CLOSING_BRACKETS = new Set([")", "]", "}"]);
const QUOTES = new Set(["'", '"', "`"]);

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function isAndOperatorTerm(message: string, index: number, token: string): boolean {
  if (token.toLocaleLowerCase() !== "and") return false;
  return /\b(?:bitwise|logical|boolean)\s*$/i.test(message.slice(0, index));
}

function hasLeadingFirstStep(message: string, index: number): boolean {
  const prefix = message.slice(0, index);
  return /^\s*(?:请|麻烦)?先[^，,。；;\r\n]+(?:[，,。；;\r\n]\s*)?$/u.test(prefix);
}

function matchConnectorAt(message: string, index: number) {
  if (message[index] === "再" && hasLeadingFirstStep(message, index)) {
    return { token: "再", kind: "then" } as const;
  }
  return CONNECTORS.find(({ token }) => {
    const actual = message.slice(index, index + token.length);
    if (actual.toLocaleLowerCase() !== token.toLocaleLowerCase()) return false;
    if (isAndOperatorTerm(message, index, token)) return false;
    if (!/^[A-Za-z]/.test(token)) return true;
    return (
      !isWordCharacter(message[index - 1]) &&
      !isWordCharacter(message[index + token.length])
    );
  });
}

function isApostrophe(message: string, index: number): boolean {
  return (
    message[index] === "'" &&
    isWordCharacter(message[index - 1]) &&
    isWordCharacter(message[index + 1])
  );
}

function appendClause(
  clauses: TurnClause[],
  rawText: string,
  connectorBefore?: ConnectorKind,
): void {
  const text = rawText.trim();
  if (!text) return;
  clauses.push({
    id: `c${clauses.length}`,
    text,
    ...(connectorBefore ? { connectorBefore } : {}),
  });
}

export function segmentClauses(message: string): TurnClause[] {
  const clauses: TurnClause[] = [];
  let connectorBefore: ConnectorKind | undefined;
  let quote: string | undefined;
  let bracketDepth = 0;
  let buffer = "";

  for (let index = 0; index < message.length; index += 1) {
    const character = message[index] ?? "";
    if (quote) {
      buffer += character;
      if (character === quote && message[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (QUOTES.has(character) && !isApostrophe(message, index)) {
      quote = character;
      buffer += character;
      continue;
    }
    if (OPENING_BRACKETS.has(character)) bracketDepth += 1;
    if (CLOSING_BRACKETS.has(character)) bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth > 0 || CLOSING_BRACKETS.has(character)) {
      buffer += character;
      continue;
    }

    const separator = message.slice(index).match(TOP_LEVEL_SEPARATOR)?.[0];
    if (separator) {
      appendClause(clauses, buffer, connectorBefore);
      buffer = "";
      connectorBefore = undefined;
      index += separator.length - 1;
      continue;
    }
    const connector = matchConnectorAt(message, index);
    if (connector && (buffer.trim() || clauses.length > 0)) {
      appendClause(clauses, buffer, connectorBefore);
      buffer = "";
      connectorBefore = connector.kind;
      index += connector.token.length - 1;
      continue;
    }
    buffer += character;
  }

  appendClause(clauses, buffer, connectorBefore);
  return clauses.length > 0 ? clauses : [{ id: "c0", text: message.trim() }];
}
