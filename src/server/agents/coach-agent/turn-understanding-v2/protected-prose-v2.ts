/**
 * Returns the parts of a turn that may carry conversational intent. The string
 * keeps its original UTF-16 length so every match can be projected back to the
 * user's exact source span. Code, quoted material, and bracketed payloads are
 * blanked because their words describe data, not requests.
 */
export function maskProtectedProseV2(text: string): string {
  const output = text.split("");
  const brackets: string[] = [];
  let quote: string | undefined;
  let inlineCode = false;
  let fence = false;

  const blank = (index: number) => {
    if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
  };

  for (let index = 0; index < text.length; index += 1) {
    if (fence) {
      blank(index);
      if (text.startsWith("```", index) && !isEscaped(text, index)) {
        blank(index + 1);
        blank(index + 2);
        fence = false;
        index += 2;
      }
      continue;
    }
    if (inlineCode) {
      blank(index);
      if (text[index] === "`" && !isEscaped(text, index)) inlineCode = false;
      continue;
    }
    if (quote) {
      blank(index);
      if (text[index] === quote && !isEscaped(text, index)) quote = undefined;
      continue;
    }
    if (brackets.length > 0) {
      blank(index);
      const nested = BRACKETS.get(text[index] ?? "");
      if (nested) brackets.push(nested);
      else if (brackets.at(-1) === text[index]) brackets.pop();
      continue;
    }

    if (text.startsWith("```", index) && !isEscaped(text, index)) {
      blank(index);
      blank(index + 1);
      blank(index + 2);
      fence = true;
      index += 2;
      continue;
    }
    if (text[index] === "`" && !isEscaped(text, index)) {
      blank(index);
      inlineCode = true;
      continue;
    }
    const quoteClose = QUOTES.get(text[index] ?? "");
    if (quoteClose && !isApostrophe(text, index)) {
      blank(index);
      quote = quoteClose;
      continue;
    }
    const bracketClose = BRACKETS.get(text[index] ?? "");
    if (bracketClose) {
      blank(index);
      brackets.push(bracketClose);
    }
  }
  return output.join("");
}

export function hasInlineCodeGroundingV2(text: string): boolean {
  return /`(?!``)[^`\n]+`/u.test(text);
}

const BRACKETS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

const QUOTES = new Map([
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
]);

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function isApostrophe(text: string, index: number): boolean {
  return (
    (text[index] === "'" || text[index] === "’") &&
    /[A-Za-z0-9_]/u.test(text[index - 1] ?? "") &&
    /[A-Za-z0-9_]/u.test(text[index + 1] ?? "")
  );
}
