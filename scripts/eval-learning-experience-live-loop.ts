import { resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { createChatClient } from "@/server/llm/client";
import { getChatThinkingModel } from "@/server/llm/models";
import { recallThreeLayerLearningExperiences } from "@/server/memory/learning-experience-recall/three-layer-recall";
import { createEmbedClient } from "@/server/memory/retrieval/embed-client";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { createVectorStore } from "@/server/memory/store/vector-store";
import {
  buildChatToolManifest,
  learningExperienceRecallToolArgsSchema,
} from "@/server/tools/chat-tools/chat-tool-contracts";

const dbPath = resolve(process.argv[2] ?? "dev.db");
const userMessage = `为什么这个整数平方根实现对 x=1 返回 0？
\`\`\`python
def mySqrt(x):
    left, right = 0, x
    while left < right:
        mid = (left + right) // 2
        if mid * mid < x:
            left = mid + 1
        else:
            right = mid
    return left - 1
\`\`\``;

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });
  const fts = createFtsStore(dbPath);
  const embed = createEmbedClient();
  const vector = createVectorStore(dbPath, embed.dim);
  const client = createChatClient();
  try {
    const learner = await prisma.user.findUniqueOrThrow({
      where: { handle: "Iris904" },
    });
    const messages = [
      {
        role: "system" as const,
        content:
          "You are PatternCoach. Diagnose current Python code yourself. The learning-experience Tool is optional: call it only when concrete prior learner experience could improve this diagnosis. After retrieval, independently decide whether each result is truly relevant; ignore irrelevant results. Never expose tool names or internal ids.",
      },
      { role: "user" as const, content: userMessage },
    ];
    const first = await client.chat.completions.create({
      model: getChatThinkingModel(),
      temperature: 0,
      tool_choice: "auto",
      tools: buildChatToolManifest(new Set(["recall_learning_experience"])),
      messages,
    });
    const assistant = first.choices[0]?.message;
    const call = assistant?.tool_calls?.find(
      (item) =>
        item.type === "function" &&
        item.function.name === "recall_learning_experience",
    );
    if (!call || call.type !== "function") {
      throw new Error("DeepSeek did not choose the optional recall Tool.");
    }
    const args = learningExperienceRecallToolArgsSchema.parse(
      JSON.parse(call.function.arguments),
    );
    const recalled = await recallThreeLayerLearningExperiences({
      prisma,
      learnerId: learner.id,
      ftsKeywords: args.ftsKeywords,
      failurePattern: args.failurePattern,
      successPattern: args.successPattern,
      ftsStore: fts,
      vectorStore: vector,
      embedClient: embed,
    });
    const final = await client.chat.completions.create({
      model: getChatThinkingModel(),
      temperature: 0,
      messages: [
        ...messages,
        assistant,
        {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            experiences: recalled.experiences,
            instruction:
              "Diagnose current code first. Use a historical experience only if its concrete mechanism transfers; otherwise ignore it. Similarity is not proof.",
          }),
        },
      ],
    });
    console.log(
      JSON.stringify(
        {
          toolCalled: true,
          args,
          recalled: recalled.experiences,
          finalReply: final.choices[0]?.message.content,
        },
        null,
        2,
      ),
    );
  } finally {
    fts.close();
    vector.close();
    await prisma.$disconnect();
  }
}

void main();
