import { describe, expect, it } from "vitest";

import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import { renderResponsePlanV2Instructions } from "@/server/agents/coach-agent/response-policy/render-instructions-v2";
import { buildResponsePlanV2 } from "@/server/agents/coach-agent/response-policy/response-plan-v2";
import type {
  Deliverable,
  RespondTurnRequest,
  TurnRequest,
  TurnUnderstandingV2,
} from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";

const input = {} as CoachChatInput;

function understanding(
  requests: TurnRequest[],
  overrides: Partial<TurnUnderstandingV2> = {},
): TurnUnderstandingV2 {
  return {
    schemaVersion: "v2",
    clauses: [{ id: "c0", text: "fixture", start: 0, end: 7 }],
    coverage: {
      queryScript: "latin",
      contentUnitCount: 1,
      coveredUnitCount: 1,
      ratio: 1,
      resolution: "trivial",
    },
    requests,
    disclosure: { ceiling: "guided", source: "default" },
    categoryDenials: [],
    effectDenials: [],
    languageScope: { supportedLanguage: "python" },
    affect: "none",
    discourse: {
      repeatSignals: [],
      continuationSignals: [],
      referentSignals: [],
    },
    route: { kind: "fast_path", escalationReasons: [] },
    ...overrides,
  };
}

function respond(
  id: string,
  deliverable: Deliverable,
  overrides: Partial<RespondTurnRequest> = {},
): RespondTurnRequest {
  return {
    id,
    kind: "respond",
    deliverable,
    target: "current",
    basis: ["current_evidence"],
    delivery: { depth: "normal", form: "prose" },
    sourceClauseIds: ["c0"],
    dependsOn: [],
    evidence: [],
    ...overrides,
  };
}

function render(value: TurnUnderstandingV2) {
  const plan = buildResponsePlanV2(value, input);
  return {
    plan,
    joined: renderResponsePlanV2Instructions(plan, input).join("\n"),
  };
}

