/** Every Biology coach failure surfaces as this error; nothing falls back to a template. */
export type BiologyCoachErrorCode =
  | "llm_timeout"
  | "llm_provider"
  | "llm_empty"
  | "llm_refusal"
  | "llm_truncated"
  | "llm_invalid_json"
  | "llm_schema"
  | "diagnosis_invalid"
  | "reply_contract"
  | "answer_leak"
  | "memory_disclosure"
  | "attempt_not_found"
  | "review_requires_live";

export type BiologyCoachNode = "classifier" | "diagnoser" | "coach" | "guard" | "request";

const STATUS_BY_CODE: Partial<Record<BiologyCoachErrorCode, 400 | 404>> = {
  attempt_not_found: 404,
  review_requires_live: 400,
};
const UPSTREAM_FAILURE = 502;

export class BiologyCoachError extends Error {
  readonly code: BiologyCoachErrorCode;
  readonly node: BiologyCoachNode;
  readonly details?: unknown;

  constructor(code: BiologyCoachErrorCode, node: BiologyCoachNode, message: string, options: { cause?: unknown; details?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "BiologyCoachError";
    this.code = code;
    this.node = node;
    this.details = options.details;
  }
}

export function coachErrorStatus(code: BiologyCoachErrorCode): 400 | 404 | 502 {
  return STATUS_BY_CODE[code] ?? UPSTREAM_FAILURE;
}
