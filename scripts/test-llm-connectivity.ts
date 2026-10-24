import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import * as path from "path";
import * as dotenv from "dotenv";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const NODES = [
  {
    label: "LLM #1 — Review (DeepSeek V4 Flash)",
    apiKey: (process.env.LLM_REVIEW_API_KEY || process.env.LLM_CHAT_API_KEY)!,
    baseURL: process.env.LLM_REVIEW_BASE_URL || process.env.LLM_CHAT_BASE_URL,
    model:
      process.env.LLM_REVIEW_MODEL ??
      process.env.LLM_CHAT_MODEL ??
      "deepseek-v4-flash",
  },
  {
    label: "LLM #2 — Chat (DeepSeek V4 Flash)",
    apiKey: process.env.LLM_CHAT_API_KEY!,
    baseURL: process.env.LLM_CHAT_BASE_URL,
    model: process.env.LLM_CHAT_MODEL ?? "deepseek-v4-flash",
  },
  {
    label: "LLM #3 — Memory (Qwen3-8B, DashScope)",
    apiKey: process.env.LLM_MEMORY_API_KEY!,
    baseURL: process.env.LLM_MEMORY_BASE_URL,
    model: process.env.LLM_MEMORY_MODEL ?? "qwen3-8b",
  },
];

type ChatCompletionParamsWithThinking =
  ChatCompletionCreateParamsNonStreaming & {
    enable_thinking?: boolean;
  };

async function testNode(node: (typeof NODES)[number]) {
  const client = new OpenAI({ apiKey: node.apiKey, baseURL: node.baseURL });
  const start = Date.now();
  const request: ChatCompletionParamsWithThinking = {
    model: node.model,
    max_tokens: 64,
    ...deepSeekV4ThinkingParams(node.model, "disabled"),
    enable_thinking: false, // Qwen3 non-streaming requirement (DashScope)
    messages: [{ role: "user", content: "Say OK" }],
  };
  const completion = await client.chat.completions.create(request);
  const ms = Date.now() - start;
  const reply = completion.choices[0]?.message.content ?? "";
  if (!reply.trim()) {
    throw new Error(
      `empty response from ${node.model}; check thinking-mode controls`,
    );
  }
  return { reply, ms };
}

async function main() {
  for (const node of NODES) {
    process.stdout.write(`\n${node.label}\n  model: ${node.model}\n  → `);
    try {
      const { reply, ms } = await testNode(node);
      console.log(`✓  "${reply}"  (${ms}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗  ${msg}`);
    }
  }
}

main();
