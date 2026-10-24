import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

import { buildChatTurnPlan } from "../chat-intent-policy";
import type { ChatTurnPlan } from "../coach-agent.types";
import { segmentClauses } from "./clause-segmenter";
import {
  annotateDiscourse,
  annotateNegation,
} from "./discourse-annotators";
import { deriveModifiers, deriveOperations } from "./derive-operations";
import { classifyRoute } from "./structural-route";
import type {
  SignalEvidence,
  TurnClause,
  TurnUnderstanding,
} from "./turn-understanding.types";

const LEARNER_STATE =
  /慌|焦虑|崩溃|绝望|不适合|太难了|难受|卡住|不会|每次都错|老是写错|总是写错|\b(?:anxious|panic|panicking|overwhelmed|stuck)\b|not cut out|too hard/giu;

const UNSUPPORTED_LANGUAGES: ReadonlyArray<{
  pattern: RegExp;
  requiresCodeContext?: boolean;
}> = [
  { pattern: /c\+\+|\bcpp\b/giu },
  { pattern: /\bjavascript\b/giu },
  { pattern: /\btypescript\b/giu },
  { pattern: /\bjava\b/giu },
  { pattern: /c#/giu },
  { pattern: /\bgolang\b/giu },
  { pattern: /\bgo\b/giu, requiresCodeContext: true },
  { pattern: /\brust\b/giu },
  { pattern: /\bruby\b/giu },
  { pattern: /\bkotlin\b/giu },
  { pattern: /\bswift\b/giu },
];

const CONDITIONAL_LANGUAGE_PREFERENCE =
  /(?:only\s+(?:if|when).{0,48}(?:ask|request)|unless.{0,48}(?:ask|request)|(?:if|when).{0,48}(?:explicitly\s+)?(?:ask|request)|只有.{0,40}(?:明确|要求|请求)|除非.{0,40}(?:明确|要求|请求))/iu;
const GO_CODE_CONTEXT =
  /(?:\b(?:in|using|use|write|implement|code|language|version)\s+go\b|\bgo\s+(?:code|implementation|api|syntax|language|version)\b|(?:用|使用|写|实现|代码|语言|版本|改成).{0,8}\bgo\b)/iu;
const NEGATED_LANGUAGE_PREFIX =
  /(?:\b(?:don['’]t|do\s+not|never|not|avoid)\b|不要|别|不用|禁止|不使用)[^,.;!?，。；！？\n]{0,64}$/iu;
const HISTORICAL_LANGUAGE_CLAUSE =
  /(?:\b(?:i|we)\s+(?:have\s+)?(?:previously\s+)?(?:used|wrote|implemented|coded|worked).{0,80}\b(?:before|previously|in the past|last time)\b|(?:之前|以前|上次).{0,60}(?:用|写|实现)|(?:用|写|实现).{0,60}(?:过|之前|以前))/iu;

function collectLearnerStateSignals(message: string): SignalEvidence[] {
  return Array.from(message.matchAll(LEARNER_STATE), (match) => ({
    kind: "anxious_stuck",
    span: match[0],
    strength: "soft",
    polarity: "positive",
  }));
}

function clauseContaining(
  message: string,
  clauses: readonly TurnClause[],
  matchIndex: number,
): string {
  let searchFrom = 0;
  for (const clause of clauses) {
    const start = message.indexOf(clause.text, searchFrom);
    if (start < 0) continue;
    const end = start + clause.text.length;
    if (matchIndex >= start && matchIndex < end) return clause.text;
    searchFrom = end;
  }
  return message;
}

function detectUnsupportedLanguage(
  message: string,
  clauses: readonly TurnClause[],
): string | undefined {
  for (const { pattern, requiresCodeContext } of UNSUPPORTED_LANGUAGES) {
    for (const match of message.matchAll(pattern)) {
      const sourceClause = clauseContaining(message, clauses, match.index);
      if (CONDITIONAL_LANGUAGE_PREFERENCE.test(sourceClause)) continue;
      if (isInactiveLanguageMention(sourceClause, match[0])) continue;
      if (requiresCodeContext && !GO_CODE_CONTEXT.test(sourceClause)) continue;
      return match[0];
    }
  }
  return undefined;
}

function isInactiveLanguageMention(clause: string, language: string): boolean {
  if (HISTORICAL_LANGUAGE_CLAUSE.test(clause)) return true;
  const localIndex = clause
    .toLocaleLowerCase()
    .indexOf(language.toLocaleLowerCase());
  if (localIndex < 0) return false;
  const prefix = clause.slice(
    Math.max(0, localIndex - 96),
    localIndex + language.length,
  );
  return NEGATED_LANGUAGE_PREFIX.test(prefix);
}

export function parseTurnUnderstanding(
  message: string,
  legacyPlan?: ChatTurnPlan,
  requestedActions?: readonly RequestedAction[],
): TurnUnderstanding {
  const legacy = legacyPlan ?? buildChatTurnPlan(message);
  const clauses = segmentClauses(message);
  const discourseMarkers = annotateDiscourse(message);
  const negationSignals = annotateNegation(message);
  const actions = requestedActions ?? resolveRequestedActions(message);
  const operations = deriveOperations(legacy, clauses, actions);
  const unsupportedLanguage = detectUnsupportedLanguage(message, clauses);
  const unresolvedOperationIds = operations
    .filter(({ resolution }) => resolution === "ambiguous")
    .map(({ id }) => id);
  const blocksSideEffect = operations.some(
    ({ family, resolution }) =>
      resolution === "ambiguous" &&
      (family === "execute" || family === "persist"),
  );
  const structuralRoute = classifyRoute({
    clauses,
    legacy,
    discourse: discourseMarkers,
    negation: negationSignals,
    operations,
  });

  return {
    route: unsupportedLanguage ? "llm" : structuralRoute,
    clauses,
    operations,
    modifiers: deriveModifiers(legacy, negationSignals, message),
    discourseMarkers,
    negationSignals,
    learnerStateSignals: collectLearnerStateSignals(message),
    unsupportedScope: unsupportedLanguage
      ? { languageMention: unsupportedLanguage }
      : {},
    ambiguity: { blocksSideEffect, unresolvedOperationIds },
    legacyPrimaryIntent: legacy.primaryIntent,
  };
}
