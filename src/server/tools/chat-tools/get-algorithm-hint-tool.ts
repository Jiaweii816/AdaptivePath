import type { PrismaClient } from "@prisma/client";
import {
  type ChatToolArgs,
  type ChatToolResult,
} from "./chat-tool-contracts";

type AlgorithmHintContext = {
  prisma: PrismaClient;
  userId: string;
  chatSessionId?: string;
  toolCallId?: string;
  problem?: {
    id: string;
    slug: string;
    title: string;
  };
  problemTags?: string[];
  workspace?: {
    codeHash?: string;
  };
};

const MAX_HINT_LEVEL = 3;

export async function getAlgorithmHintChatTool(
  args: ChatToolArgs<"get_algorithm_hint">,
  context: AlgorithmHintContext,
): Promise<ChatToolResult<"get_algorithm_hint">> {
  const requestedSlug = args.problem_slug?.trim();
  const activeProblem = context.problem;
  const problemSlug = requestedSlug ?? activeProblem?.slug ?? "";
  const problem = requestedSlug
    ? await context.prisma.problem.findUnique({
        where: { slug: requestedSlug },
      })
    : activeProblem
      ? await context.prisma.problem.findUnique({
          where: { id: activeProblem.id },
        })
      : null;

  if (!problem) {
    return {
      found: false,
      problemSlug,
      maxLevel: MAX_HINT_LEVEL,
      message:
        "No cached problem was found for this hint request. Omit problem_slug to use the active problem, or ask the learner to open/cache the target problem first.",
    };
  }

  const existing = await context.prisma.algorithmHintProgress.findUnique({
    where: {
      userId_problemId: {
        userId: context.userId,
        problemId: problem.id,
      },
    },
  });
  const previousLevel = clampHintLevel(existing?.currentLevel ?? 0);
  const nextLevel = Math.min(previousLevel + 1, MAX_HINT_LEVEL) as 1 | 2 | 3;
  const progress = await context.prisma.algorithmHintProgress.upsert({
    where: {
      userId_problemId: {
        userId: context.userId,
        problemId: problem.id,
      },
    },
    update: { currentLevel: nextLevel },
    create: {
      userId: context.userId,
      problemId: problem.id,
      currentLevel: nextLevel,
    },
  });
  const problemTags = context.problem?.id === problem.id && context.problemTags
    ? context.problemTags
    : parseJsonArray(problem.tags);
  const hintPolicy = buildHintPolicy(nextLevel, {
    title: problem.title,
    tags: problemTags,
    focus: args.focus,
  });

  return {
    found: true,
    problemSlug,
    title: problem.title,
    level: nextLevel,
    previousLevel,
    maxLevel: MAX_HINT_LEVEL,
    capped: previousLevel >= MAX_HINT_LEVEL,
    problemTags,
    focus: args.focus,
    hint: {
      heading: hintPolicy.heading,
      content: hintPolicy.finalReplyInstruction,
    },
    hintPolicy: {
      mode: hintPolicy.mode,
      allowedDisclosure: hintPolicy.allowedDisclosure,
      mustInclude: hintPolicy.mustInclude,
      mustAvoid: hintPolicy.mustAvoid,
      finalReplyInstruction: hintPolicy.finalReplyInstruction,
    },
    telemetry: {
      progressId: progress.id,
      chatSessionId: context.chatSessionId,
      toolCallId: context.toolCallId,
      currentCodeHash: context.workspace?.codeHash,
      eventKind: "algorithm_hint_progressed",
    },
    message:
      "Use hintPolicy as a disclosure boundary for the final learner-facing hint. The tool records progression; it does not provide a problem-specific answer.",
  };
}

function clampHintLevel(level: number) {
  if (!Number.isFinite(level) || level < 0) {
    return 0;
  }

  return Math.min(Math.trunc(level), MAX_HINT_LEVEL) as 0 | 1 | 2 | 3;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function buildHintPolicy(
  level: 1 | 2 | 3,
  args: {
    title: string;
    tags: string[];
    focus?: string;
  },
) {
  const tagSummary = args.tags.length > 0 ? args.tags.join(", ") : "the problem tags";
  const focusClause = args.focus
    ? ` Address the learner's stated focus: ${args.focus}.`
    : " If the learner did not name a stuck point, infer the narrowest useful one from the current code, latest evidence, and problem statement.";

  if (level === 1) {
    return {
      heading: "Level 1: Algorithm or data-structure nudge",
      mode: "algorithm_or_data_structure" as const,
      allowedDisclosure:
        "Name the likely algorithm family, data structure, or core pattern for this problem, using the problem title/tags/current code as context. You may give one tiny intuition sentence.",
      mustInclude: [
        `Mention only the broad pattern for ${args.title}; tags available: ${tagSummary}.`,
        "Give exactly one guiding question or one next observation the learner can check.",
        focusClause,
      ],
      mustAvoid: [
        "Do not give pseudocode.",
        "Do not list full implementation steps.",
        "Do not reveal branch conditions, loop invariants, or final code.",
      ],
      finalReplyInstruction:
        "Write a small Level 1 hint: point to the algorithm/data-structure family or core pattern only, then ask one focused question. Preserve the learner's chance to discover the implementation.",
    };
  }

  if (level === 2) {
    return {
      heading: "Level 2: Problem-specific implementation strategy",
      mode: "implementation_strategy" as const,
      allowedDisclosure:
        "Connect the pattern to this problem's state variables, invariant, traversal order, or decision branches. You may use one small example, but keep it short.",
      mustInclude: [
        `Tie the strategy to ${args.title} rather than giving a generic textbook hint.`,
        "Name the key state or invariant the learner should maintain.",
        "End with one concrete edit/check the learner can try next.",
        focusClause,
      ],
      mustAvoid: [
        "Do not paste full code.",
        "Do not provide complete pseudocode.",
        "Do not jump to alternative optimized solutions unless the current approach is not repairable.",
      ],
      finalReplyInstruction:
        "Write a Level 2 hint: explain how the broad pattern maps onto this problem's state/invariant and give one concrete next check or edit, without full pseudocode or full code.",
    };
  }

  return {
    heading: "Level 3: Pseudocode-level guidance",
    mode: "pseudocode" as const,
    allowedDisclosure:
      "Give concise pseudocode-level steps, key branch logic, or loop update order. This can be specific enough to unblock implementation, but should remain language-neutral unless the learner explicitly asked for full code.",
    mustInclude: [
      `Keep the pseudocode anchored to ${args.title}.`,
      "Include the key branch or state update order that prevents the common mistake.",
      "Invite the learner to implement the pseudocode in their own code before asking for a full solution.",
      focusClause,
    ],
    mustAvoid: [
      "Do not paste a complete Python/C++ solution unless the user explicitly asked for full code.",
      "Do not claim hidden-test acceptance.",
      "Do not provide multiple alternative solutions in this hint turn.",
    ],
    finalReplyInstruction:
      "Write a Level 3 hint: give concise language-neutral pseudocode or branch/update order for the current approach, then ask the learner to apply it before requesting full code.",
  };
}
