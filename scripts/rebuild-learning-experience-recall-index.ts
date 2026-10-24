import { resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import {
  createEmbedClient,
  isEmbeddingConfigured,
} from "@/server/memory/retrieval/embed-client";
import {
  buildLearnerMemoryRetrievalDocuments,
  memoryRetrievalIndexRefId,
  retrievalDocumentFtsContent,
} from "@/server/memory/store/retrieval-document-store";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { createVectorStore } from "@/server/memory/store/vector-store";

const BATCH_SIZE = 10;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveSqliteFilePath(options.db);
  const livePath = resolve(process.cwd(), "dev.db");
  if (resolve(dbPath) === livePath && !options.allowLearnerDb) {
    throw new Error("Refusing learner dev.db without --allow-learner-db.");
  }
  if (!isEmbeddingConfigured()) {
    throw new Error(
      "Embedding provider is not configured; refusing a partial index rebuild.",
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });
  const fts = createFtsStore(dbPath);
  const embed = createEmbedClient();
  const vector = createVectorStore(dbPath, embed.dim);
  try {
    const user = await prisma.user.findUnique({
      where: { handle: options.user },
      select: { id: true },
    });
    if (!user) throw new Error(`Unknown learner: ${options.user}`);
    const documents = (
      await buildLearnerMemoryRetrievalDocuments(prisma, { userId: user.id })
    ).filter(
      (document) =>
        document.retrievalTextVersion > 0 &&
        ["review_episode", "l2_fact", "l3_synthesis"].includes(
          document.sourceKind,
        ),
    );
    const kinds = ["episode", "fact", "synthesis"] as const;
    for (const kind of kinds) {
      const selected = documents.filter(
        (document) => document.ftsKind === kind,
      );
      fts.reconcileMemoryDocuments({
        kind,
        learnerId: user.id,
        documents: selected.map((document) => ({
          refId: memoryRetrievalIndexRefId(document),
          content: retrievalDocumentFtsContent(document),
        })),
      });
      vector.reconcileProjectionRefs({
        kind,
        learnerId: user.id,
        refIds: selected.map(memoryRetrievalIndexRefId),
      });
    }
    for (let start = 0; start < documents.length; start += BATCH_SIZE) {
      const batch = documents.slice(start, start + BATCH_SIZE);
      const embeddings = await embed.embed(
        batch.map(retrievalDocumentFtsContent),
      );
      batch.forEach((document, index) => {
        const embedding = embeddings[index];
        if (!embedding)
          throw new Error(`Missing embedding for ${document.documentId}`);
        vector.upsertEmbedding({
          kind: document.ftsKind,
          refId: memoryRetrievalIndexRefId(document),
          learnerId: user.id,
          embedding,
          contentHash: document.contentHash,
          embeddingModel: embed.model,
        });
      });
    }
    console.log(
      JSON.stringify({
        learnerId: user.id,
        indexed: documents.length,
        byLayer: Object.fromEntries(
          kinds.map((kind) => [
            kind,
            documents.filter((document) => document.ftsKind === kind).length,
          ]),
        ),
        embeddingModel: embed.model,
      }),
    );
  } finally {
    fts.close();
    vector.close();
    await prisma.$disconnect();
  }
}

function parseArgs(argv: string[]) {
  let db: string | undefined;
  let user: string | undefined;
  let allowLearnerDb = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--allow-learner-db") {
      allowLearnerDb = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argv[index]} requires a value.`);
    if (argv[index] === "--db") db = value;
    else if (argv[index] === "--user") user = value;
    else throw new Error(`Unknown argument: ${argv[index]}`);
    index += 1;
  }
  if (!db || !user) {
    throw new Error(
      "Usage: --db <sqlite> --user <handle> [--allow-learner-db]",
    );
  }
  return { db, user, allowLearnerDb };
}

void main();
