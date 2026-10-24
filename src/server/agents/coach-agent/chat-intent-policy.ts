import type { CodeRunResult } from "@/types/code-runner";
import type {
  ChatTurnContextNeeds,
  ChatTurnPlan,
  ChatTurnSignals,
  CoachCodeDisclosure,
  CoachChatIntent,
  CoachChatInteractionState,
  CoachChatPolicy,
  CoachReviewContext,
  CoachTeachingState,
} from "./coach-agent.types";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";

type BuildChatInteractionStateArgs = {
  intentMatch?: IntentMatch;
  turnPlan?: ChatTurnPlan;
  userMessage: string;
  problemTags: string[];
  memory: CoachMemoryBrief;
  lastRunResult?: CodeRunResult;
  reviewContext?: CoachReviewContext;
  currentHintLevel?: number;
};

export type IntentMatch = {
  intent: CoachChatIntent;
  confidence: number;
  rationale: string;
};

export function buildChatInteractionState(
  args: BuildChatInteractionStateArgs,
): CoachChatInteractionState {
  const detectedTurnPlan = args.turnPlan ?? buildChatTurnPlan(args.userMessage);
  const intentMatch = args.intentMatch ?? {
    intent: detectedTurnPlan.primaryIntent,
    confidence: detectedTurnPlan.confidence,
    rationale: detectedTurnPlan.rationale,
  };
  const turnPlan = args.intentMatch
    ? {
        ...detectedTurnPlan,
        primaryIntent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
      }
    : detectedTurnPlan;
  const teachingState = buildTeachingState({
    intent: intentMatch.intent,
    problemTags: args.problemTags,
    memory: args.memory,
    reviewContext: args.reviewContext,
    lastRunResult: args.lastRunResult,
    currentHintLevel: args.currentHintLevel ?? 0,
  });

  return {
    policy: buildPolicy({
      intentMatch,
      codeDisclosure: turnPlan.codeDisclosure,
      reviewContext: args.reviewContext,
      teachingState,
    }),
    reviewContext: args.reviewContext,
    teachingState,
    turnPlan,
  };
}

export function classifyChatIntent(message: string): IntentMatch {
  const plan = buildChatTurnPlan(message);
  return {
    intent: plan.primaryIntent,
    confidence: plan.confidence,
    rationale: plan.rationale,
  };
}

