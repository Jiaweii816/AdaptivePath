import { z } from "zod";
import {
  chatToolArgSchemas,
  chatToolNameSchema,
  chatToolResultSchemas,
  type ChatToolName,
} from "./chat-tool-contracts";
import { chatToolDispatchMap } from "./chat-tool-dispatch";

export type ChatToolRiskClass =
  | "internal_read"
  | "personal_read"
  | "open_world_read"
  | "operational_write"
  | "sandboxed_execute"
  | "durable_write";

export type ChatToolGrant =
  | "none"
  | "execute_current"
  | "execute_candidate"
  | "persist_preference"
  | "persist_knowledge"
  | "persist_mistake";

export type ChatToolSpec = {
  name: ChatToolName;
  capabilityId: string;
  shortDescription: string;
  tags: readonly string[];
  aliases: readonly string[];
  inputSchema: z.ZodType;
  resultSchema: z.ZodType;
  /** The meta tool is handled by the loop; other entries resolve here. */
  handler: "discovery" | (typeof chatToolDispatchMap)[Exclude<ChatToolName, "discover_capability">];
  riskClass: ChatToolRiskClass;
  readOnly: boolean;
  openWorld: boolean;
  destructive: boolean;
  idempotent: boolean;
  requiredGrant: ChatToolGrant;
  schemaChars: number;
  costUnits: number;
  maxCallsPerTurn: number;
};

type SpecInput = Omit<ChatToolSpec, "inputSchema" | "resultSchema" | "handler" | "schemaChars">;

function spec(input: SpecInput): ChatToolSpec {
  const inputSchema = chatToolArgSchemas[input.name];
  return {
    ...input,
    inputSchema,
    resultSchema: chatToolResultSchemas[input.name],
    handler:
      input.name === "discover_capability"
        ? "discovery"
        : chatToolDispatchMap[input.name],
    schemaChars: JSON.stringify(z.toJSONSchema(inputSchema)).length,
  };
}

