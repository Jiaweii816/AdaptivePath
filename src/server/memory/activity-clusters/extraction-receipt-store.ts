import {
  extractionReceiptStatusSchema,
  type ExtractionReceiptStatus,
} from "./activity-cluster.types";
import type { ActivityClusterDb, ActivityClusterTx } from "./activity-source";
import { loadSealedActivityClusterInputTx } from "./load-sealed-activity-cluster";

export type EnsureExtractionReceiptArgs = {
  activityClusterId: string;
  extractorVersion: string;
  now?: Date;
};

export async function ensureExtractionReceipt(
  prisma: ActivityClusterDb,
  args: EnsureExtractionReceiptArgs,
) {
  return prisma.$transaction((tx) => ensureExtractionReceiptTx(tx, args));
}

export async function ensureExtractionReceiptTx(
  tx: ActivityClusterTx,
  args: EnsureExtractionReceiptArgs,
) {
  const extractorVersion = requireExtractorVersion(args.extractorVersion);
  const input = await loadSealedActivityClusterInputTx(
    tx,
    args.activityClusterId,
  );
  const now = args.now ?? new Date();
  const terminalPolicyRejection = input.cluster.memoryOrigin !== "learner";
  const existing = await tx.memoryExtractionReceipt.findUnique({
    where: {
      activityClusterId_extractorVersion: {
        activityClusterId: input.cluster.id,
        extractorVersion,
      },
    },
  });
  if (existing) {
    if (existing.inputHash !== input.inputHash) {
      throw new Error("extraction_receipt_input_hash_mismatch");
    }
    extractionReceiptStatusSchema.parse(existing.status);
    return existing;
  }
  return tx.memoryExtractionReceipt.create({
    data: {
      activityClusterId: input.cluster.id,
      extractorVersion,
      status: terminalPolicyRejection ? "policy_rejected" : "queued",
      inputHash: input.inputHash,
      noSemanticReason: terminalPolicyRejection
        ? `memory_origin_not_learner:${input.cluster.memoryOrigin}`
        : null,
      completedAt: terminalPolicyRejection ? now : null,
    },
  });
}

export async function claimExtractionReceipt(
  prisma: ActivityClusterDb,
  args: EnsureExtractionReceiptArgs,
) {
  const receipt = await ensureExtractionReceipt(prisma, args);
  if (receipt.status === "policy_rejected") {
    return { claimed: false as const, receipt };
  }
  const now = args.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.memoryExtractionReceipt.updateMany({
      where: {
        id: receipt.id,
        status: { in: ["queued", "failed"] },
        inputHash: receipt.inputHash,
      },
      data: {
        status: "running",
        startedAt: now,
        completedAt: null,
        outputHash: null,
        noSemanticReason: null,
        errorMessage: null,
      },
    });
    return {
      claimed: claimed.count === 1,
      receipt: await tx.memoryExtractionReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    } as const;
  });
}

export async function completeExtractionReceipt(
  prisma: ActivityClusterDb,
  args: {
    receiptId: string;
    status: "succeeded" | "partial" | "no_semantic_signal";
    outputHash?: string;
    noSemanticReason?: string;
    now?: Date;
  },
) {
  if (
    (args.status === "succeeded" || args.status === "partial") &&
    !args.outputHash?.trim()
  ) {
    throw new Error("successful_extraction_requires_output_hash");
  }
  if (args.status === "no_semantic_signal" && !args.noSemanticReason?.trim()) {
    throw new Error("no_semantic_signal_requires_reason");
  }
  return finishRunningReceipt(prisma, {
    receiptId: args.receiptId,
    status: args.status,
    outputHash: args.outputHash?.trim() ?? null,
    noSemanticReason: args.noSemanticReason?.trim() ?? null,
    errorMessage: null,
    now: args.now ?? new Date(),
  });
}

export async function failExtractionReceipt(
  prisma: ActivityClusterDb,
  args: { receiptId: string; errorMessage: string; now?: Date },
) {
  const message = args.errorMessage.trim();
  if (!message) throw new Error("failed_extraction_requires_error");
  return finishRunningReceipt(prisma, {
    receiptId: args.receiptId,
    status: "failed",
    outputHash: null,
    noSemanticReason: null,
    errorMessage: message.slice(0, 2_000),
    now: args.now ?? new Date(),
  });
}

async function finishRunningReceipt(
  prisma: ActivityClusterDb,
  args: {
    receiptId: string;
    status: Extract<
      ExtractionReceiptStatus,
      "succeeded" | "partial" | "no_semantic_signal" | "failed"
    >;
    outputHash: string | null;
    noSemanticReason: string | null;
    errorMessage: string | null;
    now: Date;
  },
) {
  extractionReceiptStatusSchema.parse(args.status);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.memoryExtractionReceipt.updateMany({
      where: { id: args.receiptId, status: "running" },
      data: {
        status: args.status,
        outputHash: args.outputHash,
        noSemanticReason: args.noSemanticReason,
        errorMessage: args.errorMessage,
        completedAt: args.now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("extraction_receipt_not_running");
    }
    return tx.memoryExtractionReceipt.findUniqueOrThrow({
      where: { id: args.receiptId },
    });
  });
}

function requireExtractorVersion(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error("invalid_extractor_version");
  }
  return normalized;
}
