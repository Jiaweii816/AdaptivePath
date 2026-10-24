import type { ClassifierOutput } from "./classifier-output.schema";
import type {
  ClassifierContext,
  TurnClassifier,
} from "./turn-classifier.types";

export function createMockTurnClassifier(
  script: Readonly<Record<string, ClassifierOutput>>,
): TurnClassifier {
  return {
    async classify(ctx: ClassifierContext) {
      const message = ctx.message.trim();
      const hit = script[message];

      if (!hit) {
        throw new Error(`mock classifier: no script for "${message}"`);
      }

      return hit;
    },
  };
}
