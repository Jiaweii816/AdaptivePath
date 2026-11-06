/**
 * Privacy guard (spec §10.3, agreed with the user): memory steers the coach in the
 * background, so a reply must not reveal stored records. Disable with
 * ADAPTIVEPATH_MEMORY_DISCLOSURE_GUARD=off; the switch state is traced every turn.
 */
export const MIN_DISCLOSURE_OVERLAP_CHARS = 20;
const GUARD_SWITCH = "ADAPTIVEPATH_MEMORY_DISCLOSURE_GUARD";
const GUARD_OFF = "off";

/** Level words like "独立" or "Independent" are ordinary vocabulary, so labels only count next to level wording. */
const LEVEL_LABEL = "(?:Not yet|With tutor|With reference|Independent|未掌握|Tutor 辅助|查阅课本|独立)";
const DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /\bL[0-3]\b/g,
  /\blevel\s*[0-3]\b/gi,
  /[0-3一二三四]\s*档|档位|掌握档/g,
  new RegExp(`${LEVEL_LABEL}\\s*(?:档|level)`, "g"),
  new RegExp(`(?:是|为|\\bis|\\bat|[:：])\\s*["“]?${LEVEL_LABEL}["”]?\\s*(?=$|[。.,，;；)）])`, "g"),
  /Tutor 辅助/g,
  /stability|稳定度/gi,
  /\bS\s*[=＝:：]\s*\d+/g,
  /b2e-12-2-(?:q|concept)-[\w-]+/g,
  /bio-l2-v\d+/g,
  /\b(?:counter_down|counter_up|ineligible|supportStreak)\b/g,
  /账本|\bledger\b/gi,
  /根据你的(?:学习)?(?:记录|历史|档案|画像)/g,
  /你的(?:学习)?(?:记录|档案|画像)(?:显示|表明|里)/g,
  /\b(?:your|the)\s+(?:record|history|profile)\s+(?:shows|says|indicates)\b/gi,
  /\byou previously (?:answered|wrote|chose|said|got)\b/gi,
  /上次你(?:写|选|答|错)|你之前(?:写|选|答)(?:过|的)/g,
];

export function isMemoryDisclosureGuardEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[GUARD_SWITCH] !== GUARD_OFF;
}

function withoutQuotes(reply: string, quotedSpans: readonly string[]): string {
  return quotedSpans.reduce((text, span) => text.split(span).join(" "), reply);
}

type DisclosureContext = Readonly<{
  pastExcerpts: readonly string[];
  quotedSpans: readonly string[];
  /** Text the student can see this turn (their own reasoning, retrieved textbook passages); overlaps with it are not leaks. */
  allowedSources?: readonly string[];
}>;

/** Any 20-character window of a stored excerpt that reappears in the reply (case-insensitive), unless the student can see it anyway. */
function excerptOverlaps(reply: string, ctx: DisclosureContext): string[] {
  const haystack = reply.toLowerCase();
  const visible = (ctx.allowedSources ?? []).map((s) => s.toLowerCase());
  return ctx.pastExcerpts.flatMap((excerpt) => {
    const source = excerpt.toLowerCase();
    for (let start = 0; start + MIN_DISCLOSURE_OVERLAP_CHARS <= source.length; start += 1) {
      const window = source.slice(start, start + MIN_DISCLOSURE_OVERLAP_CHARS);
      const leaked = window.trim().length === MIN_DISCLOSURE_OVERLAP_CHARS && haystack.includes(window) && !visible.some((v) => v.includes(window));
      if (leaked) return [window];
    }
    return [];
  });
}

export function findMemoryDisclosures(reply: string, ctx: DisclosureContext): string[] {
  const text = withoutQuotes(reply, ctx.quotedSpans);
  const matches = DISCLOSURE_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
  return [...matches, ...excerptOverlaps(text, ctx)];
}
