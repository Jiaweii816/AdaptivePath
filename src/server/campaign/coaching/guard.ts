import type { CampaignCoachingContext } from "./contracts";

export const CAMPAIGN_POLICY_GUARD_VERSION = "v1" as const;

export type CampaignPolicyGuardResult = Readonly<{
  reply: string;
  replaced: boolean;
  prependedWarning: boolean;
  reason: "none" | "probe_full_solution" | "mixed_node_disclosure";
  version: typeof CAMPAIGN_POLICY_GUARD_VERSION;
}>;

export function applyCampaignPolicyGuard(input: {
  reply: string;
  responseLanguage: "zh" | "en";
  context: CampaignCoachingContext | null;
  problemMethodName: string;
}): CampaignPolicyGuardResult {
  const context = input.context;
  if (!context || context.settled || context.policy.coachingMode === "ordinary") {
    return unchanged(input.reply);
  }

  if (
    context.slotRole === "probe" &&
    !context.policy.explicitDisclosureOverride &&
    containsCompleteTargetImplementation(input.reply, input.problemMethodName)
  ) {
    return {
      reply: probeFallback(input.responseLanguage),
      replaced: true,
      prependedWarning: false,
      reason: "probe_full_solution",
      version: CAMPAIGN_POLICY_GUARD_VERSION,
    };
  }

  if (
    context.slotRole === "mixed" &&
    !context.policy.mayProactivelyNameNode &&
    containsExactNodeDisclosure(
      input.reply,
      context.nodeLabelAliasesInternal,
    )
  ) {
    return {
      reply: mixedFallback(input.responseLanguage),
      replaced: true,
      prependedWarning: false,
      reason: "mixed_node_disclosure",
      version: CAMPAIGN_POLICY_GUARD_VERSION,
    };
  }

  if (
    context.slotRole === "probe" &&
    context.policy.shouldWarnAssessmentContamination
  ) {
    const warning = contaminationWarning(input.responseLanguage);
    if (!input.reply.trimStart().startsWith(warning)) {
      return {
        reply: `${warning}\n\n${input.reply.trimStart()}`,
        replaced: false,
        prependedWarning: true,
        reason: "none",
        version: CAMPAIGN_POLICY_GUARD_VERSION,
      };
    }
  }

  return unchanged(input.reply);
}

/** Narrow reuse of the existing guided-disclosure contract's target shape. */
export function containsCompleteTargetImplementation(
  markdown: string,
  methodName: string,
) {
  const fences = [...markdown.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/giu)].map(
    (match) => match[1] ?? "",
  );
  const escapedMethod = escapeRegExp(methodName);
  return fences.some((code) => {
    const hasTargetSignature = new RegExp(
      `(?:class\\s+Solution\\s*:?[\\s\\S]{0,240})?def\\s+${escapedMethod}\\s*\\(`,
      "u",
    ).test(code);
    const hasExecutableBody =
      /\n\s{4,}(?:for|while|if|return|stack\s*=|queue\s*=|left\s*=|right\s*=|dp\s*=)/u.test(
        code,
      );
    return hasTargetSignature && hasExecutableBody;
  });
}

function containsExactNodeDisclosure(
  markdown: string,
  aliases: readonly string[],
) {
  return aliases
    .map((alias) => alias.trim())
    .filter(
      (alias) =>
        /[\u3400-\u9fff]/u.test(alias) ? alias.length >= 2 : alias.length >= 4,
    )
    .some((alias) => new RegExp(escapeRegExp(alias), "iu").test(markdown));
}

function unchanged(reply: string): CampaignPolicyGuardResult {
  return {
    reply,
    replaced: false,
    prependedWarning: false,
    reason: "none",
    version: CAMPAIGN_POLICY_GUARD_VERSION,
  };
}

function contaminationWarning(language: "zh" | "en") {
  return language === "zh"
    ? "这会降低本次盲区探测的有效性，我会按你的要求继续。"
    : "This will reduce the validity of this probe, but I’ll continue as requested.";
}

function probeFallback(language: "zh" | "en") {
  return language === "zh"
    ? "先只检查一个局部点：写出当前状态代表什么，以及哪一个条件会让它失效。"
    : "Check one local point first: state what the current state means and which condition would invalidate it.";
}

function mixedFallback(language: "zh" | "en") {
  return language === "zh"
    ? "先不要给这道题贴标签。可以从输入规模、需要维护的状态，以及暴力解法重复计算的位置开始判断。"
    : "Avoid labeling the problem yet. Start from the input scale, the state that must be maintained, and where brute force repeats work.";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
