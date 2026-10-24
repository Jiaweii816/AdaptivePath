import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import type { ChatTurnPlan } from "../coach-agent.types";
import {
  addDurableCandidates,
  addPlanCandidates,
  addSafeResponseFallback,
  addWholeMessageReadCandidates,
  collectClauseCandidates,
  finalizeCandidates,
  type OperationCandidate,
} from "./operation-candidates";
import type {
  Operation,
  SignalEvidence,
  TurnClause,
  TurnModifiers,
} from "./turn-understanding.types";

const CODE_DENIAL =
  /(?:不要|别|禁止|先别|不用|无需|不许|不能|避免).{0,20}(?:完整|全部|直接)?.{0,8}(?:代码|实现)|(?:without|no)\s+(?:full\s+|complete\s+)?code|(?:don['’]t|do not|never)\s+(?:show|give|write|provide|output|send)(?:\s+me)?(?:\s+the|\s+a)?(?:\s+(?:full|complete))?(?:\s+python)?\s+(?:implementation|code)/iu;
const PSEUDOCODE_REQUEST = /伪代码|pseudo[ -]?code/iu;
const ANXIETY =
  /慌|焦虑|崩溃|绝望|不适合|太难了|难受|卡住|不会|每次都错|老是写错|总是写错|\b(?:anxious|panic|panicking|overwhelmed|stuck)\b|not cut out|too hard/iu;
const COUNT_REQUEST =
  /(?:\b(\d+|one|two|three|few)\b|([一两二三几]))\s*(?:个|条|道)?\s*(?:hints?|examples?|problems?|提示|例子|题)/iu;

export function deriveOperations(
  legacy: ChatTurnPlan,
  clauses: TurnClause[],
  requestedActions: readonly RequestedAction[] = [],
): Operation[] {
  const sourceClauses = clauses.length > 0 ? clauses : [{ id: "c0", text: "" }];
  const candidates: OperationCandidate[] = [];
  collectClauseCandidates(candidates, sourceClauses);
  if (sourceClauses.length === 1) {
    addPlanCandidates(
      candidates,
      legacy,
      sourceClauses[0],
      100,
      requestedActions.length === 0,
    );
  } else {
    addWholeMessageReadCandidates(candidates, legacy, sourceClauses[0], 100);
  }
  addDurableCandidates(candidates, sourceClauses, requestedActions);
  if (candidates.length === 0) {
    addSafeResponseFallback(candidates, legacy, sourceClauses[0]);
  }
  return finalizeCandidates(candidates, sourceClauses);
}

export function deriveModifiers(
  legacy: ChatTurnPlan,
  _negation: SignalEvidence[],
  message = "",
): TurnModifiers {
  const deniesCode =
    legacy.codeDisclosure === "guided" && CODE_DENIAL.test(message);
  const asksForPseudocode = PSEUDOCODE_REQUEST.test(message);
  const countMatch = message.match(COUNT_REQUEST);
  const countToken = (countMatch?.[1] ?? countMatch?.[2])?.toLocaleLowerCase();
  const namedCount: Record<string, number> = {
    one: 1,
    一: 1,
    two: 2,
    两: 2,
    二: 2,
    three: 3,
    三: 3,
    few: 3,
    几: 3,
  };
  const requestedCount = countToken
    ? (namedCount[countToken] ?? Number.parseInt(countToken, 10))
    : undefined;
  return {
    codeDisclosure: {
      level: legacy.codeDisclosure,
      source:
        legacy.codeDisclosure === "full_code"
          ? "explicit_allow"
          : deniesCode
            ? "explicit_deny"
            : "default",
    },
    affect:
      legacy.primaryIntent === "anxiety_or_stuck" || ANXIETY.test(message)
        ? "anxious_stuck"
        : "none",
    deliveryMode: legacy.signals.hint ? "hint" : "direct",
    requestedArtifact:
      legacy.codeDisclosure === "full_code"
        ? "full_implementation"
        : asksForPseudocode
          ? "pseudocode"
          : "explanation",
    ...(requestedCount && requestedCount > 0 ? { requestedCount } : {}),
  };
}
