import { createHash } from "node:crypto";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import type { CoachMemoryAssembly } from "@/server/memory";
import type {
  CampaignCoachingPolicy,
  CampaignCoachingPolicyInput,
} from "./contracts";

const ORDINARY_REASON = "ordinary_workbench";

/** Pure, deterministic projection. Campaign role is trusted context, not intent. */
export function deriveCampaignCoachingPolicy(
  input: CampaignCoachingPolicyInput,
): CampaignCoachingPolicy {
  const context = input.campaignContext;
  if (!context) {
    return buildPolicy({
      coachingMode: "ordinary",
      defaultDisclosureDepth: "normal",
      effectiveDisclosureCeiling: input.disclosureCeiling,
      automaticTechnicalMemoryCueBudget: 2,
      mayProactivelyNameNode: true,
      mayProactivelyNamePattern: true,
      shouldPromptTransfer: false,
      shouldFocusRepairCause: false,
      shouldWarnAssessmentContamination: false,
      explicitDisclosureOverride: input.requests.explicitFullRequest,
      policyReason: ORDINARY_REASON,
    });
  }

  const explicitAssessmentOverride =
    input.requests.explicitFullRequest ||
    input.requests.explicitHistoryRequest ||
    input.requests.explicitProfileRequest ||
    input.requests.explicitPatternRequest;
  if (context.settled) {
    return buildPolicy({
      coachingMode: "ordinary",
      defaultDisclosureDepth: "normal",
      effectiveDisclosureCeiling: input.disclosureCeiling,
      automaticTechnicalMemoryCueBudget: 2,
      mayProactivelyNameNode: true,
      mayProactivelyNamePattern: true,
      shouldPromptTransfer: false,
      shouldFocusRepairCause: false,
      shouldWarnAssessmentContamination: false,
      explicitDisclosureOverride: input.requests.explicitFullRequest,
      policyReason: `${context.slotRole}_settled_review`,
    });
  }

  switch (context.slotRole) {
    case "advance":
      return buildPolicy({
        coachingMode: "guided_learning",
        defaultDisclosureDepth: "normal",
        effectiveDisclosureCeiling: input.disclosureCeiling,
        automaticTechnicalMemoryCueBudget: 1,
        mayProactivelyNameNode: true,
        mayProactivelyNamePattern: true,
        shouldPromptTransfer: false,
        shouldFocusRepairCause: false,
        shouldWarnAssessmentContamination: false,
        explicitDisclosureOverride: input.requests.explicitFullRequest,
        policyReason: "advance_build_mechanism",
      });
    case "target":
      return buildPolicy({
        coachingMode: "transfer_practice",
        defaultDisclosureDepth: "hint",
        effectiveDisclosureCeiling: input.disclosureCeiling,
        automaticTechnicalMemoryCueBudget: 1,
        mayProactivelyNameNode: true,
        mayProactivelyNamePattern: true,
        shouldPromptTransfer: true,
        shouldFocusRepairCause: false,
        shouldWarnAssessmentContamination: false,
        explicitDisclosureOverride: input.requests.explicitFullRequest,
        policyReason: "target_verify_transfer",
      });
    case "remedial":
      return buildPolicy({
        coachingMode: "targeted_repair",
        defaultDisclosureDepth: "hint",
        effectiveDisclosureCeiling: input.disclosureCeiling,
        automaticTechnicalMemoryCueBudget: 1,
        mayProactivelyNameNode: true,
        mayProactivelyNamePattern: true,
        shouldPromptTransfer: false,
        shouldFocusRepairCause: true,
        shouldWarnAssessmentContamination: false,
        explicitDisclosureOverride: input.requests.explicitFullRequest,
        policyReason: context.repairReason
          ? "remedial_trusted_repair_focus"
          : "remedial_local_check",
      });
    case "probe":
      return buildPolicy({
        coachingMode: "assessment_probe",
        defaultDisclosureDepth: "hint",
        effectiveDisclosureCeiling: input.disclosureCeiling,
        automaticTechnicalMemoryCueBudget: 0,
        mayProactivelyNameNode: explicitAssessmentOverride,
        mayProactivelyNamePattern: explicitAssessmentOverride,
        shouldPromptTransfer: false,
        shouldFocusRepairCause: false,
        shouldWarnAssessmentContamination: explicitAssessmentOverride,
        explicitDisclosureOverride: input.requests.explicitFullRequest,
        policyReason: explicitAssessmentOverride
          ? "probe_explicit_help_override"
          : "probe_preserve_assessment",
      });
    case "mixed":
      return buildPolicy({
        coachingMode: "interview_mix",
        defaultDisclosureDepth: "hint",
        effectiveDisclosureCeiling: input.disclosureCeiling,
        automaticTechnicalMemoryCueBudget: 0,
        mayProactivelyNameNode:
          input.requests.explicitPatternRequest ||
          input.requests.explicitFullRequest,
        mayProactivelyNamePattern:
          input.requests.explicitPatternRequest ||
          input.requests.explicitFullRequest,
        shouldPromptTransfer: false,
        shouldFocusRepairCause: false,
        shouldWarnAssessmentContamination: false,
        explicitDisclosureOverride: input.requests.explicitFullRequest,
        policyReason:
          input.requests.explicitPatternRequest ||
          input.requests.explicitFullRequest
            ? "mixed_explicit_pattern_override"
            : "mixed_preserve_pattern_recognition",
      });
  }
}

