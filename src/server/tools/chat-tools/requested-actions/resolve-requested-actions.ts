import type { DurableWriteToolName } from "../durable-write-types";
import {
  CLAUSE_CONNECTOR_PATTERN,
  findFirstSourceMatch,
  findSourceMatches,
  hasPattern,
  maskMarkdownCode,
  normalizeActionText,
  REQUEST_PREFIX_PATTERNS,
  splitRequestedActionClauses,
  WRITE_ACTION_PATTERNS,
  type RequestedActionClause,
  type SourceTextMatch,
} from "./action-lexicon";
import { listDurableWriteSpecs } from "./durable-write-registry";

export type RequestedActionDecision =
  "granted" | "needs_confirmation" | "denied";

export type RequestedActionExclusionId =
  "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7";

export type RequestedActionEvidence = {
  clause: string;
  matchedTarget: string | null;
  matchedAction: string | null;
  requestPatternId: string | null;
  exclusionId: RequestedActionExclusionId | null;
};

export type RequestedAction = {
  toolName: DurableWriteToolName;
  order: number;
  decision: RequestedActionDecision;
  evidence: readonly RequestedActionEvidence[];
};

type ClauseDecision = {
  decision: RequestedActionDecision;
  order: number;
  evidence: RequestedActionEvidence;
};