export function buildChatTurnPlan(message: string): ChatTurnPlan {
  const normalized = message.trim().toLowerCase();
  const codeDisclosure = detectCodeDisclosure(message);
  const candidateVerification = detectCandidateVerificationRequest(message);
  const explicitExecution =
    !candidateVerification && detectExecutionEvidenceRequest(message);
  const signals: ChatTurnSignals = {
    explicitExecution,
    candidateVerification,
    hint: detectHintRequest(normalized),
    debug: detectDebugRequest(normalized),
    history: detectHistoryRequest(normalized),
    practice: detectPracticeRequest(normalized),
    optimization: detectOptimizationRequest(normalized),
    apiReference: detectApiReferenceRequest(message),
    handbookLookup: detectExplicitHandbookLookup(normalized),
    walkthrough: detectDeepReasoningRequest(message),
  };

  let intentMatch: IntentMatch;

  if (
    matches(
      normalized,
      /慌|焦虑|崩溃|绝望|不适合|太难了|难受|每次都错|老是写错|总是写错|i'?m anxious|panic|overwhelmed|not cut out|too hard/,
    )
  ) {
    intentMatch = {
      intent: "anxiety_or_stuck",
      confidence: 0.9,
      rationale: "The user is expressing anxiety or global stuckness.",
    };
  } else if (signals.hint && codeDisclosure === "guided") {
    intentMatch = {
      intent: "hint_request",
      confidence: 0.92,
      rationale: "The user is asking for guided help while preserving agency.",
    };
  } else if (signals.debug) {
    intentMatch = {
      intent: "execute_failed_ask",
      confidence: 0.9,
      rationale:
        "The user is asking Coach to diagnose a failed or confusing execution.",
    };
  } else if (
    (explicitExecution || candidateVerification) &&
    (!signals.walkthrough || detectExecutionEvidenceRequest(message))
  ) {
    intentMatch = {
      intent: "run_case_request",
      confidence: 0.86,
      rationale: "The user is asking for fresh execution evidence on a case.",
    };
  } else if (
    matches(
      normalized,
      /错题本|mistake\s*book|收录.*(?:这题|这个题|题目)|(?:这题|这个题|题目).*(?:收录|保存|复习)|加入.*(?:错题|mistake)|放进.*(?:错题|mistake)|save.*(?:problem|this).*mistake/,
    )
  ) {
    intentMatch = {
      intent: "mistake_book_save_request",
      confidence: 0.9,
      rationale: "The user explicitly wants to save the active problem to the Mistake Book.",
    };
  } else if (detectProfileMetaQuestion(normalized)) {
    intentMatch = {
      intent: "profile_meta_question",
      confidence: 0.94,
      rationale: "The user is asking what learner profile the coach actually knows.",
    };
  } else if (signals.history) {
    intentMatch = {
      intent: detectMistakeHistoryRequest(normalized)
        ? "past_mistake_recall_request"
        : "past_problem_recall_request",
      confidence: 0.84,
      rationale: detectMistakeHistoryRequest(normalized)
        ? "The user is asking about prior mistake evidence."
        : "The user is asking about prior problem or success history.",
    };
  } else if (signals.practice) {
    intentMatch = {
      intent: "practice_request",
      confidence: 0.86,
      rationale: "The user is asking for practice or recommendation guidance.",
    };
  } else if (signals.optimization) {
    intentMatch = {
      intent: "optimization_request",
      confidence: 0.84,
      rationale: "The user is opting into optimization or complexity discussion.",
    };
  } else if (signals.apiReference || signals.handbookLookup) {
    intentMatch = {
      intent: "api_reference_question",
      confidence: signals.apiReference ? 0.86 : 0.78,
      rationale: signals.apiReference
        ? "The user explicitly asked how to use a concrete language or API object."
        : "The user explicitly asked to query the Knowledge Handbook.",
    };
  } else if (
    matches(
      normalized,
      /为什么|为啥|怎么理解|不懂|什么意思|原理|区别|why|how come|what does.*mean|explain/,
    )
  ) {
    intentMatch = {
      intent: "concept_question",
      confidence: 0.87,
      rationale: "The user is asking why a concept or code rule works.",
    };
  } else if (
    matches(
      normalized,
      /还是不对|还是错|没过|报错|错在哪|bug|wrong answer|runtime error|compile error|失败|不通过|wa\b/,
    )
  ) {
    intentMatch = {
      intent: "debug_followup",
      confidence: 0.78,
      rationale: "The user is continuing a debugging thread.",
    };
  } else if (codeDisclosure === "full_code") {
    intentMatch = {
      intent: "full_code_request",
      confidence: 0.9,
      rationale: "The user explicitly requested complete code in this turn.",
    };
  } else {
    intentMatch = {
      intent: "general_followup",
      confidence: 0.58,
      rationale: "No stronger chat intent matched; answer as a focused follow-up.",
    };
  }

  return {
    primaryIntent: intentMatch.intent,
    confidence: intentMatch.confidence,
    rationale: intentMatch.rationale,
    codeDisclosure,
    signals,
    contextNeeds: buildContextNeeds(intentMatch.intent, signals),
    toolCapabilities: buildToolCapabilities(signals, normalized),
  };
}

function detectHintRequest(normalized: string): boolean {
  return matches(
    normalized,
    /提示|暗示|点拨|hint|不要答案|别给答案|别直接(?:给)?(?:答案|代码|题解)?|不要直接|不直接给|一点提示|小提示|引导|自己改|without.*answer|再(?:深入|具体|多).*一点|(?:next|deeper)\s+hint|(?:给|来|要|想要|求|帮我|教我|可以|能不能|能否).{0,12}(?:方向|思路提示)|只(?:给|要).{0,8}(?:方向|提示|思路|暗示|点拨)/,
  );
}

