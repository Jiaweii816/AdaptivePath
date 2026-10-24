import type { CoachReviewDegradation } from "@/types/coach";

export type ReviewReplyStorage = Pick<Storage, "getItem" | "setItem">;

export const reviewReplyRevealStorageKeyPrefix =
  "patterncoach:review-reply-revealed:";

export function reviewReplyRevealStorageKey(reviewAttemptId: string) {
  return `${reviewReplyRevealStorageKeyPrefix}${reviewAttemptId}`;
}

export function isTier3DegradedReview(
  degraded?: Pick<CoachReviewDegradation, "tier"> | null,
) {
  return degraded?.tier === 3;
}

export function isSafetyReplacedReview(
  degraded?: Pick<CoachReviewDegradation, "safetyReplaced"> | null,
) {
  return degraded?.safetyReplaced === true;
}

export function readReviewReplyRevealed(
  reviewAttemptId: string,
  storage?: ReviewReplyStorage | null,
) {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(reviewReplyRevealStorageKey(reviewAttemptId)) === "1";
  } catch {
    return false;
  }
}

export function markReviewReplyRevealed(
  reviewAttemptId: string,
  storage?: ReviewReplyStorage | null,
) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(reviewReplyRevealStorageKey(reviewAttemptId), "1");
  } catch {
    // Storage can be unavailable in private contexts; revealing should still work in memory.
  }
}

export function shouldMaskReviewReply(args: {
  reviewAttemptId: string;
  degraded?: Pick<CoachReviewDegradation, "tier" | "safetyReplaced"> | null;
  isNewlyCreated: boolean;
  storage?: ReviewReplyStorage | null;
}) {
  if (
    !args.isNewlyCreated ||
    isTier3DegradedReview(args.degraded) ||
    isSafetyReplacedReview(args.degraded)
  ) {
    return false;
  }

  return !readReviewReplyRevealed(args.reviewAttemptId, args.storage);
}
