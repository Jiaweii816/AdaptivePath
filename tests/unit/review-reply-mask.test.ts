import { describe, expect, it } from "vitest";
import {
  isSafetyReplacedReview,
  isTier3DegradedReview,
  markReviewReplyRevealed,
  readReviewReplyRevealed,
  reviewReplyRevealStorageKey,
  shouldMaskReviewReply,
} from "@/components/workbench/review-reply-mask";

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("review reply mask helpers", () => {
  it("keys reveal state by review attempt id", () => {
    expect(reviewReplyRevealStorageKey("ra_123")).toBe(
      "patterncoach:review-reply-revealed:ra_123",
    );
  });

  it("masks newly-created review replies until they are revealed", () => {
    const storage = memoryStorage();

    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_1",
        isNewlyCreated: true,
        storage,
      }),
    ).toBe(true);

    markReviewReplyRevealed("ra_1", storage);

    expect(readReviewReplyRevealed("ra_1", storage)).toBe(true);
    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_1",
        isNewlyCreated: true,
        storage,
      }),
    ).toBe(false);
  });

  it("does not mask restored historical review replies by default", () => {
    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_old",
        isNewlyCreated: false,
        storage: memoryStorage(),
      }),
    ).toBe(false);
  });

  it("does not mask tier-3 degraded review replies", () => {
    expect(isTier3DegradedReview({ tier: 3 })).toBe(true);
    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_error",
        degraded: { tier: 3 },
        isNewlyCreated: true,
        storage: memoryStorage(),
      }),
    ).toBe(false);
  });

  it("does not mask safety-replaced review replies", () => {
    expect(isSafetyReplacedReview({ safetyReplaced: true })).toBe(true);
    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_safety",
        degraded: { safetyReplaced: true },
        isNewlyCreated: true,
        storage: memoryStorage(),
      }),
    ).toBe(false);
  });

  it("treats storage failures as unrevealed without throwing", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readReviewReplyRevealed("ra_2", storage)).toBe(false);
    expect(() => markReviewReplyRevealed("ra_2", storage)).not.toThrow();
    expect(
      shouldMaskReviewReply({
        reviewAttemptId: "ra_2",
        isNewlyCreated: true,
        storage,
      }),
    ).toBe(true);
  });
});