const NEGATION_PATTERNS = [
  /(?:不要|别|无需|不用|不必|禁止|不准|不允许|不可|切勿)/u,
  /\b(?:don't|do not|never|no need to|must not|mustn't|should not|shouldn't|avoid)\b/iu,
] as const;

const EXCLUSION_PATTERNS: Readonly<
  Record<Exclude<RequestedActionExclusionId, "E1">, readonly RegExp[]>
> = {
  E2: [
    /(?:如果|假如|假设|假定|要是).{0,96}(?:保存|存储|存进|存到|存入|记录|记住|收录|加入|添加|放进|写入|更新)/u,
    /(?:如果|假如|假设|假定|要是).{0,96}(?:以后|之后|下次|从现在起|往后|默认).{0,96}(?:请|要|用|使用|别|不要|优先|只|都|给我)/u,
    /\b(?:hypothetically|suppose|what if|if i (?:asked|were to ask))\b.{0,120}\b(?:save|store|record|remember|add|update)\b/iu,
    /\b(?:hypothetically|suppose|what if)\b.{0,120}\b(?:from now on|next time|going forward|by default|i prefer)\b/iu,
  ],
  E3: [
    /(?:之前|以前|曾经|已经|上次|刚才).{0,96}(?:保存|存储|存进|存到|存入|记录|收录|加入|添加|放进|写入|更新).{0,48}(?:吗|没有|没|过|了|？|\?)/u,
    /(?:我|本人).{0,24}(?:把|将)?.{0,64}(?:保存|存储|存进|存到|存入|记录|收录|加入|添加|放进|写入|更新).{0,48}(?:了|过)\s*$/u,
    /\b(?:previously|before|already|last time)\b.{0,120}\b(?:saved|stored|recorded|added|updated|did)\b/iu,
    /\bi\b.{0,96}\b(?:saved|stored|recorded|added|updated)\b.{0,32}\b(?:it|this|that|already|before)\b/iu,
  ],
  E4: [
    /(?:有几|有多少|多少(?:条|个|道)|是否有|有没有|还在吗|存在吗|找得到吗|保存了吗|存了吗|记录了吗)/u,
    /\b(?:how many|is there|are there|does .* (?:contain|have)|did .* (?:save|store|record))\b/iu,
  ],
  E5: [
    /(?:看看|查看|打开|读一下|阅读|浏览|列出|展示|给我看)/u,
    /\b(?:show|view|open|read|browse|list|look at|check)\b/iu,
  ],
  E6: [
    /(?:有什么用|有啥用|为什么(?:要)?|为何|是什么|什么意思|怎么工作|如何工作|能不能自动|可以自动|会不会自动|会自动|自动保存|支持自动)/u,
    /(?:^|请|帮我|能否|可以|给我)(?:解释|介绍|说明).{0,80}(?:是什么|什么意思|用途|作用)?/u,
    /\b(?:what is|what's|what does .* do|why|how does .* work|can you automatically|do you automatically)\b/iu,
  ],
  E7: [
    /(?:我以为|我原以为|我本来以为|我期待|你说过|你说你会|他说|她说).{0,96}(?:保存|存储|存进|存到|记录|收录|添加|写入|更新|会存)/u,
    /(?:我以为|我原以为|我本来以为|我期待|你说过|你说你会).{0,96}(?:以后|之后|下次|从现在起|往后|默认).{0,96}(?:请|要|用|使用|别|不要|优先|只|都|给我)/u,
    /\b(?:i thought|i expected|you said|they said|the message says)\b.{0,120}\b(?:save|store|record|add|update|would)\b/iu,
    /\b(?:i thought|i expected|you said)\b.{0,120}\b(?:from now on|next time|going forward|by default|i prefer)\b/iu,
  ],
};

export function resolveRequestedActions(message: string): RequestedAction[] {
  if (!message.trim()) {
    return [];
  }

  const matchableMessage = maskMarkdownCode(message);
  const clauses = splitRequestedActionClauses(matchableMessage).map(
    (clause) => ({
      ...clause,
      text: message.slice(clause.start, clause.end),
    }),
  );
  const requestEstablishedBefore = buildRequestInheritance(clauses);
  const actions: RequestedAction[] = [];

  for (const { toolName, spec } of listDurableWriteSpecs()) {
    const decisions: ClauseDecision[] = [];
    for (const clause of clauses) {
      const decision = classifyClause({
        clause,
        toolName,
        targets: spec.targets,
        implicitIntent: spec.implicitIntent,
        inheritedRequest: requestEstablishedBefore[clause.index] ?? false,
      });
      if (decision) {
        decisions.push(decision);
      }
    }
    if (decisions.length === 0 && spec.implicitIntent) {
      const fullMessageDecision = classifyClause({
        clause: {
          text: message,
          start: 0,
          end: message.length,
          index: 0,
        },
        toolName,
        targets: spec.targets,
        implicitIntent: spec.implicitIntent,
        inheritedRequest: false,
      });
      if (fullMessageDecision) decisions.push(fullMessageDecision);
    }
    if (decisions.length === 0) {
      continue;
    }

    actions.push({
      toolName,
      order: Math.min(...decisions.map((decision) => decision.order)),
      decision: mergeClauseDecisions(decisions),
      evidence: decisions.map((decision) => decision.evidence),
    });
  }

  return actions.sort(
    (left, right) =>
      left.order - right.order || left.toolName.localeCompare(right.toolName),
  );
}

function classifyClause(input: {
  clause: RequestedActionClause;
  toolName: DurableWriteToolName;
  targets: readonly RegExp[];
  implicitIntent?: readonly RegExp[];
  inheritedRequest: boolean;
}): ClauseDecision | null {
  const view = normalizeActionText(maskMarkdownCode(input.clause.text));
  const target = findFirstSourceMatch(view, input.targets);
  const actionMatches = findSourceMatches(view, WRITE_ACTION_PATTERNS);
  const action = target
    ? findNearestMatch(target, actionMatches)
    : (actionMatches[0] ?? null);
  const implicit = input.implicitIntent
    ? findFirstSourceMatch(view, input.implicitIntent)
    : null;

  if (!target && !implicit) {
    return null;
  }

  const exclusion = findExclusion(view, target, action, actionMatches);
  if (exclusion) {
    return buildClauseDecision(input.clause, target ?? implicit, action, {
      decision: "denied",
      requestPatternId: null,
      exclusionId: exclusion,
    });
  }

  if (implicit) {
    const decision = buildClauseDecision(input.clause, null, action, {
      decision: "granted",
      requestPatternId: "implicit_preference",
      exclusionId: null,
    });
    return { ...decision, order: input.clause.start + implicit.start };
  }

  if (!target || !action) {
    return buildClauseDecision(input.clause, target, action, {
      decision: "needs_confirmation",
      requestPatternId: null,
      exclusionId: null,
    });
  }

  const requestPatternId = findHighConfidenceRequestPattern({
    normalizedClause: view.normalized,
    target,
    action,
    inheritedRequest: input.inheritedRequest,
  });
  return buildClauseDecision(input.clause, target, action, {
    decision: requestPatternId ? "granted" : "needs_confirmation",
    requestPatternId,
    exclusionId: null,
  });
}

function buildClauseDecision(
  clause: RequestedActionClause,
  target: SourceTextMatch | null,
  action: SourceTextMatch | null,
  classification: {
    decision: RequestedActionDecision;
    requestPatternId: string | null;
    exclusionId: RequestedActionExclusionId | null;
  },
): ClauseDecision {
  const localOrder = Math.min(
    target?.start ?? Number.POSITIVE_INFINITY,
    action?.start ?? Number.POSITIVE_INFINITY,
  );
  return {
    decision: classification.decision,
    order: clause.start + (Number.isFinite(localOrder) ? localOrder : 0),
    evidence: {
      clause: clause.text,
      matchedTarget: target?.text ?? null,
      matchedAction: action?.text ?? null,
      requestPatternId: classification.requestPatternId,
      exclusionId: classification.exclusionId,
    },
  };
}

function mergeClauseDecisions(decisions: readonly ClauseDecision[]) {
  const unique = new Set(decisions.map((decision) => decision.decision));
  if (unique.size === 1) {
    return decisions[0].decision;
  }
  return "needs_confirmation" as const;
}

function findExclusion(
  view: ReturnType<typeof normalizeActionText>,
  target: SourceTextMatch | null,
  action: SourceTextMatch | null,
  actionMatches: readonly SourceTextMatch[],
): RequestedActionExclusionId | null {
  for (const exclusionId of ["E2", "E7", "E3", "E4", "E5", "E6"] as const) {
    if (hasPattern(view.normalized, EXCLUSION_PATTERNS[exclusionId])) {
      return exclusionId;
    }
  }

  if (target && action) {
    const negations = findSourceMatches(view, NEGATION_PATTERNS);
    if (
      negations.some((negation) => {
        const boundAction = actionMatches.find(
          (candidate) =>
            candidate.start >= negation.end &&
            candidate.start - negation.end <= 32,
        );
        return boundAction?.start === action.start;
      })
    ) {
      return "E1";
    }
  }
  return null;
}

function findNearestMatch(
  target: SourceTextMatch,
  matches: readonly SourceTextMatch[],
) {
  return (
    [...matches].sort((left, right) => {
      const leftDistance = rangeDistance(target, left);
      const rightDistance = rangeDistance(target, right);
      return leftDistance - rightDistance || left.start - right.start;
    })[0] ?? null
  );
}

function rangeDistance(left: SourceTextMatch, right: SourceTextMatch) {
  if (left.end < right.start) {
    return right.start - left.end;
  }
  if (right.end < left.start) {
    return left.start - right.end;
  }
  return 0;
}

function findHighConfidenceRequestPattern(input: {
  normalizedClause: string;
  target: SourceTextMatch;
  action: SourceTextMatch;
  inheritedRequest: boolean;
}) {
  if (hasPattern(input.normalizedClause, REQUEST_PREFIX_PATTERNS)) {
    return "polite_request";
  }
  if (
    /(?:^|\s)(?:也|另外|同时|顺便|再)?\s*(?:把|将)/u.test(
      input.normalizedClause,
    )
  ) {
    return "imperative_ba";
  }

  const beforeAction = input.normalizedClause
    .slice(0, input.action.start)
    .trim();
  const between = input.normalizedClause.slice(
    Math.min(input.action.end, input.target.start),
    Math.max(input.action.end, input.target.start),
  );
  const afterAction = input.normalizedClause.slice(input.action.end);
  if (/(?:以后|之后)(?:也)?\s*$/u.test(beforeAction)) {
    return "future_imperative";
  }
  const actionAtImperativeStart =
    /^(?:(?:这个|这条|这题|它|也|另外|同时|顺便|再|但|this|that|also)\s*){0,3}$/iu.test(
      beforeAction,
    );
  const explicitSuffix =
    /(?:一下|吧|进去|下来|起来)/u.test(afterAction) ||
    ((/(?:到|进|入|至)\s*$/u.test(between) ||
      /(?:进|到|入)$/u.test(input.action.text)) &&
      /^\s*(?:里|里面|中|内)/u.test(
        input.normalizedClause.slice(input.target.end),
      ));

  if (actionAtImperativeStart || explicitSuffix) {
    return "imperative_or_explicit_suffix";
  }
  if (
    input.inheritedRequest &&
    CLAUSE_CONNECTOR_PATTERN.test(input.normalizedClause.trim())
  ) {
    return "inherited_request";
  }
  return null;
}

function buildRequestInheritance(clauses: readonly RequestedActionClause[]) {
  const inherited: boolean[] = [];
  let established = false;
  for (const clause of clauses) {
    inherited[clause.index] = established;
    const normalized = normalizeActionText(
      maskMarkdownCode(clause.text),
    ).normalized;
    if (
      hasPattern(normalized, REQUEST_PREFIX_PATTERNS) ||
      /(?:^|\s)(?:也|另外|同时|顺便|再)?\s*(?:把|将)/u.test(normalized) ||
      (hasPattern(normalized, WRITE_ACTION_PATTERNS) &&
        /^(?:这个|这条|这题|它|也|另外|同时|顺便|再|save\b|store\b|record\b|add\b|保存|存|记录|添加)/iu.test(
          normalized.trim(),
        ))
    ) {
      established = true;
    }
  }
  return inherited;
}
