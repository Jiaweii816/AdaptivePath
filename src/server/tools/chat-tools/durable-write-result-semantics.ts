import type { z } from "zod";
import {
  noteMemoryToolResultSchema,
  saveKnowledgeNoteToolResultSchema,
  saveMistakeBookEntryToolResultSchema,
} from "./chat-tool-contracts";
import type { DurableWriteToolName } from "./durable-write-types";
import { getDurableWriteDisplayName as getRegistryDisplayName } from "./requested-actions";

export type ActionOutcomeStatus = "completed" | "failed" | "unfulfilled";

export type DurableWriteFailureReason =
  | "invalid_tool_arguments"
  | "tool_execution_error"
  | "invalid_tool_result"
  | "durable_write_not_completed";

export type DurableWriteUnfulfilledReason =
  | "capacity_cost"
  | "capacity_execution"
  | "capacity_request"
  | "cost_budget"
  | "execution_limit"
  | "request_limit"
  | "round_limit"
  | "per_tool_cap_reached"
  | "tool_not_available_this_turn"
  | "tools_disabled"
  | "no_available_tools"
  | "provider_failure"
  | "protocol_violation";

export type ActionOutcomeReason =
  DurableWriteFailureReason | DurableWriteUnfulfilledReason;

export type ActionOutcome = {
  readonly toolName: DurableWriteToolName;
  readonly displayName: string;
  readonly status: ActionOutcomeStatus;
  readonly message: string;
  readonly recordId?: string;
  readonly reason?: ActionOutcomeReason;
};

export type DurableWriteResultEvaluation =
  | {
      status: "completed";
      outcome: ActionOutcome & { status: "completed" };
      parsedResult: unknown;
    }
  | {
      status: "failed";
      failureReason: Extract<
        DurableWriteFailureReason,
        "invalid_tool_result" | "durable_write_not_completed"
      >;
      outcome: ActionOutcome & { status: "failed" };
    };

export type DurableWriteResultSemantics = {
  isCompleted(result: unknown): boolean;
  buildOutcome(result: unknown, options?: ActionOutcomeOptions): ActionOutcome;
};

export type ActionOutcomeOptions = {
  readonly locale?: "zh" | "en";
};

type ResultSemantics<T> = {
  schema: z.ZodType<T>;
  isParsedCompleted(result: T): boolean;
  getRecordId(result: T): string | undefined;
  getSubject(result: T): string | undefined;
};

const resultSemantics = {
  note_memory: {
    schema: noteMemoryToolResultSchema,
    isParsedCompleted: (result) => result.saved === true,
    getRecordId: () => undefined,
    getSubject: (result) => result.tag,
  } satisfies ResultSemantics<z.infer<typeof noteMemoryToolResultSchema>>,
  save_knowledge_note: {
    schema: saveKnowledgeNoteToolResultSchema,
    isParsedCompleted: (result) =>
      result.saved === true && Boolean(result.noteId?.trim()),
    getRecordId: (result) => result.noteId ?? undefined,
    getSubject: (result) => result.title,
  } satisfies ResultSemantics<
    z.infer<typeof saveKnowledgeNoteToolResultSchema>
  >,
  save_mistake_book_entry: {
    schema: saveMistakeBookEntryToolResultSchema,
    isParsedCompleted: (result) =>
      result.saved === true && Boolean(result.entryId?.trim()),
    getRecordId: (result) => result.entryId ?? undefined,
    getSubject: (result) => result.title,
  } satisfies ResultSemantics<
    z.infer<typeof saveMistakeBookEntryToolResultSchema>
  >,
} as const;

export function getDurableWriteResultSemantics(
  toolName: DurableWriteToolName,
): DurableWriteResultSemantics {
  return {
    isCompleted(result) {
      return (
        evaluateDurableWriteResult(toolName, result).status === "completed"
      );
    },
    buildOutcome(result, options) {
      return evaluateDurableWriteResult(toolName, result, options).outcome;
    },
  };
}

export function evaluateDurableWriteResult(
  toolName: DurableWriteToolName,
  result: unknown,
  options: ActionOutcomeOptions = {},
): DurableWriteResultEvaluation {
  return evaluateWithSemantics(
    toolName,
    result,
    resultSemantics[toolName] as ResultSemantics<unknown>,
    options,
  );
}

export function buildFailedActionOutcome(
  toolName: DurableWriteToolName,
  reason: DurableWriteFailureReason,
  options: ActionOutcomeOptions = {},
): ActionOutcome & { status: "failed" } {
  const locale = options.locale ?? "zh";
  const displayName = getDisplayName(toolName, locale);
  return {
    toolName,
    displayName,
    status: "failed",
    message:
      locale === "zh"
        ? `${displayName}：操作失败，未确认写入成功`
        : `${displayName}: the write failed and was not recorded as completed`,
    reason,
  };
}

export function buildUnfulfilledActionOutcome(
  toolName: DurableWriteToolName,
  reason: DurableWriteUnfulfilledReason,
  options: ActionOutcomeOptions = {},
): ActionOutcome & { status: "unfulfilled" } {
  const locale = options.locale ?? "zh";
  const displayName = getDisplayName(toolName, locale);
  return {
    toolName,
    displayName,
    status: "unfulfilled",
    message:
      locale === "zh"
        ? `${displayName}：本轮未完成，未确认写入成功`
        : `${displayName}: not completed in this turn`,
    reason,
  };
}

export function getDurableWriteDisplayName(
  toolName: DurableWriteToolName,
  options: ActionOutcomeOptions = {},
) {
  return getDisplayName(toolName, options.locale ?? "zh");
}

function evaluateWithSemantics<T>(
  toolName: DurableWriteToolName,
  result: unknown,
  semantics: ResultSemantics<T>,
  options: ActionOutcomeOptions,
): DurableWriteResultEvaluation {
  const parsed = semantics.schema.safeParse(result);
  if (!parsed.success) {
    return {
      status: "failed",
      failureReason: "invalid_tool_result",
      outcome: buildFailedActionOutcome(
        toolName,
        "invalid_tool_result",
        options,
      ),
    };
  }
  if (!semantics.isParsedCompleted(parsed.data)) {
    return {
      status: "failed",
      failureReason: "durable_write_not_completed",
      outcome: buildFailedActionOutcome(
        toolName,
        "durable_write_not_completed",
        options,
      ),
    };
  }

  const locale = options.locale ?? "zh";
  const displayName = getDisplayName(toolName, locale);
  const subject = semantics.getSubject(parsed.data);
  const recordId = semantics.getRecordId(parsed.data);
  return {
    status: "completed",
    parsedResult: parsed.data,
    outcome: {
      toolName,
      displayName,
      status: "completed",
      message: buildCompletedMessage({ locale, displayName, subject }),
      ...(recordId ? { recordId } : {}),
    },
  };
}

function buildCompletedMessage(args: {
  locale: "zh" | "en";
  displayName: string;
  subject?: string;
}) {
  if (args.locale === "en") {
    return args.subject
      ? `${args.displayName}: saved “${args.subject}”`
      : `${args.displayName}: saved`;
  }
  return args.subject
    ? `${args.displayName}：已保存「${args.subject}」`
    : `${args.displayName}：已保存`;
}

function getDisplayName(toolName: DurableWriteToolName, locale: "zh" | "en") {
  return getRegistryDisplayName(toolName, locale);
}
