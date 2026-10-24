import { createHash } from "node:crypto";
import type { CodeRunnerLanguage } from "@/types/code-runner";

const EXECUTION_FINGERPRINT_VERSION = "v1";
const PROTECTED_NEWLINE = "\u0000";

export function hashCodeForRun(args: {
  language: CodeRunnerLanguage;
  code: string;
}) {
  return `sha256:${createHash("sha256")
    .update(args.language)
    .update("\0")
    .update(args.code)
    .digest("hex")}`;
}

/**
 * Execution identity deliberately differs from the raw audit hash above.
 * It ignores language comments and other non-executable line trivia while
 * preserving strings, Python indentation, and executable source text.
 */
export function fingerprintCodeForExecution(args: {
  language: CodeRunnerLanguage;
  code: string;
}) {
  const normalized = normalizeExecutableSource(args.language, args.code);

  return `execfp:${EXECUTION_FINGERPRINT_VERSION}:sha256:${createHash("sha256")
    .update(args.language)
    .update("\0")
    .update(normalized)
    .digest("hex")}`;
}

/**
 * Internal identity for an exact selected visible-test suite. Test order does
 * not change suite identity; membership does. Keep this out of model-facing
 * projections for the same reason as code hashes.
 */
export function hashSelectedTestSuite(testCaseIds: string[]) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify([...testCaseIds].sort()))
    .digest("hex")}`;
}

function normalizeExecutableSource(
  language: CodeRunnerLanguage,
  code: string,
) {
  const normalizedNewlines = code.replace(/\r\n?/g, "\n");
  const commentStripped =
    language === "Python"
      ? stripPythonComments(normalizedNewlines)
      : stripCppComments(normalizedNewlines);

  return commentStripped
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replaceAll(PROTECTED_NEWLINE, "\n");
}

function stripPythonComments(code: string) {
  let output = "";
  let index = 0;
  let quote: "'" | '"' | undefined;
  let tripleQuoted = false;

  while (index < code.length) {
    const char = code[index]!;

    if (quote) {
      if (char === "\n") {
        output += PROTECTED_NEWLINE;
        index += 1;
        continue;
      }

      if (char === "\\") {
        output += char;
        if (index + 1 < code.length) {
          output +=
            code[index + 1] === "\n"
              ? PROTECTED_NEWLINE
              : code[index + 1];
          index += 2;
        } else {
          index += 1;
        }
        continue;
      }

      if (tripleQuoted && code.startsWith(quote.repeat(3), index)) {
        output += quote.repeat(3);
        index += 3;
        quote = undefined;
        tripleQuoted = false;
        continue;
      }

      output += char;
      index += 1;
      if (!tripleQuoted && char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === "#") {
      while (index < code.length && code[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      tripleQuoted = code.startsWith(char.repeat(3), index);
      const width = tripleQuoted ? 3 : 1;
      output += char.repeat(width);
      index += width;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function stripCppComments(code: string) {
  let output = "";
  let index = 0;

  while (index < code.length) {
    if (code.startsWith("//", index)) {
      while (index < code.length && code[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (code.startsWith("/*", index)) {
      output += " ";
      index += 2;
      while (index < code.length && !code.startsWith("*/", index)) {
        if (code[index] === "\n") {
          output += "\n";
        }
        index += 1;
      }
      index += code.startsWith("*/", index) ? 2 : 0;
      continue;
    }

    const rawString = readCppRawString(code, index);
    if (rawString) {
      output += rawString.value.replaceAll("\n", PROTECTED_NEWLINE);
      index = rawString.end;
      continue;
    }

    const char = code[index]!;
    if (char === '"' || char === "'") {
      const literal = readEscapedLiteral(code, index, char);
      output += literal.value.replaceAll("\n", PROTECTED_NEWLINE);
      index = literal.end;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readCppRawString(code: string, start: number) {
  if (!code.startsWith('R"', start)) {
    return undefined;
  }

  const delimiterEnd = code.indexOf("(", start + 2);
  if (delimiterEnd < 0 || delimiterEnd - (start + 2) > 16) {
    return undefined;
  }

  const delimiter = code.slice(start + 2, delimiterEnd);
  if (/[\s\\()]/.test(delimiter)) {
    return undefined;
  }

  const closing = `)${delimiter}\"`;
  const closingStart = code.indexOf(closing, delimiterEnd + 1);
  const end = closingStart < 0 ? code.length : closingStart + closing.length;

  return { value: code.slice(start, end), end };
}

function readEscapedLiteral(
  code: string,
  start: number,
  quote: "'" | '"',
) {
  let index = start + 1;

  while (index < code.length) {
    if (code[index] === "\\") {
      index += Math.min(2, code.length - index);
      continue;
    }
    if (code[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }

  return { value: code.slice(start, index), end: index };
}
