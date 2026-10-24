import type { OnboardingFormValues } from "./schema";

type LocalUserEnvironment = Readonly<Record<string, string | undefined>>;

/** Origin selects the safe default handle; a handle never determines origin. */
export function resolveLocalUserHandle(
  env: LocalUserEnvironment = process.env,
) {
  const configured = env.PATTERNCOACH_LOCAL_USER_HANDLE?.trim();
  if (configured) return configured;

  if (env.PATTERNCOACH_MEMORY_ORIGIN === "learner") return "Iris904";
  if (env.PATTERNCOACH_MEMORY_ORIGIN === "development") {
    return "try";
  }
  if (env.PATTERNCOACH_MEMORY_ORIGIN === "test") return "try";
  if (env.PATTERNCOACH_MEMORY_ORIGIN === "evaluation") {
    return "PatternCoachEvaluation";
  }
  if (env.PATTERNCOACH_MEMORY_ORIGIN === "demo") return "PatternCoachDemo";
  if (env.PATTERNCOACH_MEMORY_ORIGIN === "seed") return "PatternCoachSeed";
  return "PatternCoachLegacyUnknown";
}

export const irisHandle = resolveLocalUserHandle();

export const onboardingOptions = {
  interviewGoals: [
    { label: "Full-time", value: "full_time" },
    { label: "Internship", value: "internship" },
    { label: "General Practice", value: "general_practice" },
  ],
  languages: ["Python"],
  strongPatterns: [
    "HashMap",
    "Dict",
    "Array traversal",
    "Brute force to optimization",
    "Sliding Window overall intuition",
  ],
  weakPatterns: [
    "Binary Search",
    "Binary Search boundaries",
    "Sliding Window shrink condition",
    "DP state design",
    "Graph traversal",
  ],
  explanationStyles: [
    "Chinese explanation during testing",
    "Short, step-by-step answer",
    "Concrete example first",
    "Pseudocode first",
  ],
  outputPreferences: [
    "Pseudocode before full code",
    "Python preferred",
    "Explain with examples",
  ],
} as const;

export const irisDefaultProfile: OnboardingFormValues = {
  displayName: "Iris904",
  interviewGoal: "full_time",
  preferredLanguages: ["Python"],
  strongPatterns: [
    "HashMap",
    "Dict",
    "Array traversal",
    "Brute force to optimization",
  ],
  weakPatterns: [
    "Binary Search",
    "Binary Search boundaries",
    "Sliding Window shrink condition",
    "DP state design",
  ],
  explanationStyle: [
    "Chinese explanation during testing",
    "Short, step-by-step answer",
    "Concrete example first",
  ],
  outputPreferences: [
    "Pseudocode before full code",
    "Python preferred",
    "Explain with examples",
  ],
};
