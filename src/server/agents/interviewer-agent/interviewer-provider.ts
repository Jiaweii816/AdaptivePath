import type { InterviewerProvider } from "./interviewer-agent.types";
import { createMockInterviewerProvider } from "./mock-interviewer-provider";
import { createOpenAiInterviewerProvider } from "./openai-interviewer-provider";

export function getInterviewerProvider(): InterviewerProvider {
  if (process.env.INTERVIEWER_PROVIDER === "mock") {
    return createMockInterviewerProvider();
  }

  return createOpenAiInterviewerProvider();
}
