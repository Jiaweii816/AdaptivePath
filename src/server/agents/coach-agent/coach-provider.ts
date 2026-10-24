import type { CoachProvider } from "./coach-agent.types";
import { createMockCoachProvider } from "./mock-coach-provider";
import { createQwenCoachProvider } from "./qwen-coach-provider";

export function getCoachProvider(): CoachProvider {
  if (process.env.COACH_PROVIDER === "mock") {
    return createMockCoachProvider();
  }

  return createQwenCoachProvider();
}
