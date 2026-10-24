import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  activityExtractionInputSchema,
  activityObservationSchema,
  buildActivityExtractionPrompt,
  createMockActivityExtractionProvider,
  createOpenAiCompatibleActivityExtractionProvider,
  parseActivityExtractionOutput,
  projectSealedActivityForExtraction,
  type ActivityExtractionInput,
} from "@/server/memory/extraction";
import type { SealedActivityClusterInput } from "@/server/memory/activity-clusters/activity-cluster.types";

function input(
  items: ActivityExtractionInput["items"],
  overrides: Partial<ActivityExtractionInput> = {},
): ActivityExtractionInput {
  return {
    cluster: {
      id: "cluster-graph-1",
      kind: "review_rooted",
      inputHash: "input-hash-graph-1",
      independentEvidenceKey: "activity:cluster-graph-1",
      problemId: "problem-133",
      problemTitle: "Clone Graph",
      problemTags: ["graph", "depth_first_search"],
      startedAt: "2026-07-20T10:00:00.000Z",
      endedAt: "2026-07-20T10:20:00.000Z",
    },
    items,
    allowedLearnerEvidenceTraceIds: [
      ...new Set(items.flatMap((item) => item.evidenceTraceIds)),
    ],
    existingClaimCandidates: [],
    ...overrides,
  };
}

function item(args: {
  ordinal: number;
  speaker: "learner" | "assistant" | "system" | "evidence";
  text: string;
  evidenceTraceIds?: string[];
}): ActivityExtractionInput["items"][number] {
  return {
    ordinal: args.ordinal,
    sourceType: args.speaker === "learner" || args.speaker === "assistant"
      ? "chat_message"
      : "l1_event",
    sourceId: `source-${args.ordinal}`,
    speaker: args.speaker,
    occurredAt: `2026-07-20T10:${String(args.ordinal).padStart(2, "0")}:00.000Z`,
    text: args.text,
    evidenceTraceIds: args.evidenceTraceIds ?? [],
  };
}

