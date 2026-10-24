"use server";

import { irisHandle } from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";
import { getOrFetchProblem } from "@/server/problems/hot150-problem-cache";
import { toWorkbenchProblem } from "./workbench-data";
import type {
  WorkbenchLanguage,
  WorkbenchProblem,
  WorkbenchTestCase,
} from "./types";

const json = (value: unknown) => JSON.stringify(value);

async function getIrisUserId() {
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  return user.id;
}

type SaveDraftInput = {
  problemId: string;
  language: WorkbenchLanguage;
  content: string;
  selectedTestCaseIds: string[];
};

export async function saveDraftState(input: SaveDraftInput) {
  const userId = await getIrisUserId();

  await prisma.codeDraft.upsert({
    where: {
      userId_problemId_language: {
        userId,
        problemId: input.problemId,
        language: input.language,
      },
    },
    update: {
      content: input.content,
      selectedTestCaseIds: json(input.selectedTestCaseIds),
    },
    create: {
      userId,
      problemId: input.problemId,
      language: input.language,
      content: input.content,
      selectedTestCaseIds: json(input.selectedTestCaseIds),
    },
  });

  return { ok: true };
}

type CreateCustomTestInput = {
  problemId: string;
  label: string;
  input: unknown;
  expected: unknown;
};

export async function createCustomTestCase(
  input: CreateCustomTestInput,
): Promise<{ ok: true; testCase: WorkbenchTestCase }> {
  const userId = await getIrisUserId();
  const sortOrder = await prisma.problemTestCase.count({
    where: { problemId: input.problemId },
  });

  const testCase = await prisma.problemTestCase.create({
    data: {
      problemId: input.problemId,
      userId,
      label: input.label.trim() || "custom test",
      inputJson: json(input.input),
      expectedJson: json(input.expected),
      source: "custom",
      expectedSource: "user",
      gtProvenance: null,
      validationStatus: "user_supplied",
      metadataJson: "{}",
      isVisible: true,
      sortOrder,
    },
  });

  return {
    ok: true,
    testCase: {
      id: testCase.id,
      label: testCase.label,
      input: input.input,
      expected: input.expected,
      source: testCase.source,
      isVisible: testCase.isVisible,
      sortOrder: testCase.sortOrder,
    },
  };
}

export async function loadWorkbenchProblemBySlug(
  slug: string,
): Promise<{ ok: true; problem: WorkbenchProblem }> {
  const userId = await getIrisUserId();
  const problem = await getOrFetchProblem(slug, prisma);
  const hydrated = await prisma.problem.findUniqueOrThrow({
    where: { id: problem.id },
    include: {
      codeDrafts: {
        where: { userId },
      },
      testCases: {
        where: {
          isVisible: true,
          OR: [{ userId: null }, { userId }],
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  return {
    ok: true,
    problem: toWorkbenchProblem(hydrated),
  };
}
