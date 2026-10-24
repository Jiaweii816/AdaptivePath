import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { chatToolRegistryOrder, getChatToolSpec } from "@/server/tools/chat-tools/chat-tool-registry";
import type { TurnCapabilityPolicy } from "./turn-capability-policy";
import { policyAllowsTool } from "./turn-capability-policy";

export type DiscoveryStatus = "loaded" | "no_match" | "policy_denied" | "requires_explicit_user_grant";
export type DiscoveryResult = { status: DiscoveryStatus; matchedCapabilities: Array<{ capabilityId: string; shortDescription: string; status: "loaded" | "requires_explicit_user_grant" }>; lexicalScores: Array<{ toolName: ChatToolName; score: number }>; resolverUsed: boolean };

const SYNONYMS: Record<string, string> = {
  "以前": "history", "之前": "history", past: "history", previous: "history", earlier: "history", before: "history",
  "错误": "mistake", bug: "mistake", mistake: "mistake", "踩坑": "mistake", failure: "mistake",
  "类似题": "past_problem", "previous problem": "past_problem", "solved before": "past_problem",
  "运行": "execute", execute: "execute", test: "execute", "跑": "execute", "actual output": "execute",
  "候选": "candidate", "你的改法": "candidate", "proposed repair": "candidate",
  "练习": "practice", practice: "practice", "similar problem": "practice", "下一题": "practice",
  "保存": "persist", remember: "persist", note: "persist", "记下来": "persist",
  "偏好": "preference", preference: "preference", "以后都": "preference",
};

export function discoverChatCapability(args: { need: string; policy: TurnCapabilityPolicy; maxNewTools?: number }): DiscoveryResult {
  const raw = normalizeRawNeed(args.need);
  const normalized = normalizeNeed(raw);
  const scored = chatToolRegistryOrder
    .filter((name) => name !== "discover_capability")
    .map((toolName) => ({ toolName, score: lexicalScore({ raw, normalized }, toolName) }))
    .sort((left, right) => right.score - left.score || chatToolRegistryOrder.indexOf(left.toolName) - chatToolRegistryOrder.indexOf(right.toolName));
  const [first, second] = scored;
  const deterministic = Boolean(first && first.score >= 10 && first.score - (second?.score ?? 0) >= 3);
  // V1 leaves the bounded resolver injectable. No hidden second model call is
  // made when a resolver is not configured; an uncertain request is explicit.
  if (!deterministic || !first) return { status: "no_match", matchedCapabilities: [], lexicalScores: scored.slice(0, 2), resolverUsed: false };
  const matched = [first.toolName].slice(0, args.maxNewTools ?? 2);
  const loadable = matched.filter((name) => policyAllowsTool(args.policy, name));
  if (loadable.length === 0) return { status: "policy_denied", matchedCapabilities: [], lexicalScores: scored.slice(0, 2), resolverUsed: false };
  const needsGrant = loadable.filter((name) => !hasGrant(args.policy, name));
  if (needsGrant.length > 0) return {
    status: "requires_explicit_user_grant",
    matchedCapabilities: needsGrant.map((name) => ({ capabilityId: getChatToolSpec(name).capabilityId, shortDescription: getChatToolSpec(name).shortDescription, status: "requires_explicit_user_grant" })),
    lexicalScores: scored.slice(0, 2), resolverUsed: false,
  };
  return {
    status: "loaded",
    matchedCapabilities: loadable.map((name) => ({ capabilityId: getChatToolSpec(name).capabilityId, shortDescription: getChatToolSpec(name).shortDescription, status: "loaded" })),
    lexicalScores: scored.slice(0, 2), resolverUsed: false,
  };
}

function hasGrant(policy: TurnCapabilityPolicy, name: ChatToolName) {
  const grant = getChatToolSpec(name).requiredGrant;
  return grant === "none" || (grant === "execute_current" && policy.explicitGrants.executeCurrent) || (grant === "execute_candidate" && policy.explicitGrants.executeCandidate) || (grant === "persist_preference" && policy.explicitGrants.persistPreference) || (grant === "persist_knowledge" && policy.explicitGrants.persistKnowledge) || (grant === "persist_mistake" && policy.explicitGrants.persistMistake);
}

function normalizeNeed(need: string) {
  let value = normalizeRawNeed(need);
  for (const [from, to] of Object.entries(SYNONYMS)) value = value.replaceAll(from, ` ${to} `);
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRawNeed(need: string) {
  return need.trim().toLowerCase().replace(/\s+/g, " ");
}

function lexicalScore(
  need: { raw: string; normalized: string },
  toolName: ChatToolName,
) {
  const spec = getChatToolSpec(toolName);
  const tokens = new Set(
    `${need.raw} ${need.normalized}`
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(Boolean),
  );
  let score = 0;
  for (const alias of spec.aliases) {
    const normalizedAlias = alias.toLowerCase();
    if (
      need.raw.includes(normalizedAlias) ||
      need.normalized.includes(normalizedAlias)
    ) {
      score += 10;
    }
  }
  for (const tag of spec.tags) if (tokens.has(tag.toLowerCase())) score += 5;
  for (const token of spec.shortDescription.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) if (token && tokens.has(token)) score += 2;
  return score;
}
