import type {
  DisclosureCeiling,
  EffectDenial,
  PythonOnlyScope,
  SignalEvidence,
  TurnClauseV2,
  TurnDiscourse,
} from "./turn-understanding-v2.types";
import { hasNegationScope } from "./evidence/negation-scope";
import { maskProtectedProseV2 } from "./protected-prose-v2";

type EvidencePattern = {
  kind: string;
  pattern: RegExp;
  strength: SignalEvidence["strength"];
};

export type ClauseSignalsV2 = ReturnType<typeof annotateClauseSignalsV2>;

const PATTERNS = {
  hint: defs("hint_request", "hard", [
    /(?:提示|暗示|点拨|引导)(?!级别|等级|状态)/giu,
    /(?:给|来)(?:我)?(?:一小步|一个|一点|点|个|些|更进一步)?(?:提示|暗示|思路|方向)(?!级别|等级|状态)|(?:请|麻烦)(?:你)?(?:提示|暗示|点拨|引导)我|(?:提示|暗示|点拨|引导)我|(?:想要|需要|要)(?:一个|一点|点)?(?:提示|暗示)(?!级别|等级|状态)|(?:就|只|稍微|略微){1,3}\s*(?:提示|暗示|点拨|引导)(?:一下)?|伪代码.{0,4}提示|提示.{0,4}伪代码/giu,
    /\b(?:give|show)\s+me\s+(?:(?:a|an|some|one)\s+)?(?:small\s+)?(?:hints?|clues?|nudges?)\b(?!\s+(?:level|status))|\b(?:can|could|may)\s+i\s+(?:get|have)\s+(?:a\s+)?(?:hint|clue|nudge)\b|\b(?:i\s+)?(?:want|need|would like)\s+(?:a\s+|some\s+)?(?:hint|clue|nudge)\b|\b(?:hint|nudge)\s+me\b/giu,
  ]),
  diagnose: defs("diagnose_request", "hard", [
    /诊断|调试|(?:代码|实现|逻辑).{0,12}(?:错在哪|哪里错|什么错|有问题)|错在哪|哪里错|还是(?:错|不对|失败|没过)|报错|报\s*TypeError|TypeError|失败原因|为什么.{0,8}(?:失败|出错|没过)|不通过|没过|\bbug\b/giu,
    /\b(?:diagnose|wrong answer|runtime error|compile error|still (?:failing|wrong|broken)|why is .{0,24} still happening|why (?:is|does).{0,32}(?:wrong|fail)|what(?:'s| is) wrong|debug)\b/giu,
  ]),
  optimize: defs("optimize_request", "hard", [
    /优化|更快|更省空间|优雅写法|更优雅|代码很零碎|降低.{0,8}(?:时间|空间|复杂度)/giu,
    /\boptimi[sz]e\b|\b(?:reduce|improve).{0,16}\bcomplexity\b|make (?:it|this).{0,12}faster/giu,
  ]),
  explain: defs("explain_request", "hard", [
    /解释|讲解|说明|为什么|为啥|怎么理解|什么意思|啥含义|什么含义|怎么防|原理|区别|有何不同|有什么不同|怎么回事/giu,
    /\bexplain\b|\bwhy\b|how come|what does .{0,32} mean|walk\s*through/giu,
  ]),
  solve: defs("solve_request", "hard", [
    /(?:^|请|麻烦|帮我|能否|能不能)\s*(?:你)?(?:给|写|提供|展示|输出)(?:我)?.{0,12}(?:答案|解法|题解|实现|代码)|(?:^|请|帮我)\s*(?:你)?(?:怎么做|做一下|解决|直接实现|实现一下)|我该如何.{0,24}(?:做|解)(?:这个|这道|这)?题/giu,
    /\b(?:help me|guide me)\s+(?:to\s+)?solve\b/giu,
    /(?:^|\b(?:please|can you|could you)\s+)(?:solve|implement)\b|(?:^|\b(?:please|can you|could you)\s+)(?:give|show|provide|write)\s+me\b.{0,24}\b(?:answer|code|implementation|solution)\b/giu,
  ]),
  fullImplementation: defs("full_implementation", "hard", [
    /(?:给|写|提供|展示|输出|发)(?:我)?(?:一份|这个|这份)?(?:完整|全部|整份)(?:的)?(?:代码|实现|答案)|(?:我)?(?:想要|需要|要)(?:一份)?(?:完整|全部|整份)(?:的)?(?:代码|实现|答案)/giu,
    /\b(?:give|show|write|provide|send)\s+(?:me\s+)?(?:the\s+|a\s+)?(?:full|complete)\s+(?:python\s+)?(?:code|implementation|solution)\b|\b(?:i\s+)?(?:want|need|would like)\s+(?:the\s+|a\s+)?(?:full|complete)\s+(?:python\s+)?(?:code|implementation|solution)\b/giu,
  ]),
  pseudocode: defs("pseudocode_request", "hard", [
    /伪代码/giu,
    /pseudo[ -]?code/giu,
  ]),
  patch: defs("patch_request", "hard", [
    /最小修改|最小改动|补丁|只改.{0,8}(?:这一处|这几行)/giu,
    /\b(?:minimal patch|smallest fix|patch)\b/giu,
  ]),
  trace: defs("trace_request", "hard", [
    /(?:变量|指针|下标|状态).{0,16}(?:变化|轨迹|过程)|(?:手动|一步一步|一步步).{0,12}(?:走|跟踪|模拟)|walk\s*through/giu,
    /\b(?:trace|walk(?:\s+me)?\s+through)\b/giu,
  ]),
  count: defs("requested_count", "hard", [
    /(?:\b\d+\b|[一两二三])\s*(?:个|条|道)?\s*(?:同类|类似|相似)?\s*(?:提示|暗示|题|例子|要点|步骤)/giu,
    /\b(?:one|two|three|\d+)\s+(?:hints?|clues?|problems?|examples?|points?|steps?)\b/giu,
  ]),
  recallProblem: defs("past_problem_recall", "hard", [
    /(?:以前|之前|过去|上次|曾经).{0,24}(?:做过|做的|刷过|写过).{0,20}(?:题|问题)|昨天.{0,24}(?:用过|用的|写过)|做过.{0,16}(?:类似|相似).{0,8}题|(?:查|找|回忆|看看|列出).{0,16}(?:以前|之前|过去).{0,12}(?:做过|做的|刷过|写过).{0,12}(?:题|问题)/giu,
    /\b(?:previously|before|in the past)\b.{0,40}\b(?:solved|worked on|did)\b|\bmy\s+(?:past\s+|prior\s+|previous\s+)?problem history\b|\b(?:check|show|search|recall|find|look at|review|revisit|go over)\s+(?:my\s+)?(?:(?:past|prior|previous)\s+)?(?:problems?|problem history)\b|\b(?:check|show|search|recall|find|look at|review|revisit|go over)\s+(?:my\s+)?(?:(?:past|prior|previous)\s+)?(?:problem\s+)?history\b/giu,
  ]),
  recallMistake: defs("past_mistake_recall", "hard", [
    /(?:以前|之前|过去|上次|老问题|常).{0,30}(?:错|毛病|问题|栽过|栽坑|踩过坑|踩坑|漏过|犯过|记混|搞混)|(?:bug|错|毛病).{0,16}(?:老问题|以前|之前)|是不是我(?:以前|之前).{0,24}(?:那种|一样|错|毛病|问题|栽过|栽坑|踩坑|漏过)|是不是我.{0,24}(?:错|毛病|问题|栽过|栽坑|踩坑|漏过)|我是不是.{0,20}(?:把|将).{1,20}(?:搞混|记混)|我以前是不是也.{0,20}(?:栽过|栽在|栽坑|踩坑)/giu,
    /\b(?:my|i).{0,30}(?:past|prior|previous|old|usual|same|recent).{0,24}(?:mistake|bug|error|issue|history)|(?:have|did) i .{0,40}(?:mistake|bug|error|issue).{0,20}(?:before|previously)|\b(?:check|show|search|recall|find|look at|review|revisit|go over)\s+(?:my\s+)?(?:(?:past|prior|previous|old|usual)\s+)?(?:mistakes?|bugs?)(?:\s+history)?\b|\b(?:resembles?|similar to|like)\b.{0,32}\bmy\s+(?:past|prior|previous|old)\s+(?:mistakes?|bugs?)\b/giu,
  ]),
  recommend: defs("practice_recommendation", "hard", [
    /(?:再|想|给我|推荐).{0,12}(?:刷|练|来|做).{0,12}(?:题|道)|(?:推荐|给我推荐|为我推荐).{0,20}(?:练习题|题目|题)(?!目)(?!(?:的)?(?:解法|题解|答案|代码|思路|方法|算法|API))|推荐.{0,12}(?:两|二|三|几|\d+)(?:道|个)?(?:同类|类似|相似)?题|(?:有没有|还有|换|再来|来)(?:(?:其他|其它|别的|另外|更多|同类|类似|相似|相关|进阶|简单|难一点)?(?:一|两|二|三|几|\d+)?|(?:一|两|二|三|几|\d+)(?:道|个)?(?:其他|其它|别的|另外|更多|同类|类似|相似|相关|进阶|简单|难一点)?)(?:道|个)?(?:练习题|题目|题)|(?:下一个|下一道|下一)(?:练习题|题目|题)|(?:再给我|给我).{0,8}(?:两|二|三|几|\d+)?(?:题|道)|(?:两|二|三|几|\d+)(?:题|道).{0,8}巩固|(?:刷|练).{0,12}(?:两|二|三|几|\d+)道|巩固.{0,8}(?:题|练习)/giu,
    /\b(?:recommend|give me|want).{0,28}(?:practice|problems?|exercises?)\b|\b(?:what should i )?practice next\b|\bmore (?:practice )?problems?\b/giu,
    // Variant terms need an asking/recommendation shape. A bare “这个变体”
    // often asks for an explanation of a known variant rather than discovery.
    /(?:(?:找|搜|查|给(?:我)?|推荐|出|来|想(?:看|要)|需要|有没有).{0,16}(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?)|(?:这|当前)(?:道)?题.{0,16}(?:有(?:哪些|什么|没?有)|还有没有|能不能).{0,12}(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?)|(?:变体|变式|变题|变形题|追问|后续题|follow[- ]?ups?).{0,12}(?:有哪些|怎么找|推荐|来(?:一|两|几|\d+)?(?:道|个)?))/giu,
    /\b(?:find|search|show|give|recommend|suggest|want|need|any|what)\b.{0,48}\b(?:variants?|variations?|follow[- ]?ups?|twists?)\b|\b(?:variants?|variations?|follow[- ]?ups?|twists?)\b.{0,32}\b(?:for|of|to|this|current|the)\b.{0,24}\b(?:problem|question)\b/giu,
  ]),
  api: defs("api_reference", "hard", [
    /\b(?:heapq|deque|counter|defaultdict|priority_queue|unordered_map|bisect|collections)\b/giu,
    /(?:容器|队列|堆|map).{0,24}(?:API|写法|语法|声明|怎么.{0,6}(?:写|用)|用法|区别)|最大堆|(?:API|语法|声明|模板).{0,16}(?:想不起来|忘了|怎么写)/giu,
    /python.{0,20}(?:怎么|如何).{0,20}(?:队列|堆|容器)|(?:队列|堆|容器).{0,20}(?:怎么|如何).{0,20}(?:弹出|加入|声明|使用)/giu,
    /(?:Python\s*)?切片(?:.{0,12}(?:用法|语法|怎么用|如何用))?|\bslic(?:e|ing)\b/giu,
  ]),
  concept: defs("concept_target", "soft", [
    /(?:动态规划|双指针|滑动窗口|二分(?:查找|搜索)?|回溯|并查集|拓扑排序|广度优先搜索|深度优先搜索|哈希(?:表|集合)?|单调(?:栈|队列)|前缀和|贪心|递归|图搜索)/giu,
    /\b(?:dynamic programming|two pointers?|sliding window|binary search|backtracking|union[ -]?find|topological sort|breadth[ -]?first search|depth[ -]?first search|hash(?:ing| map| set)?|monotonic (?:stack|queue)|prefix sum|greedy|recursion|graph search|dfs|bfs|dp)\b/giu,
  ]),
  profile: defs("learner_profile", "hard", [
    /你(?:知道|了解|记得).{0,10}我|我的学习画像|我(?:的)?.{0,8}(?:强项|弱项)/giu,
    /what do you know about me|my learner profile|my (?:strengths|weaknesses)/giu,
  ]),
  execute: defs("execute_request", "hard", [
    /(?:^|请|麻烦|帮我|给我|你可以|能否|能不能|先|再|还是|然后|接着|顺手|而)\s*(?:你)?(?:只|一步一步|一步步|实际|重新)?(?:运行(?!结果|证据|状态|历史|时间|复杂度|得)|执行(?!结果|证据|状态|历史)|跑(?!步)(?:一下|一遍)?|测试(?=一下|一遍|当前|这个|这份|我的|代码|它)|验证(?:一下)?(?=.{0,20}(?:代码|实现|改法|候选|输出|结果|case|test))|校验(?:一下)?(?=.{0,20}(?:代码|实现|改法|候选|输出|结果|case|test)))/giu,
    /把.{0,16}(?:跑一下|跑一遍|运行一下|执行一下|测试一下|验证一下|校验一下)/giu,
    /(?:^|\b(?:please|then|also|and|now|could you|can you)\s+)(?:actually\s+)?(?:run|execute|rerun)(?!-|\s+(?:result|output|evidence|history|time|through))\b|(?:^|\b(?:please|then|also|and|now|could you|can you)\s+)verify\s+(?:it\b|this\s+(?:code|change|edit|candidate|output)\b|(?:my(?:\s+current)?|current|your|the selected)\s+(?:code|change|edit|candidate|output|tests?)\b)|(?:^|\b(?:please|then|also|and|now|could you|can you)\s+)test\s+(?:it\b|this\s+(?:code|change|edit|candidate)\b|(?:my(?:\s+current)?|current|your|the selected)\s+(?:code|change|edit|candidate|tests?)\b)|\btry\b(?=.{0,64}(?:with|against).{0,24}(?:code|case))/giu,
  ]),
  observedOutput: defs("execution_evidence_request", "hard", [
    /(?:帮我|请|想|再|也|顺手)?(?:看|确认|检查).{0,16}(?:实际|当前|现在)?.{0,8}(?:输出|结果|返回)|(?:当前|现在|这份|程序|代码).{0,16}(?:到底)?(?:会)?(?:输出|返回|吐).{0,8}(?:多少|什么|啥)|(?:到底|现在).{0,8}(?:返回|输出|跑(?:出来)?|吐).{0,8}(?:多少|什么|啥)|(?:输出|结果).{0,4}(?:看一下|确认一下)/giu,
    /\b(?:show|check|see|confirm|tell me)\s+(?:the\s+)?(?:(?:actual|current)\s+)?(?:output|result)\b|\bwhat\s+(?:does|will|would)\b.{0,20}\b(?:return|output)\b|\bwhat\s+is\s+(?:the\s+)?(?:actual|current)\s+(?:output|result)\b/giu,
  ]),
  currentCode: defs("current_code_target", "hard", [
    /当前代码|现在的代码|这份代码|我的代码|我这个代码|程序/giu,
    /\b(?:current|my|this)\s+(?:code|implementation)\b/giu,
  ]),
  assistantCandidate: defs("assistant_candidate_target", "hard", [
    /你(?:刚才|上面)?(?:写|给|生成).{0,12}(?:代码|实现)|候选代码|你的代码|你的改法|这个改法/giu,
    /\b(?:your|assistant|candidate).{0,12}(?:code|implementation|edit|change|solution)|\b(?:this|your|the) candidate\b/giu,
  ]),
  activeProblem: defs("active_problem_target", "soft", [
    /这个题目|这个题|这道题|这题|当前题目|题目|这点|这一点|这行|这里/giu,
    /\b(?:this|current|active)\s+(?:problem|question)\b/giu,
  ]),
} as const;

export function annotateClauseSignalsV2(clause: TurnClauseV2) {
  const execute = isManualOnlyExecution(clause.text)
    ? []
    : collect(clause, PATTERNS.execute);
  return {
    deliverable: {
      solve: collect(clause, PATTERNS.solve),
      failure: collect(clause, PATTERNS.diagnose),
      improve: collect(clause, PATTERNS.optimize),
      understand: collect(clause, PATTERNS.explain),
      recommend: collect(clause, PATTERNS.recommend),
    },
    target: {
      current: uniqueEvidence([
        ...collect(clause, PATTERNS.currentCode),
        ...collect(clause, PATTERNS.activeProblem),
      ]),
      concept: collect(clause, PATTERNS.concept),
      api: collect(clause, PATTERNS.api),
      candidate: collect(clause, PATTERNS.assistantCandidate),
    },
    basis: {
      pastProblems: collect(clause, PATTERNS.recallProblem),
      pastMistakes: collect(clause, PATTERNS.recallMistake),
      learnerProfile: collect(clause, PATTERNS.profile),
      apiKnowledge: collect(clause, defs("api_knowledge_basis", "soft", [
        /TypeError|语法错误|类型错误/giu,
      ])),
    },
    delivery: {
      hint: collect(clause, PATTERNS.hint).filter(
        (evidence) => !isLocallyNegatedRequest(clause, evidence),
      ),
      full: collectAffirmativeFullImplementation(clause),
      pseudocode: collect(clause, PATTERNS.pseudocode),
      patch: collect(clause, PATTERNS.patch),
      trace: collect(clause, PATTERNS.trace),
      count: collect(clause, PATTERNS.count),
    },
    effect: {
      execute,
      observedOutput: collect(clause, PATTERNS.observedOutput),
    },
  };
}

function uniqueEvidence(evidence: readonly SignalEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.kind}:${item.start}:${item.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLocallyNegatedRequest(
  clause: TurnClauseV2,
  evidence: SignalEvidence,
) {
  return hasNegationScope(clause.text, evidence.start - clause.start);
}

/**
 * Legacy request assembly excludes locally denied delivery signals. Evidence
 * collection still needs their spans so CategoryDenial can represent them.
 */
export function collectNegatedDeliverySignalsV2(clause: TurnClauseV2) {
  return {
    hint: collect(clause, PATTERNS.hint).filter((evidence) =>
      isLocallyNegatedRequest(clause, evidence),
    ),
    full: collect(clause, PATTERNS.fullImplementation).filter((evidence) =>
      isLocallyNegatedRequest(clause, evidence),
    ),
  };
}

function collectAffirmativeFullImplementation(clause: TurnClauseV2) {
  return collect(clause, PATTERNS.fullImplementation).filter(
    (evidence) => !isLocallyNegatedRequest(clause, evidence),
  );
}

function isManualOnlyExecution(text: string) {
  return /\bdry[ -]?run\b|\bmental\s+(?:simulation|trace|walkthrough)\b|\b(?:run|execute|simulate|trace|walk)\b.{0,32}\b(?:by hand|manually|mental simulation)\b|\b(?:by hand|manually)\b.{0,24}\b(?:run|execute|simulate|trace|walk)\b|手动.{0,12}(?:模拟|走一遍|执行|运行|跟踪)/iu.test(
    text,
  );
}

export function annotateDiscourseV2(
  clauses: readonly TurnClauseV2[],
): TurnDiscourse {
  return {
    repeatSignals: collectAcross(clauses, defs("repeat", "soft", [
      /再次|再来一次|再解释|再说|还是|仍然/giu,
      /\bagain\b|one more time|still/giu,
    ])),
    continuationSignals: collectAcross(clauses, defs("continuation", "soft", [
      /继续|接着|顺便|另外/giu,
      /\b(?:continue|also|besides)\b/giu,
    ])),
    referentSignals: collectAcross(clauses, defs("referent", "soft", [
      /这个|那个|这段|那段|刚才(?:的)?|上面(?:的)?|它/giu,
      /\b(?:this|that|it|those|the above)\b/giu,
    ])),
  };
}

export function annotateEffectDenialsV2(
  clauses: readonly TurnClauseV2[],
): EffectDenial[] {
  const denials: EffectDenial[] = [];
  for (const clause of clauses) {
    const execute = collect(clause, defs("execute_denial", "hard", [
      /(?:不要|别|先别|不用|无需|禁止|不许)\s*(?:实际|重新)?(?:运行|执行|跑|测试|验证|校验)(?:一下|一遍)?(?:\s*(?:(?:我的)?当前代码|现在的代码|这份代码|我的代码|你的代码|你(?:刚才|上面)?给的候选代码|候选代码|你的改法|这个改法))?|手动.{0,8}(?:运行|执行|跑|测试|分析)/giu,
      /\b(?:don['’]t|do not|never|must not|should not|shouldn['’]t)\s+(?:actually\s+)?(?:run|execute|rerun|test|verify)\b(?:\s+(?:my current code|current code|this code|your (?:code|candidate|edit|change)|candidate code|it|this|that))?/giu,
      /\bdry[ -]?run\b|\bmental\s+(?:simulation|trace|walkthrough)\b|\b(?:run|execute|simulate|trace|walk)\b.{0,32}\b(?:by hand|manually|mental simulation)\b|\b(?:by hand|manually)\b.{0,24}\b(?:run|execute|simulate|trace|walk)\b/giu,
    ])).map((evidence) => ({ ...evidence, polarity: "negative" as const }));
    if (execute.length > 0) {
      denials.push({ effect: "execute", sourceClauseIds: [clause.id], evidence: execute });
    }
  }
  return denials;
}

export function deriveDisclosureV2(
  clauses: readonly TurnClauseV2[],
): DisclosureCeiling {
  const deny = collectAcross(clauses, defs("full_code_denial", "hard", [
    /(?:不要|不想要|不需要|别|先别|不用|无需)\s*(?:直接)?(?:给|看)?\s*(?:完整|全部|整份)?(?:代码|答案|实现)|(?:不|没)(?:觉得|认为|感觉)(?:我)?(?:需要|想要).{0,8}(?:完整|全部|整份)(?:代码|答案|实现)/giu,
    /\b(?:don['’]t|do not)\s+(?:(?:give|show|provide)\s+(?:me\s+)?)?(?:(?:full|complete)\s+)?(?:code|answer|implementation)\b|\b(?:don['’]t|do not)\s+(?:think|feel|believe)(?:\s+i)?\s+(?:need|want)\s+(?:the\s+|a\s+)?(?:full|complete)\s+(?:code|answer|implementation)\b|\b(?:without|no)\s+(?:full|complete)\s+(?:code|answer|implementation)\b/giu,
  ]));
  if (deny.length > 0) {
    const allow = clauses.flatMap(collectAffirmativeFullImplementation);
    const corrected = allow.some((grant) =>
      deny.some((denial) =>
        denial.start > grant.start &&
        /算了|等等|改口|其实不|还是不|\b(?:actually|wait|scratch that|on second thought|never mind)\b/iu.test(
          clauses
            .map(({ text }) => text)
            .join(" "),
        ),
      ),
    );
    return {
      ceiling: "guided",
      source: corrected ? "explicit_correction" : "explicit_deny",
    };
  }
  const allow = clauses.flatMap(collectAffirmativeFullImplementation);
  return allow.length > 0
    ? { ceiling: "full_code", source: "explicit_allow" }
    : { ceiling: "guided", source: "default" };
}

export function deriveLanguageScopeV2(
  clauses: readonly TurnClauseV2[],
): PythonOnlyScope {
  const unsupported = collectAcross(clauses, defs("unsupported_language", "hard", [
    /c\+\+|\bcpp\b|\bjava(?:script)?\b|\btypescript\b|\bc#\b|\bgolang\b|\brust\b|\bruby\b|\bkotlin\b|\bswift\b/giu,
  ]))[0];
  return {
    supportedLanguage: "python",
    ...(unsupported ? { unsupportedLanguage: unsupported } : {}),
  };
}

export function deriveAffectV2(clauses: readonly TurnClauseV2[]) {
  return collectAcross(clauses, defs("anxious_stuck", "soft", [
    /没思路|没有什么思路|没招了|卡住|不会|慌|焦虑|崩溃|绝望|太难了|难受/giu,
    /\b(?:stuck|anxious|panicking|overwhelmed|too hard)\b/giu,
  ])).length > 0
    ? "anxious_stuck" as const
    : "none" as const;
}

function defs(
  kind: string,
  strength: SignalEvidence["strength"],
  patterns: readonly RegExp[],
): EvidencePattern[] {
  return patterns.map((pattern) => ({ kind, strength, pattern }));
}

function collectAcross(
  clauses: readonly TurnClauseV2[],
  definitions: readonly EvidencePattern[],
) {
  return clauses.flatMap((clause) => collect(clause, definitions));
}

function collect(
  clause: TurnClauseV2,
  definitions: readonly EvidencePattern[],
): SignalEvidence[] {
  const prose = maskProtectedProseV2(clause.text);
  const evidence: SignalEvidence[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const flags = `${definition.pattern.flags.replaceAll("g", "")}g`;
    for (const match of prose.matchAll(new RegExp(definition.pattern.source, flags))) {
      const localStart = match.index ?? 0;
      const start = clause.start + localStart;
      const end = start + match[0].length;
      const key = `${definition.kind}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        kind: definition.kind,
        span: clause.text.slice(localStart, localStart + match[0].length),
        start,
        end,
        sourceClauseId: clause.id,
        strength: definition.strength,
        polarity: "positive",
      });
    }
  }
  return evidence.sort((left, right) => left.start - right.start);
}
