import { bffErrorMessage } from "./bff-errors";
import type { WorkbenchReviewResult, WorkbenchRunEvidence } from "./types";

type ReviewStreamEvent =
  | { type: "evidence"; evidence: WorkbenchRunEvidence }
  | { type: "complete"; result: WorkbenchReviewResult }
  | { type: "error"; error?: string }
  | { type: "bff_error"; error?: string; requestId?: string };

export async function readReviewStream(
  response: Response,
  onEvidence: (evidence: WorkbenchRunEvidence) => void,
): Promise<WorkbenchReviewResult> {
  if (!response.body) {
    throw new Error("Review returned an empty response stream.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const sse = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
  let eventData: string[] = [];
  let completed: WorkbenchReviewResult | null = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ReviewStreamEvent;
    if (event.type === "evidence") {
      onEvidence(event.evidence);
    } else if (event.type === "complete") {
      completed = event.result;
    } else if (event.type === "bff_error") {
      throw new Error(bffErrorMessage(event) ?? "BFF request failed.");
    } else if (event.type === "error") {
      throw new Error(event.error ?? "Unable to complete the review request.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!sse) consumeLine(line);
      else if (line === "") {
        if (eventData.length) consumeLine(eventData.join("\n"));
        eventData = [];
      } else if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /, ""));
    }
    if (done) break;
  }
  if (!sse && buffer.trim()) consumeLine(buffer);
  if (!completed) throw new Error("Review stream ended before completion.");
  return completed;
}
