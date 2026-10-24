import {
  appendTraceEventBestEffort,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";

import type {
  ChatTurnContextNeeds,
  CoachChatIntent,
} from "../coach-agent.types";
import type { TurnUnderstandingMode } from "./turn-understanding-mode";
import type {
  TurnRequest,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

export async function captureTurnUnderstandingV2TraceBestEffort(
  traceContext: TraceContext,
  args: {
    understanding: TurnUnderstandingV2;
    compiledRoute: TurnUnderstandingV2["route"];
    mode: TurnUnderstandingMode;
    contextNeeds: ChatTurnContextNeeds;
    toolCapabilities: readonly ChatToolName[];
    memoryIntent: CoachChatIntent;
    provenance:
      "deterministic_nonsemantic" | "llm_validated" | "semantic_fallback";
    classifierActuallyCalled: boolean;
    effectsBlocked: boolean;
    pendingPersists: readonly DurableWriteToolName[];
    fallbackReason?: string;
  },
) {
  const step = startTraceStep(traceContext, { spanKind: "guard" });
  await appendTraceEventBestEffort(traceContext, {
    step,
    stage: "turn_understanding_v2",
    kind: "guard",
    title: "Whole-turn Turn Understanding V2",
    status: "succeeded",
    details: {
      input: {
        mode: args.mode,
        schemaVersion: args.understanding.schemaVersion,
        compiledRoute: args.compiledRoute,
      },
      output: {
        route: args.understanding.route,
        coverage: args.understanding.coverage,
        requestSignature: args.understanding.requests.map(requestSignature),
        requests: args.understanding.requests,
        effectDenials: args.understanding.effectDenials,
        languageScope: args.understanding.languageScope,
        disclosure: args.understanding.disclosure,
        resolution: {
          provenance: args.provenance,
          classifierActuallyCalled: args.classifierActuallyCalled,
          effectsBlocked: args.effectsBlocked,
          pendingPersists: args.pendingPersists,
          fallbackReason: args.fallbackReason ?? null,
        },
      },
      stateDelta: {
        consumerProjection: {
          contextNeeds: args.contextNeeds,
          toolCapabilities: args.toolCapabilities,
          memoryIntent: args.memoryIntent,
        },
      },
      metadata: {
        schemaVersion: "v2",
        mode: args.mode,
        routeReason: routeReason(args.understanding.route),
        initialRouteKind: args.compiledRoute.kind,
        consumedRouteKind: args.understanding.route.kind,
        provenance: args.provenance,
        fallbackReason: args.fallbackReason ?? "none",
        deterministic: args.provenance !== "llm_validated",
        onlineClassifierCalled: args.classifierActuallyCalled,
      },
    },
  });
}

function routeReason(route: TurnUnderstandingV2["route"]) {
  return route.kind === "clarify"
    ? route.clarificationReason
    : route.escalationReasons.join(",") || "none";
}

function requestSignature(request: TurnRequest) {
  if (request.kind === "respond") {
    return [
      request.kind,
      request.deliverable,
      request.target,
      request.basis.join("+"),
      request.delivery.depth,
      request.delivery.form,
    ].join(":");
  }
  if (request.kind === "execute") {
    return `${request.kind}:${request.target}:${request.authorization}`;
  }
  return `${request.kind}:${request.collection}:${request.authorization}`;
}
