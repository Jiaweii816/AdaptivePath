import type { SemanticClassifierOutput } from "./semantic-classifier-output.schema";
import type {
  SemanticClassifierContext,
  SemanticTurnClassifier,
} from "./semantic-turn-classifier.types";

export function createMockSemanticTurnClassifier(
  script: Readonly<Record<string, SemanticClassifierOutput | Error>>,
): SemanticTurnClassifier {
  return {
    async classify(context: SemanticClassifierContext) {
      const result = script[context.message.trim()];
      if (!result) {
        throw new Error(`No semantic classifier fixture for: ${context.message}`);
      }
      if (result instanceof Error) throw result;
      return result;
    },
  };
}
