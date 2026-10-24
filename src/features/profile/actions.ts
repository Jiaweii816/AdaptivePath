"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  irisDefaultProfile,
  irisHandle,
  onboardingOptions,
} from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";

const json = (value: unknown) => JSON.stringify(value);

export async function updateProfileSelections(formData: FormData) {
  const strongPatterns = selectedAllowedValues(
    formData,
    "strongPatterns",
    onboardingOptions.strongPatterns,
  );
  const weakPatterns = selectedAllowedValues(
    formData,
    "weakPatterns",
    onboardingOptions.weakPatterns,
  );
  const outputPreferences = selectedAllowedValues(
    formData,
    "outputPreferences",
    onboardingOptions.outputPreferences,
  );

  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });
  const currentProfile = await prisma.userProfile.findUnique({
    where: { userId: user.id },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      strongPatterns: json(strongPatterns),
      weakPatterns: json(weakPatterns),
      outputPreferences: json(outputPreferences),
    },
    create: {
      userId: user.id,
      displayName: currentProfile?.displayName ?? irisDefaultProfile.displayName,
      interviewGoal:
        currentProfile?.interviewGoal ?? irisDefaultProfile.interviewGoal,
      preferredLanguages:
        currentProfile?.preferredLanguages ??
        json(irisDefaultProfile.preferredLanguages),
      strongPatterns: json(strongPatterns),
      weakPatterns: json(weakPatterns),
      explanationStyle:
        currentProfile?.explanationStyle ??
        json(irisDefaultProfile.explanationStyle),
      outputPreferences: json(outputPreferences),
    },
  });

  revalidatePath("/profile");
  redirect("/profile?saved=1");
}

function selectedAllowedValues(
  formData: FormData,
  key: string,
  allowedValues: readonly string[],
) {
  const allowed = new Set(allowedValues);

  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => allowed.has(value));
}
