"use server";

import prisma from "@/server/db/prisma";
import { irisDefaultProfile, irisHandle } from "./profile-defaults";
import { onboardingSchema, type OnboardingFormValues } from "./schema";

type OnboardingActionResult = {
  ok: boolean;
  message?: string;
};

const json = (value: unknown) => JSON.stringify(value);

async function persistProfile(values: OnboardingFormValues) {
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      displayName: values.displayName,
      interviewGoal: values.interviewGoal,
      preferredLanguages: json(values.preferredLanguages),
      strongPatterns: json(values.strongPatterns),
      weakPatterns: json(values.weakPatterns),
      explanationStyle: json(values.explanationStyle),
      outputPreferences: json(values.outputPreferences),
    },
    create: {
      userId: user.id,
      displayName: values.displayName,
      interviewGoal: values.interviewGoal,
      preferredLanguages: json(values.preferredLanguages),
      strongPatterns: json(values.strongPatterns),
      weakPatterns: json(values.weakPatterns),
      explanationStyle: json(values.explanationStyle),
      outputPreferences: json(values.outputPreferences),
    },
  });
}

export async function saveOnboardingProfile(
  values: OnboardingFormValues,
): Promise<OnboardingActionResult> {
  const parsed = onboardingSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Profile is incomplete.",
    };
  }

  await persistProfile(parsed.data);

  return { ok: true };
}

export async function skipOnboarding(): Promise<OnboardingActionResult> {
  await persistProfile(irisDefaultProfile);

  return { ok: true };
}
