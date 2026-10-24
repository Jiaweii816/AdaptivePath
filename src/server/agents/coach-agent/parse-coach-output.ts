import { coachDiagnosisSchema, coachReviewResultSchema } from "@/types/coach";
import type { CoachDiagnosis, CoachReviewDegradation } from "@/types/coach";
import { DIAGNOSIS_SENTINEL } from "./review-output-protocol";

export type ParseCoachReviewOutputOptions = {
  fallbackDiagnosis: CoachDiagnosis;
};

export type ReviewParseResult = {
  coachReply: string;
  diagnosis: CoachDiagnosis;
  degraded?: CoachReviewDegradation;
};

// Never throws on formatting. Tries, in order: reply-first sentinel, legacy
// tagged blocks, legacy whole-JSON result; otherwise treats the full output as
// the reply and falls back to the evidence-derived diagnosis.
export function parseCoachReviewOutput(
  content: string,
  options: ParseCoachReviewOutputOptions,
): ReviewParseResult {
  const sentinel = splitOnLastSentinelLine(content);

  if (sentinel) {
    return parseSentinelOutput(sentinel, options.fallbackDiagnosis);
  }

  const tagged = parseLegacyTaggedOutput(content, options.fallbackDiagnosis);

  if (tagged) {
    return tagged;
  }

  const whole = parseWholeJsonResult(content);

  if (whole) {
    return whole;
  }

  return {
    coachReply: content.trim(),
    diagnosis: options.fallbackDiagnosis,
    degraded: {
      tier: 2,
      reason: "No diagnosis sentinel found; treated full output as the reply.",
      memorySkipped: true,
    },
  };
}

function splitOnLastSentinelLine(
  content: string,
): { reply: string; tail: string } | undefined {
  const lines = content.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trim() === DIAGNOSIS_SENTINEL) {
      return {
        reply: lines.slice(0, i).join("\n").trim(),
        tail: lines.slice(i + 1).join("\n").trim(),
      };
    }
  }

  return undefined;
}

function parseSentinelOutput(
  split: { reply: string; tail: string },
  fallback: CoachDiagnosis,
): ReviewParseResult {
  const diagnosis = parseDiagnosisObject(split.tail);

  if (diagnosis) {
    return { coachReply: split.reply, diagnosis };
  }

  return {
    coachReply: split.reply,
    diagnosis: fallback,
    degraded: {
      tier: 1,
      reason: "Diagnosis JSON after the sentinel could not be parsed.",
      memorySkipped: true,
    },
  };
}

function parseLegacyTaggedOutput(
  content: string,
  fallback: CoachDiagnosis,
): ReviewParseResult | undefined {
  const coachReply = extractTaggedBlock(content, "coach_reply_markdown");

  if (!coachReply) {
    return undefined;
  }

  const diagnosisText = extractTaggedBlock(content, "diagnosis_json");
  const diagnosis = diagnosisText
    ? parseDiagnosisObject(diagnosisText)
    : undefined;

  if (diagnosis) {
    return { coachReply, diagnosis };
  }

  return {
    coachReply,
    diagnosis: fallback,
    degraded: {
      tier: 1,
      reason: "Legacy tagged diagnosis JSON could not be parsed.",
      memorySkipped: true,
    },
  };
}

function parseWholeJsonResult(content: string): ReviewParseResult | undefined {
  const object = parseFirstJsonObject(
    escapeControlCharsInStrings(stripCodeFence(content)),
  );

  if (!object) {
    return undefined;
  }

  const parsed = coachReviewResultSchema.safeParse(object);

  return parsed.success
    ? {
        coachReply: parsed.data.coachReply,
        diagnosis: parsed.data.diagnosis,
        degraded: parsed.data.degraded,
      }
    : undefined;
}

// Salvage chain for a diagnosis object: raw parse, then control-char-escaped
// brace extraction, validated against the diagnosis schema.
function parseDiagnosisObject(text: string): CoachDiagnosis | undefined {
  const candidate =
    parseFirstJsonObject(text) ??
    parseFirstJsonObject(escapeControlCharsInStrings(text));

  if (!candidate) {
    return undefined;
  }

  const parsed = coachDiagnosisSchema.safeParse(candidate);

  return parsed.success ? parsed.data : undefined;
}

// Returns the first complete top-level JSON object in text, tolerating trailing
// prose. Undefined if none parses.
function parseFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");

  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }

    if (ch !== "}") {
      continue;
    }

    depth--;

    if (depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractTaggedBlock(content: string, tag: string) {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");

  return content.match(pattern)?.[1]?.trim();
}

// LLM models sometimes emit literal newlines/tabs inside JSON string values.
// Walk the text char-by-char so we only escape control chars that are actually
// inside a string literal, leaving structural whitespace intact.
function escapeControlCharsInStrings(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      result += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === "\n") {
        result += "\\n";
        continue;
      }

      if (ch === "\r") {
        result += "\\r";
        continue;
      }

      if (ch === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += ch;
  }

  return result;
}
