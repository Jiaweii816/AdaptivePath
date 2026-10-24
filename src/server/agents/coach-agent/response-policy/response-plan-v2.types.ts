import type {
  BasisSource,
  Deliverable,
  DisclosureCeiling,
  RespondTurnRequest,
  ResponseDelivery,
  TurnRequest,
  TurnUnderstandingV2,
  TurnRoute,
} from "../turn-understanding-v2/turn-understanding-v2.types";
import type { CampaignCoachingPolicy } from "@/server/campaign/coaching";

export type ReplyPrecondition = {
  readonly requestId: string;
  readonly kind: TurnRequest["kind"];
  readonly action:
    | "respond"
    | "execute_current"
    | "execute_candidate"
    | "persist_preference"
    | "persist_knowledge_handbook"
    | "persist_mistake_book";
};

export type TransferPlan = {
  readonly sources: readonly Extract<
    BasisSource,
    "past_problems" | "learner_profile"
  >[];
  readonly kernel: string;
  readonly difference: string;
  readonly mapping: string;
  readonly strengthBridge: string;
  readonly currentCardAnchor: string;
};

export type ReplyDirective = {
  readonly request: RespondTurnRequest;
  readonly coreTask: Deliverable;
  readonly deliveryMode: ResponseDelivery;
  readonly preconditions: readonly ReplyPrecondition[];
  readonly transferPlan?: TransferPlan;
};

export type ResponsePlanV2 = {
  readonly objectives: readonly TurnRequest[];
  readonly directives: readonly ReplyDirective[];
  readonly disclosure: DisclosureCeiling;
  readonly affect: "none" | "anxious_stuck";
  readonly route: TurnRoute;
  readonly languageScope: TurnUnderstandingV2["languageScope"];
  readonly compound: boolean;
  readonly pureDurable: boolean;
  readonly hasPendingRequiredAction: boolean;
  readonly campaignPolicy?: CampaignCoachingPolicy;
};
