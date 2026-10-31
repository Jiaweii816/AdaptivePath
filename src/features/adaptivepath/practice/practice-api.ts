/** Client calls to /api/adaptivepath. Server types are imported as types only. */
import type { BiologyView, SubmitFeedback } from "@/server/adaptivepath/session";
import type { BiologyTurnResult } from "@/server/agents/coach-agent/biology-chat-reply";

export type PracticeResponse = BiologyView & Partial<{ feedback: SubmitFeedback } & BiologyTurnResult>;
export type PracticeAction =
  | { action: "submit"; questionId: string; selectedOption: string; explanation: string; attemptId: string }
  | { action: "reference"; questionId: string }
  | { action: "chat"; message: string };

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