function buildPolicy(
  policy: Omit<CampaignCoachingPolicy, "fingerprint">,
): CampaignCoachingPolicy {
  const stableTuple = [
    policy.coachingMode,
    policy.defaultDisclosureDepth,
    policy.effectiveDisclosureCeiling,
    policy.automaticTechnicalMemoryCueBudget,
    policy.mayProactivelyNameNode,
    policy.mayProactivelyNamePattern,
    policy.shouldPromptTransfer,
    policy.shouldFocusRepairCause,
    policy.shouldWarnAssessmentContamination,
    policy.explicitDisclosureOverride,
    policy.policyReason,
  ].join("|");
  return {
    ...policy,
    fingerprint: createHash("sha256")
      .update(stableTuple)
      .digest("hex")
      .slice(0, 16),
  };
}

/** Filters only the final automatic projection; retrieval and explicit tools remain intact. */
export function projectCampaignMemoryBrief(
  brief: CoachMemoryBrief,
  policy: CampaignCoachingPolicy,
): CoachMemoryBrief {
  if (policy.coachingMode === "ordinary") return brief;
  const budget = policy.automaticTechnicalMemoryCueBudget;
  const ranked = rankRoleRelevantCues(brief, policy.coachingMode);
  return {
    ...brief,
    teachableMemories: ranked.slice(0, budget),
    domainReferences: [],
    teachingStrategy: budget === 0 ? undefined : brief.teachingStrategy,
  };
}

export function projectCampaignMemoryAssembly(
  assembly: CoachMemoryAssembly,
  policy: CampaignCoachingPolicy,
): CoachMemoryAssembly {
  if (policy.coachingMode === "ordinary") return assembly;
  return {
    ...assembly,
    brief: projectCampaignMemoryBrief(assembly.brief, policy),
    candidateFingerprint: createHash("sha256")
      .update(`${assembly.candidateFingerprint}|${policy.fingerprint}`)
      .digest("hex")
      .slice(0, 16),
  };
}

function rankRoleRelevantCues(
  brief: CoachMemoryBrief,
  mode: CampaignCoachingPolicy["coachingMode"],
) {
  const cues = [...brief.teachableMemories];
  if (mode === "transfer_practice") {
    return cues.sort(
      (left, right) =>
        Number(right.kind === "successful_transfer") -
        Number(left.kind === "successful_transfer"),
    );
  }
  if (mode === "targeted_repair") {
    return cues.sort(
      (left, right) =>
        Number(right.kind === "recurring_mistake") -
        Number(left.kind === "recurring_mistake"),
    );
  }
  return cues;
}
