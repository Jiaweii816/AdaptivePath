import {
  mockInterviewPhaseSchema,
  type MockInterviewPhase,
} from "@/types/mock-interview";

export const MOCK_INTERVIEW_DURATION_MINUTES = 25;
export const MOCK_INTERVIEW_MAX_QUESTIONS = 10;

export const MOCK_INTERVIEW_PHASES: MockInterviewPhase[] = [
  "intro",
  "technical_screen",
  "coding",
  "code_discussion",
  "wrap_up",
];

export function legalNextPhases(currentPhase: MockInterviewPhase) {
  const index = MOCK_INTERVIEW_PHASES.indexOf(currentPhase);
  const next = MOCK_INTERVIEW_PHASES[index + 1];

  return [currentPhase, ...(next ? [next] : [])];
}

export function applyPhaseGuard(args: {
  currentPhase: MockInterviewPhase;
  proposedPhase: MockInterviewPhase | "stay";
  forceWrapUp?: boolean;
}) {
  if (args.forceWrapUp) {
    return "wrap_up" as const;
  }

  if (args.proposedPhase === "stay") {
    return args.currentPhase;
  }

  const parsed = mockInterviewPhaseSchema.parse(args.proposedPhase);
  const legal = legalNextPhases(args.currentPhase);

  if (parsed === "wrap_up" && args.currentPhase !== "code_discussion") {
    return args.currentPhase;
  }

  return legal.includes(parsed) ? parsed : args.currentPhase;
}

export function shouldForceWrapUp(args: {
  startedAt: Date;
  durationMinutes: number;
  questionCount: number;
  maxQuestions: number;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const elapsedMs = now.getTime() - args.startedAt.getTime();
  const elapsedMinutes = elapsedMs / 60000;

  return (
    elapsedMinutes >= args.durationMinutes ||
    args.questionCount >= args.maxQuestions
  );
}

export function elapsedInterviewMinutes(startedAt: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
}
