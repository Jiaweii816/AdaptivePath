/** Client calls to /api/adaptivepath. Server types are imported as types only. */
import type { BiologyView, CoachFocus, CoachTurnResponse, SubmitFeedback } from "@/server/adaptivepath/session";
import type { PromptId } from "./suggested-prompts";

export type PracticeResponse = BiologyView & Partial<{ feedback: SubmitFeedback } & CoachTurnResponse>;
export type PracticeDraft = { selectedOption: "A" | "B" | "C" | "D" | null; reasoning: string };
export type PracticeAction =
  | { action: "submit"; questionId: string; selectedOption: string; explanation: string; attemptId: string }
  | { action: "reference"; questionId: string }
  | { action: "chat"; focus: CoachFocus; message: string; draft?: PracticeDraft; promptIds: readonly PromptId[]; referenceChunkId?: string };

async function parse(response: Response): Promise<PracticeResponse> {
  const body = await response.json() as PracticeResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export async function getPractice(): Promise<PracticeResponse> {
  return parse(await fetch("/api/adaptivepath", { cache: "no-store" }));
}

export async function postPractice(payload: PracticeAction): Promise<PracticeResponse> {
  return parse(await fetch("/api/adaptivepath", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}
