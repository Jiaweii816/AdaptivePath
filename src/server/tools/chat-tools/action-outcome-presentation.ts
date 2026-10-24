import type { ActionOutcome } from "./durable-write-result-semantics";

export function buildActionOutcomeMarkdown(
  outcomes: readonly ActionOutcome[],
  locale: "zh" | "en",
) {
  if (outcomes.length === 0) {
    return "";
  }

  return [
    locale === "zh" ? "### 操作结果" : "### Action results",
    "",
    ...outcomes.map((outcome) => `- ${outcome.message}`),
  ].join("\n");
}

export function appendActionOutcomeMarkdown(args: {
  markdown: string;
  outcomes: readonly ActionOutcome[];
  locale: "zh" | "en";
}) {
  const outcomeBlock = buildActionOutcomeMarkdown(args.outcomes, args.locale);
  if (!outcomeBlock) {
    return args.markdown;
  }

  const body = args.markdown.trim();
  return body ? `${body}\n\n${outcomeBlock}` : outcomeBlock;
}

export function replaceConflictingDurableOutcomeClaims(
  markdown: string,
  outcomes: readonly ActionOutcome[],
  locale: "zh" | "en",
) {
  if (
    !containsDurableOutcomeClaim(markdown) ||
    (outcomes.length === 0 && !containsUnverifiedDurableSuccessClaim(markdown))
  ) {
    return { markdown, replaced: false };
  }

  return {
    markdown:
      outcomes.length > 0
        ? locale === "zh"
          ? "教学正文包含无法由后端验证的写入状态声明，因此已隐藏；请以下方操作结果为准。"
          : "The teaching text included a write-status claim the backend could not verify, so it was hidden. Use the action results below as authoritative."
        : locale === "zh"
          ? "教学正文声称完成了持久化写入，但后端没有对应的成功结果，因此已隐藏该声明。"
          : "The teaching text claimed a durable write succeeded, but the backend has no matching successful result, so that claim was hidden.",
    replaced: true,
  };
}

function containsDurableOutcomeClaim(markdown: string) {
  const target =
    /(?:错题本|错题簿|mistake\s*(?:book|notebook)|知识手册|知识本|知识库|知识卡(?:片)?|handbook|knowledge\s*(?:book|handbook|note|card)|长期(?:记忆|偏好)|long[- ]term\s*(?:memory|preference))/i;
  const result =
    /(?:已(?:经)?(?:保存|存入|存到|存进|记录|收录|写入|添加|记下)|(?:帮你|为你)(?:保存|存入|存到|存进|记录|收录|写入|添加|记下)|保存(?:成功|失败)|未(?:保存|存入|存到|存进|记录|写入)|没有(?:保存|存入|存到|存进|记录|写入)|saved|recorded|stored|not\s+saved|failed\s+to\s+save)/i;
  const genericCompletion =
    /(?:都(?:处理|保存|记录)好(?:了)?|已经记下|全部完成|all\s+done|everything\s+(?:is\s+)?saved)/i;

  return (
    genericCompletion.test(markdown) ||
    (target.test(markdown) && result.test(markdown))
  );
}

function containsUnverifiedDurableSuccessClaim(markdown: string) {
  const negative =
    /(?:未(?:保存|存入|存到|存进|记录|写入)|没有(?:保存|存入|存到|存进|记录|写入)|保存失败|not\s+saved|failed\s+to\s+save)/i;
  if (negative.test(markdown)) {
    return false;
  }

  return /(?:已(?:经)?(?:保存|存入|存到|存进|记录|收录|写入|添加|记下)|(?:帮你|为你)(?:保存|存入|存到|存进|记录|收录|写入|添加|记下)|保存成功|都(?:处理|保存|记录)好(?:了)?|已经记下|全部完成|saved|recorded|stored|all\s+done|everything\s+(?:is\s+)?saved)/i.test(
    markdown,
  );
}