describe("Turn Understanding V2 response directives", () => {
  it.each([
    ["fix", "[FIX]"],
    ["understand", "[UNDERSTAND]"],
    ["improve", "[IMPROVE]"],
    ["solve", "[SOLVE]"],
    ["recommend", "[RECOMMEND]"],
    ["recall", "[RECALL]"],
    ["chat", "[CHAT]"],
  ] as const)(
    "reads Deliverable %s directly as core task",
    (deliverable, marker) => {
      const { plan, joined } = render(
        understanding([respond("r0", deliverable)]),
      );

      expect(plan.directives[0]).toMatchObject({
        coreTask: deliverable,
        deliveryMode: { depth: "normal", form: "prose" },
      });
      expect(joined).toContain(marker);
    },
  );

  it("compiles Delivery depth, form, and count without changing core task", () => {
    const { plan, joined } = render(
      understanding([
        respond("r0", "understand", {
          delivery: { depth: "hint", form: "trace", count: 2 },
        }),
      ]),
    );

    expect(plan.directives[0]?.coreTask).toBe("understand");
    expect(joined).toContain("[DELIVERY: HINT]");
    expect(joined).toContain("[FORM: TRACE]");
    expect(joined).toContain("[COUNT] Provide exactly 2");
  });

  it.each([
    ["prose", "[FORM: PROSE]"],
    ["pseudocode", "[FORM: PSEUDOCODE]"],
    ["patch", "[FORM: PATCH]"],
    ["trace", "[FORM: TRACE]"],
  ] as const)("renders Delivery form %s", (form, marker) => {
    const { joined } = render(
      understanding([
        respond("r0", "solve", {
          delivery: { depth: "normal", form },
        }),
      ]),
    );
    expect(joined).toContain(marker);
  });

  it("resolves Effect dependencies into ordered preconditions", () => {
    const requests: TurnRequest[] = [
      {
        id: "e0",
        kind: "execute",
        target: "current",
        authorization: "explicit_grant",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
      respond("r1", "fix", { dependsOn: ["e0"] }),
    ];
    const { plan, joined } = render(understanding(requests));

    expect(plan.directives[0]?.preconditions).toEqual([
      { requestId: "e0", kind: "execute", action: "execute_current" },
    ]);
    expect(joined.indexOf("[EXECUTE]")).toBeLessThan(joined.indexOf("[FIX]"));
    expect(joined).toContain("[PRECONDITIONS]");
    expect(joined).toContain("e0:execute_current");
  });

  it("renders authorized persistence effects without rewriting learner content", () => {
    const request: TurnRequest = {
      id: "p0",
      kind: "persist",
      collection: "knowledge_handbook",
      content: "我自己的原话",
      authorization: "ledger_granted",
      sourceClauseIds: ["c0"],
      dependsOn: [],
      evidence: [],
    };
    const { joined } = render(
      understanding([request, respond("r1", "chat", { dependsOn: ["p0"] })]),
    );

    expect(joined).toContain("[PERSIST]");
    expect(joined).toContain("p0:persist_knowledge_handbook");
    expect(joined).not.toContain(request.content);
  });
});

describe("V2 transfer policy", () => {
  it.each(["past_problems", "learner_profile"] as const)(
    "adds a complete transfer plan for Basis %s",
    (basis) => {
      const { plan, joined } = render(
        understanding([
          respond("r0", "understand", {
            basis: ["current_evidence", basis],
          }),
        ]),
      );
      const transfer = plan.directives[0]?.transferPlan;

      expect(transfer).toMatchObject({
        sources: [basis],
        kernel: expect.any(String),
        difference: expect.any(String),
        mapping: expect.any(String),
        strengthBridge: expect.any(String),
        currentCardAnchor: expect.any(String),
      });
      expect(joined).toContain("1. Kernel:");
      expect(joined).toContain("2. Difference:");
      expect(joined).toContain("3. Mapping:");
      expect(joined).toContain("4. Strength bridge:");
      expect(joined).toContain("5. Current-card anchor:");
      expect(joined).toContain(
        "never current-problem identity or diagnostic evidence",
      );
    },
  );

  it("preserves both transfer sources and anchors old patterns to the current card", () => {
    const { plan, joined } = render(
      understanding([
        respond("r0", "solve", {
          basis: ["current_evidence", "past_problems", "learner_profile"],
          delivery: { depth: "hint", form: "prose" },
        }),
      ]),
    );

    expect(plan.directives[0]?.transferPlan?.sources).toEqual([
      "past_problems",
      "learner_profile",
    ]);
    expect(joined).toContain("Transfer the pattern only");
    expect(joined).toContain("Active Problem Card");
  });

  it("does not invent a transfer plan for unrelated Basis", () => {
    const { plan, joined } = render(
      understanding([
        respond("r0", "understand", {
          target: "api",
          basis: ["current_evidence", "api_kb"],
        }),
      ]),
    );

    expect(plan.directives[0]?.transferPlan).toBeUndefined();
    expect(joined).not.toContain("[TRANSFER PLAN]");
  });
});

describe("V2 turn-level policy", () => {
  it("applies anxious_stuck once across compound directives", () => {
    const { joined } = render(
      understanding([respond("r0", "understand"), respond("r1", "solve")], {
        affect: "anxious_stuck",
      }),
    );
    expect(joined.match(/\[STUCK\]/g)).toHaveLength(1);
  });

  it("turns clarification into a no-side-effect response", () => {
    const { joined } = render(
      understanding([], {
      route: {
        kind: "clarify",
        escalationReasons: [],
        clarificationReason: "effect_target_unresolved",
      },
      }),
    );
    expect(joined).toContain("[CLARIFY]");
    expect(joined).toContain("Do not run code or perform a durable write");
  });

  it("keeps pure durable turns backend-owned", () => {
    const { plan, joined } = render(
      understanding([
        {
          id: "p0",
          kind: "persist",
          collection: "preference",
          content: "以后用英文",
          authorization: "ledger_granted",
          sourceClauseIds: ["c0"],
          dependsOn: [],
          evidence: [],
        },
      ]),
    );
    expect(plan.pureDurable).toBe(true);
    expect(joined).toContain("[DURABLE ACTION]");
  });

  it("enforces Python-only scope", () => {
    const { joined } = render(
      understanding([respond("r0", "solve")], {
        languageScope: {
          supportedLanguage: "python",
          unsupportedLanguage: {
            kind: "unsupported_language",
            span: "C++",
            start: 0,
            end: 3,
            sourceClauseId: "c0",
            strength: "hard",
            polarity: "positive",
          },
        },
      }),
    );
    expect(joined).toContain("[PYTHON-ONLY]");
  });
});