export function detectCodeDisclosure(message: string): CoachCodeDisclosure {
  const normalized = message.trim().toLowerCase();

  if (!normalized || isFutureOrConditionalCodePreference(normalized)) {
    return "guided";
  }

  if (
    matches(
      normalized,
      /(?:不要|别|禁止|先别|不用|无需|不许|不能|避免)(?:直接)?(?:给|写|发|贴|展示|输出|提供)?(?:我)?(?:完整|全部)?(?:的)?(?:代码|实现)|(?:without|no)\s+(?:full\s+|complete\s+)?code|(?:don['’]t|do not|never)\s+(?:show|give|write|provide|output|send)(?:\s+me)?(?:\s+the|\s+a)?(?:\s+(?:full|complete))?(?:\s+python)?\s+(?:implementation|code)/,
    )
  ) {
    return "guided";
  }

  if (
    /伪代码|pseudo[ -]?code/.test(normalized) &&
    !/(?:完整|full|complete).{0,12}(?:代码|code)|直接实现|implement (?:it )?directly/.test(
      normalized,
    )
  ) {
    return "guided";
  }

  return matches(
    normalized,
    /(?:给|写|展示|贴出|输出|提供|发)(?:我)?(?:一份|出)?(?:可运行的?)?(?:完整的?|全部的?)?\s*(?:python|c\+\+|cpp)?\s*(?:完整的?)?(?:实现|代码)|直接(?:给|写|展示|贴|输出|提供).{0,16}(?:代码|实现)|直接实现|(?:show|give|write|provide|output|send)(?:\s+me)?(?:\s+the|\s+a)?(?:\s+full|\s+complete|\s+runnable|\s+working)?(?:\s+python)?\s+(?:implementation|code)|implement (?:it )?directly/,
  )
    ? "full_code"
    : "guided";
}

function isFutureOrConditionalCodePreference(normalized: string) {
  return matches(
    normalized,
    /(?:以后|下次|往后|默认|平时).{0,36}(?:代码|实现|伪代码)|除非.{0,32}(?:代码|实现)|只有.{0,32}(?:明确|请求|索要|要).{0,24}(?:代码|实现)|(?:in the future|next time|by default).{0,48}(?:code|implementation)|unless.{0,48}(?:code|implementation)|only (?:if|when).{0,48}(?:code|implementation)/,
  );
}

function detectDebugRequest(normalized: string) {
  return matches(
    normalized,
    /怎么回事|帮我.*诊断|诊断一下|为什么.*(?:错|失败|没过|不通过|报错)|哪里错|错在哪|代码有什么问题|代码.*(?:有问题|有错)|没过|失败|不通过|报错|wrong answer|runtime error|compile error|time limit|memory limit|what(?:['’]s| is) wrong|diagnose|\b(?:this|my)\s+bug\b|\bstill\s+(?:broken|failing|wrong|not\s+working|happening)\b|\bwa\b|\bre\b|\btle\b/,
  );
}

function detectProfileMetaQuestion(normalized: string) {
  return matches(
    normalized,
    /你(?:对我|了解我|知道我).*(?:多少|什么)|你(?:知道|记得|了解)(?:我的)?(?:优点|缺点|强项|弱项|优势|短板)|我的(?:优点|缺点|强项|弱项|优势|短板)(?:是什么|有哪些)|how much (?:do )?you know about me|what do you know about me|do you know my (?:strengths?|weaknesses?|profile)|what are my (?:strengths?|weaknesses?)(?: and (?:strengths?|weaknesses?))?|you (?:do not|don't|dont|should|thought you|said you).{0,32}know.{0,24}(?:my )?(?:strengths?|weaknesses?|profile)|i thought you know.{0,24}(?:my )?(?:strengths?|weaknesses?|profile)/,
  );
}

function detectMistakeHistoryRequest(normalized: string) {
  return matches(
    normalized,
    /常犯|犯过|错题|类似(?:的)?错误|(?:栽|踩)(?:过)?坑|(?:以前|之前|上次|历史|经常|反复|回忆).{0,32}(?:错误|失败|没过|弱点|栽坑|踩坑)|(?:错误|失败|没过|弱点|栽坑|踩坑).{0,32}(?:以前|之前|上次|历史|经常|反复)|made this mistake|mistake history|previous mistakes?|past mistakes?|(?:have|did) i.{0,96}(?:mistake|error)|(?:mistake|error).{0,48}(?:before|previously|in the past)|recurring mistakes?|my weaknesses?/,
  );
}

function detectSuccessfulOrProblemHistoryRequest(normalized: string) {
  return matches(
    normalized,
    /做过.*(?:题|问题)|类似题|相似题|以前.*(?:做得好|优点|强项|成功)|之前.*(?:做得好|优点|强项|成功)|done well|strengths?|successful|similar (?:problem|question)|worked on before|solved before/,
  );
}

function detectHistoryRequest(normalized: string) {
  return matches(
    normalized,
    /以前|之前|上次|历史|经常|常犯|反复|犯过|(?:栽|踩)(?:过)?坑|类似(?:的)?(?:错误|问题)|回忆.{0,24}(?:错误|问题|犯过|之前|以前|上次|历史)|made this mistake|mistake history|previous mistake|past mistakes?|(?:my|our) (?:mistake )?history|last time|(?:have|did) i.{0,96}(?:mistake|error|bug).{0,48}(?:before|previously|in the past)|(?:have|did) i.{0,96}(?:before|previously|in the past)/,
  );
}

function detectPracticeRequest(normalized: string) {
  return matches(
    normalized,
    /下一题|推荐.*题|练习|练.*题|再练|同类型|同类|巩固|刷题|practice|next problem|what should i practice|(?:(?:找|搜|查|给(?:我)?|推荐|出|来|想(?:看|要)|需要|有没有).{0,16}(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?)|(?:这|当前)(?:道)?题.{0,16}(?:有(?:哪些|什么|没?有)|还有没有|能不能).{0,12}(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?)|(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?).{0,12}(?:有哪些|怎么找|推荐|来(?:一|两|几|\d+)?(?:道|个)?))|\b(?:find|search|show|give|recommend|suggest|want|need|any|what)\b.{0,48}\b(?:variants?|variations?|follow[- ]?ups?|twists?)\b|\b(?:variants?|variations?|follow[- ]?ups?|twists?)\b.{0,32}\b(?:for|of|to|this|current|the)\b.{0,24}\b(?:problem|question)\b/,
  );
}

function detectOptimizationRequest(normalized: string) {
  return matches(
    normalized,
    /优化|最优|复杂度|更好.*写法|面试.*写法|better approach|optimi[sz]e|time complexity|space complexity|o\(/,
  );
}

/** API lookup requires both an asking action and a concrete API object. */
export function detectApiReferenceRequest(message: string) {
  const raw = message.trim();
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return false;
  }

  const hasLanguageObject = matches(
    normalized,
    /(?:^|[^a-z0-9_])(?:python|c\+\+|cpp|stl)(?:$|[^a-z0-9_])/,
  );
  const hasApiObject = matches(
    normalized,
    /collections(?:\.deque)?|heapq|unordered_map|priority_queue|\bvector\b|\bdeque\b|\bqueue\b|\bset\b|\bmap\b|\bdict\b|\blist\b|\btuple\b|队列|双端队列|优先队列|堆|集合|字典|映射|容器|库|函数|方法|`[^`]+`|\b[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b[a-z_][a-z0-9_]*\s*\(\s*\)/,
  ) || /\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(raw);
  const hasApiSpecificAction = matches(
    normalized,
    /语法(?:是什么|怎么|如何)?|用法(?:是什么|怎么|如何)?|\bapi\b|怎么用|如何使用|如何调用|怎么调用|如何导入|怎么导入|如何初始化|怎么初始化|(?:怎么|如何)(?:从|向|在).{0,32}(?:弹出|加入|添加|插入|删除|获取|访问)|参数(?:是什么|有哪些|怎么传)?|返回值(?:是什么|类型)?|syntax|usage|how (?:do i|to) (?:use|call|import|initiali[sz]e)|parameters?|return value/,
  );
  const hasWriteAction = matches(
    normalized,
    /怎么写|如何写|what.*(?:syntax|api)|how (?:do i|to) write/,
  );

  return (
    (hasApiSpecificAction && (hasLanguageObject || hasApiObject)) ||
    (hasWriteAction && hasApiObject)
  );
}

function detectExplicitHandbookLookup(normalized: string) {
  return matches(
    normalized,
    /(?:查询|查一下|查找|搜索|检索|打开).{0,12}(?:知识手册|handbook)|(?:知识手册|handbook).{0,12}(?:查询|查一下|查找|搜索|检索)/,
  );
}

function detectCandidateVerificationRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  const asksToVerify = matches(
    normalized,
    /验证|测试|运行|跑一下|试一下|check|verify|test|run|execute/,
  );
  const namesAssistantCandidate = matches(
    normalized,
    /你(?:刚才|之前|前面)?(?:给|写|提供|生成|建议|改)(?:的)?(?:完整)?(?:代码|实现|版本|方案)|assistant(?:'s)? (?:candidate|code|implementation)|your (?:candidate|code|implementation|version)|你改完的代码|你的(?:改法|修改|候选(?:代码|实现)?|版本)|(?:this|the) candidate(?: edit| code| implementation)?|这个(?:改法|修改|候选(?:代码|实现)?|版本)/,
  );
  return asksToVerify && namesAssistantCandidate;
}

function buildToolCapabilities(
  signals: ChatTurnSignals,
  normalized: string,
): ChatTurnPlan["toolCapabilities"] {
  const capabilities: Array<ChatTurnPlan["toolCapabilities"][number]> = [];

  if (signals.explicitExecution) {
    capabilities.push("run_current_code");
  }
  if (signals.candidateVerification) {
    capabilities.push("verify_proposed_repair");
  }
  if (signals.hint) {
    capabilities.push("get_algorithm_hint");
  }
  if (signals.apiReference || signals.handbookLookup) {
    capabilities.push("lookup_api_reference");
  }
  if (signals.history) {
    const mistake = detectMistakeHistoryRequest(normalized);
    const problem = detectSuccessfulOrProblemHistoryRequest(normalized);
    if (problem || !mistake) capabilities.push("past_problem_recall");
    if (mistake) capabilities.push("past_mistake_recall");
  }
  if (signals.practice) {
    capabilities.push(
      "find_practice_problem",
      "search_interview_variant_candidates",
    );
  }

  return capabilities;
}

function buildContextNeeds(
  intent: CoachChatIntent,
  signals: ChatTurnSignals,
): ChatTurnContextNeeds {
  const diagnostic =
    intent === "execute_failed_ask" || intent === "debug_followup";
  const guidedProblemWork =
    intent === "hint_request" ||
    intent === "concept_question" ||
    intent === "anxiety_or_stuck";
  const workspace =
    diagnostic ||
    guidedProblemWork ||
    signals.explicitExecution ||
    signals.candidateVerification ||
    signals.walkthrough ||
    intent === "optimization_request" ||
    intent === "full_code_request" ||
    intent === "mistake_book_save_request" ||
    intent === "general_followup";

  return {
    workspace,
    currentCode:
      diagnostic ||
      guidedProblemWork ||
      signals.explicitExecution ||
      signals.candidateVerification ||
      signals.walkthrough ||
      intent === "mistake_book_save_request" ||
      intent === "optimization_request",
    selectedTests: diagnostic || signals.explicitExecution,
    runEvidence: diagnostic || signals.explicitExecution,
    reviewContext: diagnostic || guidedProblemWork || signals.walkthrough,
    learnerSignals:
      !signals.apiReference &&
      !signals.handbookLookup &&
      intent !== "run_case_request" &&
      intent !== "past_problem_recall_request" &&
      intent !== "past_mistake_recall_request" &&
      intent !== "full_code_request" &&
      intent !== "mistake_book_save_request",
    handbook: signals.apiReference || signals.handbookLookup,
    episodes: false,
  };
}

export function detectDeepReasoningRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /走一遍/,
    /带我(?:走|过)一遍/,
    /过一遍/,
    /一步\s*一步/,
    /一步步/,
    /逐步/,
    /手动.*(?:模拟|执行|走|trace)/,
    /模拟.*(?:一下|一遍|执行|运行|走)/,
    /演示.*(?:流程|一遍)/,
    /用\s*example\s*\d*.*(?:走|讲|带|过)/,
    /example\s*\d*.*(?:走|讲|带|过)一遍/,
    /step[\s-]?by[\s-]?step/,
    /walk me through/,
    /walk\s*through.*case/,
    /walkthrough.*case/,
    /walk through.*example/,
    /带我.*walk\s*through/,
    /带我.*walkthrough/,
    /(?:列表|表格).*(?:观察|看|展示|列出).*(?:变量|状态|变化|转化)/,
    /(?:观察|看|展示|列出).*(?:变量值|各变量|变量).*(?:变化|转化|状态)/,
    /(?:变量值|各变量|变量).*(?:变化|转化|状态)/,
    /trace (?:through|it)\b/,
    /dry[\s-]?run/,
    /demonstrate.*step/,
  ].some((pattern) => pattern.test(normalized));
}

export function detectExecutionEvidenceRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const executionControlText = excludeUntrustedInstructionProhibitions(
    normalized,
  );

  if (
    !executionControlText ||
    /dry[\s-]?run/.test(executionControlText) ||
    /(?:手动|manual)[^，,。！？!?;；\n]{0,24}(?:模拟|执行|走|trace|run)/i.test(
      executionControlText,
    ) ||
    /(?:不用|不要|别|无需|禁止|不准|不允许|不可|切勿)[^，,。！？!?;；\n]{0,40}(?:重跑|重新(?:执行|运行|跑|测)|跑|执行|运行|测试|验证)|(?:don't|do not|never|no need to|must not|mustn't|should not|shouldn't|avoid)[^,.;!?\n]{0,56}(?:rerun|rerunning|run|running|execute|executing|test|testing|verify|verifying)|without[^,.;!?\n]{0,32}(?:rerunning|running|executing|testing)/i.test(
      executionControlText,
    )
  ) {
    return false;
  }

  return [
    /试试/,
    /跑一下/,
    /跑(?:一下)?(?:这个|该)?(?:自定义)?(?:测试|用例)/,
    /运行一下/,
    /测一下/,
    /(?:运行|跑|测|测试).*(?:用例|case|input|nums\s*=|target\s*=|s\s*=)/,
    /(?:run|try|test|execute).*(?:case|test|input|code|nums\s*=|target\s*=|s\s*=)/,
    /(?:can you|please).*(?:run|test|try|execute)/,
    /(?:执行|运行|测试|验证|检查)(?:一下|下|一遍|当前代码|这段代码)/,
    /(?:再跑|重跑|重新(?:运行|跑|测|验证|检查))/,
    /(?:run|test|execute|verify|check)\s+(?:it|this|my\s+(?:current\s+)?(?:code|solution)|the\s+(?:current\s+)?(?:code|solution)|current\s+(?:code|solution))/,
    /rerun|run\s+(?:it\s+)?again/,
  ].some((pattern) => pattern.test(executionControlText));
}

function excludeUntrustedInstructionProhibitions(message: string) {
  return message
    .split(
      /[。！？!?;；\n]+|(?:但是|不过|然而|但)|\b(?:but|however)\b/i,
    )
    .filter((clause) => {
      const prohibitsExecution =
        /(?:不要|别|禁止|不准|不允许|不可|切勿|绝对不要).{0,32}(?:执行|运行|照做)|\b(?:don't|do not|never|must not|mustn't|should not|shouldn't|avoid)\b.{0,48}\b(?:execute|run|follow|obey)\b/i.test(
          clause,
        );
      const targetsUntrustedInstruction =
        /stderr|stdout|输出|错误信息|系统指令|恶意指令|破坏性命令|指令|命令|攻击|payload|untrusted|instruction|command/i.test(
          clause,
        );
      return !(prohibitsExecution && targetsUntrustedInstruction);
    })
    .join(" ")
    .trim();
}

export function detectVisibleSelfCorrectionMarker(markdown: string) {
  const normalized = markdown.toLowerCase();

  return [
    /我(?:刚才|之前)?走错/,
    /(?:让我|我来)重新(?:看|走|算)/,
    /抱歉.{0,16}(?:之前|刚才|漏|错)/,
    /(?:刚才|之前|前面).{0,16}(?:漏|错)/,
    /不对.{0,16}(?:重新|应该)/,
    /actually,?\s*wait/,
    /let me restart/,
    /i (?:made a mistake|was wrong)/,
    /sorry.{0,40}(?:missed|wrong|earlier)/,
    /scratch that/,
  ].some((pattern) => pattern.test(normalized));
}

function buildTeachingState(args: {
  intent: CoachChatIntent;
  problemTags: string[];
  memory: CoachMemoryBrief;
  lastRunResult?: CodeRunResult;
  reviewContext?: CoachReviewContext;
  currentHintLevel: number;
}): CoachTeachingState {
  const currentConcept =
    args.reviewContext?.currentConcept ??
    args.reviewContext?.skillTags[0] ??
    args.problemTags[0];

  return {
    currentConcept,
    hintLevel: args.currentHintLevel,
    nextAction: inferNextAction(args),
    progressSignal: inferProgressSignal(args),
  };
}

function buildPolicy(args: {
  intentMatch: IntentMatch;
  codeDisclosure: CoachCodeDisclosure;
  reviewContext?: CoachReviewContext;
  teachingState: CoachTeachingState;
}): CoachChatPolicy {
  const base = basePolicy(args.intentMatch);

  return {
    ...base,
    codeDisclosure: args.codeDisclosure,
    avoid: [
      ...base.avoid,
      "Do not switch into a fixed Review template unless the user explicitly asks for a full review-style diagnosis.",
      "Do not claim hidden-test acceptance or guaranteed correctness.",
    ],
  };
}

function basePolicy(
  intentMatch: IntentMatch,
): Omit<CoachChatPolicy, "codeDisclosure"> {
  switch (intentMatch.intent) {
    case "concept_question":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Answer the specific why/how question directly.",
        responseShape: "Short explanation, one concrete example, then one takeaway.",
        tone: "calm and precise",
        maxMainPoints: 2,
        mustDo: [
          "Directly answer the user's question before adding extra context.",
          "Keep the explanation anchored to one concrete example.",
        ],
        avoid: ["Do not restate the whole review.", "Do not paste a full solution."],
        nextStepStyle: "End with the one rule or check the user should apply next.",
      };
    case "hint_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "hint",
        primaryGoal: "Give the smallest useful hint while preserving the user's chance to solve.",
        responseShape: "One hint, optionally one tiny example, then a focused prompt back to the user.",
        tone: "encouraging and restrained",
        maxMainPoints: 1,
        mustDo: [
          "Respect requests such as 'do not give the answer'.",
          "Keep the hint at the next useful level, not the full solution.",
          "Aim the hint toward a technically relevant data structure or algorithm the learner already knows from their Strengths.",
          "If the needed technique is a known Weakness, scaffold it from a related Strength instead of assuming fluency.",
        ],
        avoid: ["Do not reveal complete code.", "Do not jump to optimization."],
        nextStepStyle: "Ask the user to modify exactly one branch, invariant, or line.",
      };
    case "anxiety_or_stuck":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "reassuring",
        primaryGoal: "Reduce cognitive load and turn the problem into one small action.",
        responseShape: "Validate briefly, name the narrow blocker, give one small task.",
        tone: "warm, steady, and non-judgmental",
        maxMainPoints: 1,
        mustDo: [
          "Do not add more concepts than necessary.",
          "Frame the blocker as a learnable local pattern, not a global ability problem.",
          "Aim the next small action toward a technically relevant data structure or algorithm the learner already knows from their Strengths.",
          "If the needed technique is a known Weakness, scaffold it from a related Strength instead of assuming fluency.",
        ],
        avoid: ["Do not lecture.", "Do not output a long solution."],
        nextStepStyle: "End with a tiny next action the user can do immediately.",
      };
    case "run_case_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "diagnostic",
        primaryGoal: "Handle run/verify requests in an evidence-first diagnostic style.",
        responseShape: "Summarize the tool evidence, explain what it means, then give one next edit or conclusion.",
        tone: "evidence-driven and concise",
        maxMainPoints: 2,
        mustDo: [
          "When run evidence is present, summarize the observed behavior before interpreting it.",
          "Distinguish chat run evidence from a full Review submission.",
        ],
        avoid: ["Do not run a full review pipeline.", "Do not guarantee acceptance."],
        nextStepStyle: "End with either the observed result or one next debug step.",
      };
    case "execute_failed_ask":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "diagnostic",
        primaryGoal: "Diagnose the concrete failure before teaching.",
        responseShape:
          "Use the same soft diagnostic beats as Review: root cause, concrete trace, one minimal next edit.",
        tone: "evidence-driven, calm, and concise",
        maxMainPoints: 2,
        mustDo: [
          "Use the soft diagnostic beats and give exactly one next edit to try.",
        ],
        avoid: ["Do not run a full review pipeline.", "Do not paste full code."],
        nextStepStyle: "End with the next line, branch, or condition to inspect.",
      };
    case "debug_followup":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "diagnostic",
        primaryGoal: "Continue debugging from the latest evidence without repeating the whole review.",
        responseShape: "Point to the most likely blocker, cite evidence, suggest one small edit.",
        tone: "practical and focused",
        maxMainPoints: 2,
        mustDo: ["Continue from the user's latest concern instead of restarting the whole lesson."],
        avoid: ["Do not give multiple alternative fixes.", "Do not paste full code."],
        nextStepStyle: "End with the next line or condition to inspect.",
      };
    case "optimization_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Explain the optimization path the user opted into.",
        responseShape: "State the current approach, the better invariant/data structure, and the first transition step.",
        tone: "clear and interview-oriented",
        maxMainPoints: 3,
        mustDo: ["Make clear this is opt-in optimization after the current blocker."],
        avoid: ["Do not overwhelm with several unrelated approaches."],
        nextStepStyle: "End with the first optimization step, not necessarily complete code.",
      };
    case "full_code_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Provide the explicitly requested complete code while still explaining the key idea.",
        responseShape: "Key idea, concise code if useful, then a quick correctness check.",
        tone: "direct and helpful",
        maxMainPoints: 3,
        mustDo: ["Keep the solution tied to the active problem and language context."],
        avoid: ["Do not claim hidden-test acceptance."],
        nextStepStyle: "End with a short test or invariant the user can check.",
      };
    case "practice_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "practice-planning",
        primaryGoal: "Recommend focused practice that matches the user's current state.",
        responseShape: "Name focused recommendations, give why each fits, and separate reinforce vs advance.",
        tone: "supportive and selective",
        maxMainPoints: 3,
        mustDo: [
          "Keep recommendations metadata-only; do not treat them as runnable MVP problems.",
          "Respect explicit quantity constraints such as '两道', 'one', or '别太多'; if the tool returns more candidates, choose only the requested count.",
        ],
        avoid: ["Do not recommend a long list."],
        nextStepStyle: "End by naming the first recommended problem to attempt.",
      };
    case "past_problem_recall_request":
    case "past_mistake_recall_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "diagnostic",
        primaryGoal: "Answer recurring-mistake questions with compact evidence and a prevention rule.",
        responseShape: "Summarize the pattern, cite compact evidence, give one prevention rule.",
        tone: "matter-of-fact and encouraging",
        maxMainPoints: 2,
        mustDo: ["Do not overstate memory confidence beyond returned evidence."],
        avoid: ["Do not shame the user.", "Do not invent history."],
        nextStepStyle: "End with a reusable check for this mistake type.",
      };
    case "profile_meta_question":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "State exactly what the coach knows about the learner and where each claim comes from.",
        responseShape: "Separate self-reported preferences, earned evidence, and unknown identity details.",
        tone: "transparent and precise",
        maxMainPoints: 3,
        mustDo: [
          "Label self-reported profile cues separately from earned cross-problem evidence.",
          "Say when there is not enough trusted evidence to infer a strength or weakness.",
        ],
        avoid: [
          "Do not import the active problem or current code unless the user asks about it.",
          "Do not present a machine tag as a human trait.",
        ],
        nextStepStyle: "End with at most one invitation to correct or add a preference.",
      };
    case "mistake_book_save_request":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Save the active problem to the Mistake Book with a compact problem-specific guide.",
        responseShape: "Confirm the save, summarize what was captured, and point to the Mistake Book.",
        tone: "practical and reassuring",
        maxMainPoints: 2,
        mustDo: [
          "Use the Mistake Book save tool before claiming the problem was saved.",
          "Keep the saved guide problem-specific, not a reusable API note.",
        ],
        avoid: ["Do not route this to the Knowledge Handbook.", "Do not paste a full official solution."],
        nextStepStyle: "End by saying the entry is available in the Mistake Book.",
      };
    case "api_reference_question":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Answer the language/API question directly; use the narrow local cheat sheet only when it covers the topic.",
        responseShape: "Give the exact API pattern, one tiny example, and one pitfall.",
        tone: "concise and practical",
        maxMainPoints: 2,
        mustDo: [
          "Answer the API/syntax question directly before adding any active-problem commentary.",
          "Keep API examples small and relevant to the active language.",
        ],
        avoid: [
          "Do not use web search.",
          "Do not switch languages unless asked.",
          "Do not continue the current problem/debugging plan unless the user explicitly asks for it.",
        ],
        nextStepStyle: "End with the exact snippet or container choice to try.",
      };
    case "general_followup":
      return {
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
        rationale: intentMatch.rationale,
        styleMode: "concise",
        primaryGoal: "Answer the follow-up in the shortest useful way.",
        responseShape: "Direct answer, one supporting detail, one next step.",
        tone: "friendly and focused",
        maxMainPoints: 2,
        mustDo: ["Stay anchored to the active problem and recent conversation."],
        avoid: ["Do not expand into a full lesson unless the user asks."],
        nextStepStyle: "End with one useful next action.",
      };
  }
}

function inferNextAction(args: {
  intent: CoachChatIntent;
  lastRunResult?: CodeRunResult;
  reviewContext?: CoachReviewContext;
}) {
  if (args.intent === "hint_request") {
    return "give_the_next_hint_without_solving";
  }

  if (args.intent === "run_case_request") {
    return "gather_or_explain_fresh_run_evidence";
  }

  if (args.intent === "execute_failed_ask") {
    return "run_visible_tests_then_diagnose";
  }

  if (args.intent === "anxiety_or_stuck") {
    return "shrink_to_one_small_debugging_task";
  }

  if (args.intent === "practice_request") {
    return "recommend_reinforce_or_advance_practice";
  }

  if (args.intent === "mistake_book_save_request") {
    return "save_active_problem_to_mistake_book";
  }

  if (args.lastRunResult?.status === "passed_visible_tests") {
    return "offer_edge_case_or_opt_in_optimization";
  }

  if (args.reviewContext?.failedCaseSummary) {
    return "focus_on_latest_failed_case";
  }

  return "answer_current_follow_up";
}

function inferProgressSignal(args: {
  lastRunResult?: CodeRunResult;
  reviewContext?: CoachReviewContext;
}) {
  if (args.lastRunResult?.status === "passed_visible_tests") {
    return "latest_visible_or_interpret_run_passed";
  }

  if (args.reviewContext?.runStatus && args.reviewContext.runStatus !== "passed_visible_tests") {
    return "latest_review_still_has_a_blocker";
  }

  return undefined;
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value);
}
