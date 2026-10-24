import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import type { CodeRunnerLanguage } from "@/types/code-runner";

import { detectCurrentCodeState } from "../current-workspace-context";
import {
  hasSameRevisionAssistantCandidate,
  type ConversationProjection,
} from "../history-projection";
import { segmentClauses } from "../turn-understanding/clause-segmenter";
import type { TurnUnderstanding } from "../turn-understanding/turn-understanding.types";
import type { ExecutionTarget } from "./validate-classified-understanding";
import type {
  ClassifierContext,
  ClassifierWorkspaceContext,
} from "./turn-classifier.types";
import type { BackendFacts } from "./validate-classified-understanding";

export { hasSameRevisionAssistantCandidate } from "../history-projection";

export const CLASSIFIER_PROJECTION_CHAR_LIMIT = 4_000;

const EXECUTION_DENIAL =
  /(?:不要|别|禁止|不许|不能|无需|不用|先别).{0,32}(?:运行|执行|跑|测试|验证)|(?:don['’]t|do\s+not|never|must\s+not|should\s+not|cannot|can['’]t).{0,48}(?:run|execute|test|verify)|without.{0,32}(?:running|rerunning|executing|testing|verification)/iu;
const MANUAL_ONLY_EXECUTION =
  /\bdry[ -]?run\b|\bmanual(?:ly)?\s+(?:trace|simulate|walk|run)\b|手动.{0,12}(?:模拟|走一遍|执行|运行|跟踪)|(?:请|帮我|你来|给我).{0,8}手算/iu;
const ALL_EXECUTION_TARGETS =
  /(?:任何|全部|所有).{0,12}(?:代码|执行)|\b(?:anything|all\s+code|any\s+code)\b/iu;
const ASSISTANT_TARGET =
  /\b(?:your|assistant(?:'s)?)\s+(?:candidate|code|implementation|version)\b|\bcandidate\b|你(?:刚才|之前|前面)?(?:给|写|提供|生成|改)(?:的)?(?:代码|实现|版本)|你的(?:候选|代码|实现|版本)/iu;
const UNTRUSTED_DENIAL_TARGET =
  /(?:do\s+not|don['’]t|never|不要|别|禁止).{0,32}(?:run|execute|运行|执行).{0,32}(?:command|instruction|payload|命令|指令)/iu;

export function serializeClassifierProjection(
  projection: ConversationProjection,
): string {
  const serialized = projection.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  return serialized.length <= CLASSIFIER_PROJECTION_CHAR_LIMIT
    ? serialized
    : serialized.slice(-CLASSIFIER_PROJECTION_CHAR_LIMIT);
}

export function buildClassifierContext(args: {
  message: string;
  projection: ConversationProjection;
  language?: CodeRunnerLanguage;
  code?: string;
  selectedTestCount: number;
}): Omit<ClassifierContext, "traceContext"> {
  const code = args.code ?? "";
  return {
    message: args.message,
    projection: serializeClassifierProjection(args.projection),
    workspace: {
      language: args.language,
      codeState: detectCurrentCodeState(code),
      currentCodeLength: code.length,
      selectedTestCount: args.selectedTestCount,
      hasAssistantCandidate: hasSameRevisionAssistantCandidate(args.projection),
    },
  };
}

export function buildClassifierBackendFacts(args: {
  message: string;
  workspace: ClassifierWorkspaceContext;
  requestedActions: readonly RequestedAction[];
  deterministic?: TurnUnderstanding;
}): BackendFacts {
  return {
    workspaceLanguage: args.workspace.language,
    hasCurrentCode:
      args.workspace.currentCodeLength > 0 &&
      args.workspace.codeState !== "missing",
    hasAssistantCandidate: args.workspace.hasAssistantCandidate,
    deniedExecutionTargets: deriveDeniedExecutionTargets(args.message),
    grantedExecutionTargets: deriveGrantedExecutionTargets(args.deterministic),
    grantedDurableTools: grantedDurableTools(args.requestedActions),
  };
}

function deriveGrantedExecutionTargets(
  deterministic: TurnUnderstanding | undefined,
): ExecutionTarget[] {
  const targets = deterministic?.operations.flatMap((operation) => {
    if (operation.family !== "execute" || operation.resolution !== "explicit") {
      return [];
    }
    return operation.target === "current_user_code" ||
      operation.target === "assistant_candidate"
      ? [operation.target]
      : [];
  });
  return [...new Set(targets ?? [])];
}

function grantedDurableTools(actions: readonly RequestedAction[]) {
  return [...new Set(
    actions
      .filter(({ decision }) => decision === "granted")
      .map(({ toolName }) => toolName),
  )];
}

export function deriveDeniedExecutionTargets(
  message: string,
): ExecutionTarget[] {
  const denied = new Set<ExecutionTarget>();
  const withoutQuotedInstructions = stripQuotedInstructions(message);
  for (const clause of segmentClauses(withoutQuotedInstructions)) {
    if (UNTRUSTED_DENIAL_TARGET.test(clause.text)) continue;
    if (
      !EXECUTION_DENIAL.test(clause.text) &&
      !MANUAL_ONLY_EXECUTION.test(clause.text)
    ) {
      continue;
    }
    for (const target of targetsForClause(clause.text)) denied.add(target);
  }
  return [...denied];
}

function targetsForClause(clause: string): ExecutionTarget[] {
  if (ALL_EXECUTION_TARGETS.test(clause)) {
    return ["current_user_code", "assistant_candidate"];
  }
  return ASSISTANT_TARGET.test(clause)
    ? ["assistant_candidate"]
    : ["current_user_code"];
}

function stripQuotedInstructions(message: string): string {
  return message
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`]*`/gu, " ")
    .replace(/"[^"\n]*"/gu, " ")
    .replace(/“[^”\n]*”/gu, " ");
}