describe("open-world activity extraction contract", () => {
  it("extracts an unknown learner concept without requiring a canonical mechanism", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text:
          "I finally understood the zipper-merge frontier: advance the source whose next timestamp is smaller.",
        evidenceTraceIds: ["l1-user-unknown-concept"],
      }),
    ]);

    const output = await createMockActivityExtractionProvider().extract(activity);
    const observation = activityObservationSchema.parse(output.observations[0]);

    expect(output.observations).toHaveLength(1);
    expect(observation).toMatchObject({
      claimType: "knowledge_state",
      evidenceStrength: "user_explicit",
      mechanismKeys: [],
      evidenceTraceIds: ["l1-user-unknown-concept"],
    });
    expect(observation.claimText).toContain(
      "zipper-merge frontier",
    );
    expect(output.coverage).toMatchObject({
      status: "complete",
      examinedEvidenceTraceIds: ["l1-user-unknown-concept"],
      usedEvidenceTraceIds: ["l1-user-unknown-concept"],
    });
  });

  it("extracts a narrow visited-state repair from the whole graph-DFS activity", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "My graph DFS keeps failing; I forgot where visited should be updated.",
        evidenceTraceIds: ["l1-user-question"],
      }),
      item({
        ordinal: 2,
        speaker: "assistant",
        text: "Check the invariant for when a node enters visited.",
      }),
      item({
        ordinal: 3,
        speaker: "learner",
        text: "I marked visited before expanding neighbors and the changed review passed.",
        evidenceTraceIds: ["l1-user-repair", "l1-review-pass"],
      }),
    ]);

    const output = await createMockActivityExtractionProvider().extract(activity);
    const observation = activityObservationSchema.parse(output.observations[0]);

    expect(output.episode).toMatchObject({ outcome: "improved", salience: 0.85 });
    expect(output.episode.summary).toContain("visited-state omission");
    expect(output.observations).toEqual([
      expect.objectContaining({
        claimType: "weakness",
        polarity: "negative",
        mechanismKeys: [],
        evidenceStrength: "observed",
        evidenceTraceIds: [
          "l1-user-question",
          "l1-user-repair",
          "l1-review-pass",
        ],
      }),
    ]);
    expect(observation.scope.context).toContain(
      "not evidence of recurrence",
    );
  });

  it("returns a coverage receipt but no observation for courtesy and navigation", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "谢谢！",
        evidenceTraceIds: ["l1-thanks"],
      }),
      item({
        ordinal: 2,
        speaker: "assistant",
        text: "Please return to Today for the next pending item.",
      }),
    ]);

    const output = await createMockActivityExtractionProvider().extract(activity);

    expect(output.observations).toEqual([]);
    expect(output.episode.evidenceTraceIds).toEqual(["l1-thanks"]);
    expect(output.coverage).toMatchObject({
      status: "no_semantic_signal",
      examinedEvidenceTraceIds: ["l1-thanks"],
      usedEvidenceTraceIds: [],
      ignoredEvidence: [
        expect.objectContaining({ evidenceTraceId: "l1-thanks" }),
      ],
    });
  });

  it("keeps an opening recall request as Episode-only context without reinforcing L2", async () => {
    const activity = input(
      [
        item({
          ordinal: 1,
          speaker: "learner",
          text: "这题也是图 DFS，提醒我上次在哪里栽坑？",
          evidenceTraceIds: ["l1-recall-question"],
        }),
      ],
      {
        existingClaimCandidates: [
          {
            targetFactId: "fact-old-visited-mistake",
            claimType: "weakness",
            claimText: "Visited-state handling was omitted in a prior activity.",
            polarity: "negative",
            scope: {
              level: "mechanism",
              problemIds: ["problem-133"],
              topicHints: ["graph DFS", "visited state"],
            },
          },
        ],
      },
    );

    const output = await createMockActivityExtractionProvider().extract(activity);
    expect(output.episode.summary).toContain("no independent evidence");
    expect(output.observations).toEqual([]);
    expect(output.coverage).toMatchObject({
      status: "episode_only",
      usedEvidenceTraceIds: [],
      ignoredEvidence: [
        {
          evidenceTraceId: "l1-recall-question",
          reason: "retrieval_intent_only",
        },
      ],
    });

    expect(() =>
      parseActivityExtractionOutput(
        {
          ...validOutput({
            evidenceTraceIds: ["l1-recall-question"],
            relationProposal: {
              targetFactId: "fact-old-visited-mistake",
              relation: "reinforces",
            },
          }),
          episode: {
            ...validOutput().episode,
            evidenceTraceIds: ["l1-recall-question"],
          },
          coverage: {
            status: "complete",
            ignoredEvidence: [],
          },
        },
        activity,
      ),
    ).toThrow("retrieval_intent_cannot_create_l2_observation");
  });

  it("does not let assistant-only prose prove a learner claim", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "assistant",
        text:
          "The learner is excellent at obscure cactus-graph decomposition and always spots the invariant.",
      }),
    ]);

    const output = await createMockActivityExtractionProvider().extract(activity);
    expect(output.observations).toEqual([]);
    expect(output.coverage.status).toBe("no_semantic_signal");
  });

  it.each([
    "equivalent",
    "reinforces",
    "contradicts",
    "refines",
    "related",
    "unrelated",
  ] as const)("accepts relation %s only for a supplied target fact", (relation) => {
    const activity = input(
      [
        item({
          ordinal: 1,
          speaker: "learner",
          text: "I forgot visited again.",
          evidenceTraceIds: ["l1-user"],
        }),
      ],
      {
        existingClaimCandidates: [
          {
            targetFactId: "fact-visited",
            claimType: "weakness",
            claimText: "Visited-state handling is still fragile.",
            polarity: "negative",
            scope: {
              level: "mechanism",
              problemIds: [],
              topicHints: ["visited state"],
            },
          },
        ],
      },
    );
    const raw = validOutput({
      relationProposal: { targetFactId: "fact-visited", relation },
    });
    expect(
      parseActivityExtractionOutput(raw, activity).observations[0]
        ?.relationProposal?.relation,
    ).toBe(relation);

    expect(() =>
      parseActivityExtractionOutput(
        validOutput({
          relationProposal: { targetFactId: "fact-not-supplied", relation },
        }),
        activity,
      ),
    ).toThrow("relation_target_not_supplied:fact-not-supplied");
  });

  it("drops assistant evidence ids and derives incomplete coverage", () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "I forgot visited.",
        evidenceTraceIds: ["l1-user"],
      }),
      item({
        ordinal: 2,
        speaker: "assistant",
        text: "Use a visited set.",
      }),
    ]);
    const disallowed = parseActivityExtractionOutput(
      validOutput({ evidenceTraceIds: ["l1-assistant"] }),
      activity,
    );
    expect(disallowed.observations).toEqual([]);
    expect(disallowed.coverage.usedEvidenceTraceIds).toEqual([]);
    const output = parseActivityExtractionOutput(validOutput(), activity);
    expect(output.coverage.examinedEvidenceTraceIds).toEqual(["l1-user"]);
    expect(output.coverage.usedEvidenceTraceIds).toEqual(["l1-user"]);
    expect(output.coverage.ignoredEvidence).toEqual([]);
  });
});

