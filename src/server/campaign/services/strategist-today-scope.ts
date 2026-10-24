export type StrategistTodayScope = Readonly<{
  todayMutationRequested: boolean;
  todayTaskImmutable: true;
  scope: "future_route" | "unsupported_today_mutation";
}>;

const protectedTodayPatterns = [
  /(?:不要|不|别|禁止|不能|不可|无需|无须).{0,12}(?:修改|调整|更换|替换|换掉|重排|重新安排|增加|添加|减少).{0,12}(?:今天|今日)/i,
  /(?:今天|今日).{0,12}(?:任务|题|DailyTask)?.{0,8}(?:不要|不|别|禁止|不能|不可).{0,8}(?:修改|调整|更换|替换|换掉|重排|重新安排|增加|添加|减少)?/i,
  /(?:保持|维持).{0,12}(?:今天|今日|today)(?:'s)?.{0,12}(?:任务|DailyTask|tasks?)?.{0,8}(?:不变|原样|不修改|unchanged|intact)/i,
  /\b(?:do not|don't|never|must not)\b.{0,24}\b(?:change|replace|edit|reschedule|add|remove)\b.{0,24}\b(?:today|today's)\b/i,
  /\b(?:today|today's)\b.{0,24}\b(?:tasks?|daily\s*task)\b.{0,24}\b(?:unchanged|intact|must not|should not|do not|don't|never)\b/i,
] as const;

const todayMutationPatterns = [
  /(?:修改|调整|更换|替换|换掉|重排|重新安排|增加|添加|再加|减少|删掉).{0,16}(?:今天|今日)/i,
  /(?:今天|今日).{0,16}(?:修改|调整|更换|替换|换掉|重排|重新安排|增加|添加|再加|减少|删掉|只做\s*[\d一二两三四五六七八九十]+题)/i,
  /(?:给)?(?:今天|今日).{0,10}(?:再|多)?(?:加|增加|添加).{0,8}(?:一|二|两|\d+)?道?题/i,
  /\b(?:change|replace|edit|reschedule|add|remove)\b.{0,28}\b(?:today|today's)\b/i,
  /\b(?:today|today's)\b.{0,28}\b(?:change|replace|edit|reschedule|add|remove)\b/i,
] as const;

function clauses(requestText: string) {
  return requestText
    .split(/[\n。！？；;]|\b(?:but|however)\b|(?:但是|但|不过)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function classifyStrategistTodayScope(requestText: string | null | undefined): StrategistTodayScope {
  const todayMutationRequested = clauses(requestText ?? "").some((clause) => {
    if (protectedTodayPatterns.some((pattern) => pattern.test(clause))) return false;
    return todayMutationPatterns.some((pattern) => pattern.test(clause));
  });
  return {
    todayMutationRequested,
    todayTaskImmutable: true,
    scope: todayMutationRequested ? "unsupported_today_mutation" : "future_route",
  };
}
