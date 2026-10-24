import type {
  CampaignSlotRole,
  LearningNodeKind,
} from "../curriculum";

export const CAMPAIGN_COACHING_MODES = [
  "ordinary",
  "guided_learning",
  "transfer_practice",
  "targeted_repair",
  "assessment_probe",
  "interview_mix",
] as const;

export type CampaignCoachingMode =
  (typeof CAMPAIGN_COACHING_MODES)[number];

export type CampaignCoachingRequestSignals = Readonly<{
  explicitFullRequest: boolean;
  explicitHistoryRequest: boolean;
  explicitProfileRequest: boolean;
  explicitPatternRequest: boolean;
}>;

export type CampaignCoachingPolicy = Readonly<{
  coachingMode: CampaignCoachingMode;
  defaultDisclosureDepth: "hint" | "normal";
  effectiveDisclosureCeiling: "guided" | "full_code";
  automaticTechnicalMemoryCueBudget: 0 | 1 | 2;
  mayProactivelyNameNode: boolean;
  mayProactivelyNamePattern: boolean;
  shouldPromptTransfer: boolean;
  shouldFocusRepairCause: boolean;
  shouldWarnAssessmentContamination: boolean;
  explicitDisclosureOverride: boolean;
  policyReason: string;
  fingerprint: string;
}>;

export type CampaignCoachingContext = Readonly<{
  taskItemId: string;
  attemptId: string;
  slotRole: CampaignSlotRole;
  settled: boolean;
  nodeKind: LearningNodeKind;
  nodeNameInternal: string;
  nodeLabelAliasesInternal: readonly string[];
  coreInvariantInternal: string;
  repairReason?: string;
  policy: CampaignCoachingPolicy;
}>;

export type CampaignCoachingPolicyInput = Readonly<{
  campaignContext:
    | Readonly<{
        slotRole: CampaignSlotRole;
        settled: boolean;
        nodeKind: LearningNodeKind;
        nodeNameInternal: string;
        nodeLabelAliasesInternal?: readonly string[];
        coreInvariantInternal: string;
        repairReason?: string;
      }>
    | null;
  requests: CampaignCoachingRequestSignals;
  disclosureCeiling: "guided" | "full_code";
}>;