describe("activity extraction prompt and OpenAI-compatible provider", () => {
  it("projects real Chat and Review payload fields into the readable prompt", () => {
    const sealed: SealedActivityClusterInput = {
      cluster: {
        id: "sealed-graph-cluster",
        userId: "learner-user",
        problemId: "problem-133",
        chatSessionId: "chat-133",
        rootReviewAttemptId: "review-133",
        kind: "review_rooted",
        status: "sealed",
        sourceKey: "review:review-133",
        memoryOrigin: "learner",
        startedAt: new Date("2026-07-20T10:00:00.000Z"),
        endedAt: new Date("2026-07-20T10:20:00.000Z"),
      },
      messageRange: { startSequence: 1, endSequence: 2 },
      inputHash: "sealed-input-hash",
      independentEvidenceKey: "activity:sealed-graph-cluster",
      independentEvidenceUnitCount: 1,
      items: [
        frozenItem({
          id: "item-user",
          sourceType: "chat_message",
          sourceId: "l1-user-question",
          ordinal: 1,
          role: "user",
          evidenceRole: "learner_action",
          payload: {
            contentMarkdown:
              "图 DFS 一直失败，我是不是忘了标记 visited？",
          },
        }),
        frozenItem({
          id: "item-assistant",
          sourceType: "chat_message",
          sourceId: "assistant-message",
          ordinal: 2,
          role: "assistant",
          evidenceRole: "coach_response",
          payload: {
            contentMarkdown: "先确定节点在什么时候进入 visited。",
          },
        }),
        frozenItem({
          id: "item-review",
          sourceType: "review_attempt",
          sourceId: "l1-review-pass",
          ordinal: 3,
          role: "learner",
          evidenceRole: "learner_action",
          payload: {
            userState: "modified_after_hint",
            userQuestion: "我把 visited 移到递归前了，再帮我 review。",
            codeSnapshot:
              "def dfs(node):\n    visited.add(node)\n    for nxt in node.neighbors:\n        dfs(nxt)",
          },
        }),
      ],
    };
    const projected = projectSealedActivityForExtraction(sealed, {
      allowedLearnerEvidenceTraceIds: [
        "l1-user-question",
        "l1-review-pass",
      ],
      problemTitle: "Clone Graph",
      problemTags: ["graph", "depth_first_search"],
    });
    const prompt = buildActivityExtractionPrompt(projected);

    expect(prompt).toContain("图 DFS 一直失败");
    expect(prompt).toContain("节点在什么时候进入 visited");
    expect(prompt).toContain("我把 visited 移到递归前了");
    expect(prompt).toContain("visited.add(node)");
    expect(projected.items[0]?.evidenceTraceIds).toEqual([
      "l1-user-question",
    ]);
    expect(projected.items[1]?.evidenceTraceIds).toEqual([]);
    expect(projected.items[2]?.evidenceTraceIds).toEqual(["l1-review-pass"]);
  });

  it("states the open-world and evidence-authority boundaries", () => {
    const parsed = activityExtractionInputSchema.parse(
      input([
        item({
          ordinal: 1,
          speaker: "learner",
          text: "Why does visited belong before recursion?",
          evidenceTraceIds: ["l1-prompt"],
        }),
      ]),
    );
    const prompt = buildActivityExtractionPrompt(parsed);
    expect(prompt).toContain("Every learner-origin Review and Learner-Coach Chat");
    expect(prompt).toContain("canonical mechanism key is OPTIONAL");
    expect(prompt).toContain("Assistant text alone can NEVER prove learner strength");
    expect(prompt).toContain("provider-unavailable");
    expect(prompt).toContain("one evidence unit");
    expect(prompt).toContain("retrieval intent, not new failure");
    expect(prompt).toContain("episode_only");
    expect(prompt).toContain(
      "resolved | unresolved | improved | abandoned | informational | no_semantic_signal",
    );
  });

  it("repairs fenced JSON and validates the provider output", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "I forgot visited.",
        evidenceTraceIds: ["l1-user"],
      }),
    ]);
    const create = vi.fn().mockResolvedValue({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: `Here is the JSON:\n\`\`\`json\n${JSON.stringify(validOutput())}\n\`\`\``,
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const provider = createOpenAiCompatibleActivityExtractionProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });

    const output = await provider.extract(activity);
    expect(output.observations).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "qwen3-8b",
      enable_thinking: false,
      temperature: 0.1,
    });
  });

  it("normalizes a known Qwen Episode outcome alias before strict validation", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "I forgot visited.",
        evidenceTraceIds: ["l1-user"],
      }),
    ]);
    const aliased = validOutput();
    aliased.episode.outcome = "success";
    const create = vi.fn().mockResolvedValue({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(aliased) },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const provider = createOpenAiCompatibleActivityExtractionProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });

    await expect(provider.extract(activity)).resolves.toMatchObject({
      episode: { outcome: "resolved" },
      coverage: { status: "complete" },
    });
  });

  it("keeps unknown Episode outcomes invalid instead of silently weakening the contract", async () => {
    const activity = input([
      item({
        ordinal: 1,
        speaker: "learner",
        text: "I forgot visited.",
        evidenceTraceIds: ["l1-user"],
      }),
    ]);
    const invalid = validOutput();
    invalid.episode.outcome = "mostly_kind_of_ok";
    const create = vi.fn().mockResolvedValue({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(invalid) },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    const provider = createOpenAiCompatibleActivityExtractionProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });

    await expect(provider.extract(activity)).rejects.toThrow();
  });
});

