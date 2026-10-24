import type { PrismaClient } from "@prisma/client";
import type { SeedLearnerManifest } from "../seed-learner/manifest";
import type {
  MemoryManifestLookup,
  RetrievedMemoryItem,
} from "./memory-retrieval-metrics";

type FullHistoryPrisma = Pick<PrismaClient, "l2MemoryFact" | "memoryEpisode">;

export type FullHistoryContext = {
  promptText: string;
  retrieved: RetrievedMemoryItem[];
  includedFactIds: string[];
  includedEpisodeIds: string[];
};

export async function buildEvalOnlyFullHistoryContext(
  prisma: FullHistoryPrisma,
  args: {
    manifest: SeedLearnerManifest;
    lookup: MemoryManifestLookup;
    problemSlug: string;
    userQuestion: string;
    includeL2Facts: boolean;
  },
): Promise<FullHistoryContext> {
  const [factRows, episodeRows] = await Promise.all([
    args.includeL2Facts
      ? prisma.l2MemoryFact.findMany({
          where: { userId: args.manifest.userId },
          orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    prisma.memoryEpisode.findMany({
      where: { userId: args.manifest.userId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  ]);

  const items: RetrievedMemoryItem[] = [];
  let promptIndex = 0;

  for (const fact of factRows) {
    const key = args.lookup.factKeyById.get(fact.id);
    items.push({
      kind: "fact",
      id: fact.id,
      key,
      label: fact.label ?? fact.tag,
      score: promptScore(promptIndex),
      unknown: !key,
    });
    promptIndex += 1;
  }

  for (const episode of episodeRows) {
    const key = args.lookup.episodeKeyById.get(episode.id);
    items.push({
      kind: "episode",
      id: episode.id,
      key,
      label: episode.title,
      score: promptScore(promptIndex),
      unknown: !key,
    });
    promptIndex += 1;
  }

  return {
    promptText: renderFullHistoryPrompt({
      problemSlug: args.problemSlug,
      userQuestion: args.userQuestion,
      includeL2Facts: args.includeL2Facts,
      facts: factRows.map((fact) => ({
        id: fact.id,
        key: args.lookup.factKeyById.get(fact.id),
        factType: fact.factType,
        tag: fact.tag,
        label: fact.label,
        status: fact.status,
        confidence: fact.confidence,
        value: fact.value,
      })),
      episodes: episodeRows.map((episode) => ({
        id: episode.id,
        key: args.lookup.episodeKeyById.get(episode.id),
        title: episode.title,
        outcome: episode.outcome,
        summary: episode.summary,
      })),
    }),
    retrieved: items,
    includedFactIds: factRows.map((fact) => fact.id),
    includedEpisodeIds: episodeRows.map((episode) => episode.id),
  };
}

export function renderFullHistoryPrompt(args: {
  problemSlug: string;
  userQuestion: string;
  includeL2Facts: boolean;
  facts: Array<{
    id: string;
    key?: string;
    factType: string;
    tag: string;
    label: string | null;
    status: string;
    confidence: number;
    value: string | null;
  }>;
  episodes: Array<{
    id: string;
    key?: string;
    title: string;
    outcome: string;
    summary: string;
  }>;
}) {
  const lines = [
    "EVAL-ONLY FULL HISTORY MEMORY CONTEXT",
    `Problem: ${args.problemSlug}`,
    `User question: ${args.userQuestion}`,
    `L2 facts included: ${args.includeL2Facts ? "yes" : "no"}`,
    "",
  ];

  if (args.includeL2Facts) {
    lines.push("L2 facts:");
    if (args.facts.length === 0) {
      lines.push("- none");
    }
    for (const fact of args.facts) {
      lines.push(
        `- factId=${fact.id}; key=${fact.key ?? "unknown"}; type=${fact.factType}; status=${fact.status}; confidence=${fact.confidence}; tag=${fact.tag}; label=${fact.label ?? fact.value ?? fact.tag}`,
      );
    }
    lines.push("");
  }

  lines.push("Memory episodes:");
  if (args.episodes.length === 0) {
    lines.push("- none");
  }
  for (const episode of args.episodes) {
    lines.push(
      `- episodeId=${episode.id}; key=${episode.key ?? "unknown"}; outcome=${episode.outcome}; title=${episode.title}; summary=${episode.summary}`,
    );
  }

  return lines.join("\n");
}

function promptScore(index: number) {
  return 1 / (index + 1);
}
