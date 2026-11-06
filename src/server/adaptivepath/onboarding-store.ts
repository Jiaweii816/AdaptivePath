/**
 * Store only bounded, typed initial-context metadata in existing local L1.
 * No learner name, email, free-form responses or raw diagnostic answers are
 * persisted in the onboarding event. Changes are append-only and scoped to
 * the same local learner + memoryOrigin as §12.2 L1/L2/L3.
 */
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { LearnerScope } from "./memory-store";
import type { BiologyOnboardingMetadata } from "@/features/adaptivepath/onboarding/types";
import { ensureInitialLearnerProfile } from "./memory-store";

export const ONBOARDING_EVENT_TYPE="biology_onboarding_metadata_v1";
const unit=z.enum(["chemistry","cell","genetics","evolution","diversity","plant","animal","ecology"]);
const metadataSchema=z.object({
  schemaVersion:z.literal(1),sectionId:z.literal("12.2"),status:z.enum(["completed","skipped"]),
  source:z.literal("initial_self_report_and_diagnostic"),
  studiedUnits:z.array(unit).max(8),
  geneticsFamiliarity:z.enum(["new","some","comfortable","not_provided"]),
  supportPreference:z.enum(["socratic","step_by_step","worked_example","visual","not_provided"]),
  diagnosticCount:z.number().int().min(0).max(5),
  diagnosticCorrect:z.number().int().min(0).max(5),
  conceptSignals:z.array(z.object({
    conceptId:z.string(),status:z.enum(["needs_review","promising","unassessed"]),
    questionsAnswered:z.number().int().min(0).max(5),
    correct:z.number().int().min(0).max(5),
    confidence:z.literal("low"),
  })).max(3),
  firstFocusConceptId:z.string().nullable(),
}).strict();

export async function loadOnboardingMetadata(
  db:PrismaClient,scope:Pick<LearnerScope,"userId"|"memoryOrigin">,
):Promise<BiologyOnboardingMetadata|null>{
  const last=await db.l1MemoryEvent.findFirst({
    where:{userId:scope.userId,memoryOrigin:scope.memoryOrigin,eventType:ONBOARDING_EVENT_TYPE},
    orderBy:{occurredAt:"desc"},
    select:{eventJson:true},
  });
  return last?metadataSchema.parse(JSON.parse(last.eventJson)) as BiologyOnboardingMetadata:null;
}

export async function saveOnboardingMetadata(
  db:PrismaClient,scope:LearnerScope,metadata:BiologyOnboardingMetadata,
):Promise<BiologyOnboardingMetadata>{
  const safe=metadataSchema.parse(metadata) as BiologyOnboardingMetadata;
  await db.l1MemoryEvent.create({
    data:{
      userId:scope.userId,problemId:scope.problemId,chatSessionId:scope.chatSessionId,
      memoryOrigin:scope.memoryOrigin,eventType:ONBOARDING_EVENT_TYPE,source:"adaptivepath_biology",
      // This is structured initial context, never a submission to the L2 grader.
      eventJson:JSON.stringify(safe),
    },
  });
  // The first L3 card must exist immediately after onboarding. All its L2
  // concepts remain unassessed (null); no self-report is promoted to mastery.
  await ensureInitialLearnerProfile(db,scope);
  return safe;
}