const entries = [
  spec({ name: "discover_capability", capabilityId: "system.capability.discover", shortDescription: "Find a loadable capability from a natural-language need.", tags: ["capability", "discover"], aliases: [], riskClass: "internal_read", readOnly: true, openWorld: false, destructive: false, idempotent: true, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 2 }),
  spec({ name: "recall_learning_experience", capabilityId: "memory.learning_experience.read", shortDescription: "Recall the learner's relevant learning experience.", tags: ["learning_experience", "learner", "weakness", "strength", "personalization"], aliases: ["学习经历", "学习模式", "强项", "弱项", "learner pattern", "weakness", "strength"], riskClass: "personal_read", readOnly: true, openWorld: false, destructive: false, idempotent: false, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 1 }),
  spec({ name: "past_problem_recall", capabilityId: "memory.history.problems.read", shortDescription: "Recall prior solved or similar problems.", tags: ["history", "past_problem", "similar_problem", "transfer"], aliases: ["以前做过的题", "之前刷过的题", "类似题", "previous problem", "solved before", "solved previously", "similar problems I solved", "past problem"], riskClass: "personal_read", readOnly: true, openWorld: false, destructive: false, idempotent: true, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 1 }),
  spec({ name: "past_mistake_recall", capabilityId: "memory.history.mistakes.read", shortDescription: "Recall prior mistakes and recurring bugs.", tags: ["history", "mistake", "failure", "recurring_bug", "debug"], aliases: ["以前犯过的错", "历史错误", "老问题", "类似错误", "previous mistake", "past error", "similar bug"], riskClass: "personal_read", readOnly: true, openWorld: false, destructive: false, idempotent: true, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 1 }),
  spec({ name: "find_practice_problem", capabilityId: "practice.catalog.search", shortDescription: "Find a controlled catalog practice problem.", tags: ["practice", "reinforce", "advance", "next_problem"], aliases: ["练习题", "下一题", "巩固题", "进阶题", "practice problem", "next problem"], riskClass: "internal_read", readOnly: true, openWorld: false, destructive: false, idempotent: true, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 3 }),
  spec({ name: "search_interview_variant_candidates", capabilityId: "interview.variants.search_web", shortDescription: "Search public web pages for interview variants.", tags: ["interview", "company", "variant", "web_search"], aliases: ["面试变体", "公司题", "interview variant", "company question", "OA variant"], riskClass: "open_world_read", readOnly: true, openWorld: true, destructive: false, idempotent: false, requiredGrant: "none", costUnits: 2, maxCallsPerTurn: 1 }),
  spec({ name: "get_algorithm_hint", capabilityId: "coach.hint.get", shortDescription: "Advance the active problem's progressive hint level.", tags: ["hint", "algorithm", "clue", "solve"], aliases: ["提示", "思路", "方向", "hint", "clue", "algorithm hint"], riskClass: "operational_write", readOnly: false, openWorld: false, destructive: false, idempotent: false, requiredGrant: "none", costUnits: 2, maxCallsPerTurn: 1 }),
  spec({ name: "lookup_api_reference", capabilityId: "knowledge.api.lookup", shortDescription: "Look up a concise offline Python API reference.", tags: ["api", "syntax", "library", "reference"], aliases: ["API 用法", "语法", "library reference", "function usage", "api reference"], riskClass: "operational_write", readOnly: false, openWorld: false, destructive: false, idempotent: false, requiredGrant: "none", costUnits: 1, maxCallsPerTurn: 1 }),
  spec({ name: "run_current_code", capabilityId: "compute.execute.current", shortDescription: "Run the current editor code on visible tests.", tags: ["execute", "current_code", "test", "actual_output"], aliases: ["跑当前代码", "执行我的代码", "测试当前代码", "actual output", "run current code"], riskClass: "sandboxed_execute", readOnly: false, openWorld: false, destructive: false, idempotent: true, requiredGrant: "execute_current", costUnits: 3, maxCallsPerTurn: 1 }),
  spec({ name: "verify_proposed_repair", capabilityId: "compute.execute.candidate", shortDescription: "Verify an assistant-proposed repair on visible tests.", tags: ["execute", "candidate", "repair", "verify"], aliases: ["验证你的改法", "跑候选代码", "verify repair", "test proposed fix"], riskClass: "sandboxed_execute", readOnly: false, openWorld: false, destructive: false, idempotent: true, requiredGrant: "execute_candidate", costUnits: 3, maxCallsPerTurn: 1 }),
  spec({ name: "note_memory", capabilityId: "memory.preference.write", shortDescription: "Save an explicit durable learner preference.", tags: ["persist", "preference", "memory"], aliases: ["记住我的偏好", "保存偏好", "remember preference", "save preference"], riskClass: "durable_write", readOnly: false, openWorld: false, destructive: false, idempotent: false, requiredGrant: "persist_preference", costUnits: 2, maxCallsPerTurn: 1 }),
  spec({ name: "save_knowledge_note", capabilityId: "memory.knowledge.write", shortDescription: "Save reusable knowledge to the Handbook.", tags: ["persist", "knowledge", "handbook"], aliases: ["保存知识", "知识手册", "knowledge note", "save handbook note"], riskClass: "durable_write", readOnly: false, openWorld: false, destructive: false, idempotent: false, requiredGrant: "persist_knowledge", costUnits: 2, maxCallsPerTurn: 1 }),
  spec({ name: "save_mistake_book_entry", capabilityId: "memory.mistake.write", shortDescription: "Save the active problem to the Mistake Book.", tags: ["persist", "mistake_book", "review"], aliases: ["收录错题本", "保存错题", "mistake book", "save mistake"], riskClass: "durable_write", readOnly: false, openWorld: false, destructive: false, idempotent: false, requiredGrant: "persist_mistake", costUnits: 2, maxCallsPerTurn: 1 }),
] as const;

export const chatToolRegistry = Object.fromEntries(entries.map((entry) => [entry.name, entry])) as Record<ChatToolName, ChatToolSpec>;
export const chatToolRegistryOrder = entries.map((entry) => entry.name) as readonly ChatToolName[];
export const optionalToolOrder = ["past_problem_recall", "past_mistake_recall", "get_algorithm_hint", "lookup_api_reference", "find_practice_problem", "search_interview_variant_candidates"] as const satisfies readonly ChatToolName[];

export function getChatToolSpec(name: ChatToolName) { return chatToolRegistry[name]; }
export function getChatToolByCapabilityId(capabilityId: string) { return entries.find((entry) => entry.capabilityId === capabilityId) ?? null; }
