import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import { loadStoredRecentMessages } from "../chat-context-loader";
import type { BootstrappedChatTurn } from "../chat-turn-bootstrap";
import {
  projectCurrentRevisionWindow,
  type ConversationProjection,
  type StoredChatMessageForProjection,
} from "../history-projection";
import type { TurnUnderstanding } from "../turn-understanding/turn-understanding.types";
import type { WorkspaceCodeRevision } from "../workspace-revision";
import {
  buildClassifierBackendFacts,
  buildClassifierContext,
} from "./chat-turn-classifier-context";
import { getTurnClassifier } from "./get-turn-classifier";
import { resolveTurnUnderstanding } from "./resolve-turn-understanding";

export type ClassifierPreload = {
  storedMessages: StoredChatMessageForProjection[];
  historyProjection: ConversationProjection;
};

export async function resolveChatTurnUnderstanding(
  turn: BootstrappedChatTurn,
  args: {
    deterministic: TurnUnderstanding;
    requestedActions: readonly RequestedAction[];
    currentRevision?: WorkspaceCodeRevision;
  },
) {
  let preload: ClassifierPreload | undefined;
  const resolved = await resolveTurnUnderstanding({
    deterministic: args.deterministic,
    classifierFactory: () => classifierForTurn(turn),
    loadClassifierContext: async () => {
      preload = await loadClassifierPreload(turn, args.currentRevision);
      return buildClassifierContext({
        message: turn.input.message,
        projection: preload.historyProjection,
        language: turn.input.language,
        code: turn.input.code,
        selectedTestCount: turn.selectedTestCases.length,
      });
    },
    loadBackendFacts: (context) =>
      buildClassifierBackendFacts({
        message: turn.input.message,
        workspace: context.workspace,
        requestedActions: args.requestedActions,
        deterministic: args.deterministic,
      }),
    traceContext: turn.traceContext,
  });
  return { ...resolved, preload };
}

async function loadClassifierPreload(
  turn: BootstrappedChatTurn,
  currentRevision?: WorkspaceCodeRevision,
): Promise<ClassifierPreload> {
  const storedMessages = await loadStoredRecentMessages(
    turn.chatSession.id,
    turn.chatSession.clearedBeforeSequence,
    turn.db,
  );
  const historyProjection = projectCurrentRevisionWindow({
    storedMessages,
    currentRevision,
    clearedBeforeSequence: turn.chatSession.clearedBeforeSequence,
    maxModelMessages: 8,
  });
  return { storedMessages, historyProjection };
}

function classifierForTurn(turn: BootstrappedChatTurn) {
  if (turn.deps.turnClassifier === null) return undefined;
  return turn.deps.turnClassifier ?? getTurnClassifier();
}
