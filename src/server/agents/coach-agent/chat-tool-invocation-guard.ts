import { ChatToolDispatchError } from "@/server/tools/chat-tools/chat-tool-dispatch";
import { getChatToolSpec } from "@/server/tools/chat-tools/chat-tool-registry";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { TurnCapabilityPolicy } from "./turn-capability-policy";
import { policyAllowsTool } from "./turn-capability-policy";

export type InvocationGuardCode = "TOOL_NOT_LOADED" | "POLICY_DENIED" | "AUTH_REQUIRED" | "RESOURCE_SCOPE_MISMATCH" | "INVALID_ARGUMENTS" | "PRECONDITION_FAILED" | "BUDGET_EXCEEDED";

export function guardToolAdmission(args: {
  toolCallId: string;
  toolName: ChatToolName;
  loadedToolNames: ReadonlySet<ChatToolName>;
  policy: TurnCapabilityPolicy;
  hasCurrentCode: boolean;
}) {
  if (!args.loadedToolNames.has(args.toolName)) return deny(args, "TOOL_NOT_LOADED");
  if (!policyAllowsTool(args.policy, args.toolName)) return deny(args, "POLICY_DENIED");
  const grant = getChatToolSpec(args.toolName).requiredGrant;
  const authorized = grant === "none" ||
    (grant === "execute_current" && args.policy.explicitGrants.executeCurrent) ||
    (grant === "execute_candidate" && args.policy.explicitGrants.executeCandidate) ||
    (grant === "persist_preference" && args.policy.explicitGrants.persistPreference) ||
    (grant === "persist_knowledge" && args.policy.explicitGrants.persistKnowledge) ||
    (grant === "persist_mistake" && args.policy.explicitGrants.persistMistake);
  if (!authorized) return deny(args, "AUTH_REQUIRED");
  if (args.toolName === "run_current_code" && !args.hasCurrentCode) return deny(args, "PRECONDITION_FAILED");
}

function deny(args: { toolCallId: string; toolName: ChatToolName }, code: InvocationGuardCode): never {
  throw new ChatToolDispatchError(`Invocation Guard rejected ${args.toolName}: ${code}.`, "authorization_denied", {
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    cause: code,
  });
}