function frozenItem(args: {
  id: string;
  sourceType: SealedActivityClusterInput["items"][number]["sourceType"];
  sourceId: string;
  ordinal: number;
  role: string;
  evidenceRole: SealedActivityClusterInput["items"][number]["evidenceRole"];
  payload: Record<string, unknown>;
}): SealedActivityClusterInput["items"][number] {
  return {
    ...args,
    occurredAt: new Date(
      `2026-07-20T10:${String(args.ordinal).padStart(2, "0")}:00.000Z`,
    ),
    messageSequence: args.sourceType === "chat_message" ? args.ordinal : null,
    contentHash: `hash-${args.ordinal}`,
    metadata: {},
  };
}

function validOutput(
  observationOverrides: Record<string, unknown> = {},
) {
  return {
    episode: {
      title: "Visited-state observation",
      summary: "The learner described a visited-state omission in this activity.",
      outcome: "unresolved",
      tags: ["visited state"],
      salience: 0.7,
      evidenceTraceIds: ["l1-user"],
    },
    observations: [
      {
        claimType: "mistake",
        claimText: "The learner omitted visited-state handling in this activity.",
        polarity: "negative",
        scope: {
          level: "mechanism",
          problemIds: ["problem-133"],
          topicHints: ["visited state"],
        },
        mechanismKeys: [],
        evidenceStrength: "observed",
        evidenceTraceIds: ["l1-user"],
        ...observationOverrides,
      },
    ],
    coverage: {
      status: "complete",
      ignoredEvidence: [],
    },
  };
}
