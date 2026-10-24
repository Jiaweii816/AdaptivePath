import { codeRunnerLanguageSchema } from "@/types/code-runner";
import { hashCodeForRun } from "@/server/code/code-hash";

export type WorkspaceCodeRevision = {
  problemId: string;
  codeHash: string;
};

type ReviewSnapshot = {
  language: string;
  codeSnapshot: string;
};

export function buildWorkspaceCodeRevision(args: {
  problemId: string;
  language?: string;
  code?: string;
}): WorkspaceCodeRevision | undefined {
  const language = codeRunnerLanguageSchema.safeParse(args.language);
  if (!language.success || args.code === undefined) {
    return undefined;
  }

  return {
    problemId: args.problemId,
    codeHash: hashCodeForRun({ language: language.data, code: args.code }),
  };
}

export function resolveStoredMessageRevision(args: {
  problemId: string;
  metadataJson: string;
  reviewAttempt?: ReviewSnapshot | null;
}): WorkspaceCodeRevision | undefined {
  const metadataHash = readWorkspaceCodeHash(args.metadataJson);
  if (metadataHash) {
    return { problemId: args.problemId, codeHash: metadataHash };
  }

  if (!args.reviewAttempt) {
    return undefined;
  }

  return buildWorkspaceCodeRevision({
    problemId: args.problemId,
    language: args.reviewAttempt.language,
    code: args.reviewAttempt.codeSnapshot,
  });
}

export function sameWorkspaceCodeRevision(
  left: WorkspaceCodeRevision,
  right: WorkspaceCodeRevision,
) {
  return left.problemId === right.problemId && left.codeHash === right.codeHash;
}

function readWorkspaceCodeHash(metadataJson: string) {
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const workspace = metadata.workspace;
    if (!workspace || typeof workspace !== "object") {
      return undefined;
    }

    const codeHash = (workspace as Record<string, unknown>).currentCodeHash;
    return typeof codeHash === "string" && codeHash.length > 0
      ? codeHash
      : undefined;
  } catch {
    return undefined;
  }
}
