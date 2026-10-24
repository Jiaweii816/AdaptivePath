import { createChatClient } from "@/server/llm/client";
import { getChatThinkingModel } from "@/server/llm/models";
import {
  buildChatToolManifest,
  learningExperienceRecallToolArgsSchema,
} from "@/server/tools/chat-tools/chat-tool-contracts";

const cases = [
  {
    id: "binary-stall",
    shouldCall: true,
    message:
      "为什么这段代码在 target 比较大时会 TLE？\n```python\nwhile left <= right:\n    mid = (left + right) // 2\n    if nums[mid] < target:\n        left = mid\n    else:\n        right = mid - 1\n```",
  },
  {
    id: "sliding-window-stall",
    shouldCall: true,
    message:
      "帮我诊断为什么窗口循环不结束。\n```python\nwhile duplicate_count > 0:\n    seen.remove(s[left])\n# forgot to move left\n```",
  },
  {
    id: "concept-only",
    shouldCall: false,
    message: "请用一句话解释什么是二分查找，不需要结合我的历史。",
  },
];

async function main() {
  const client = createChatClient();
  const tools = buildChatToolManifest(new Set(["recall_learning_experience"]));
  const results = [];
  for (const testCase of cases) {
    const response = await client.chat.completions.create({
      model: getChatThinkingModel(),
      temperature: 0,
      tool_choice: "auto",
      tools,
      messages: [
        {
          role: "system",
          content:
            "You are PatternCoach. Diagnose current Python code yourself. The learning-experience Tool is optional: call it only when a concrete prior learner experience could materially improve a current-code diagnosis. Do not call it for concept-only questions.",
        },
        { role: "user", content: testCase.message },
      ],
    });
    const call = response.choices[0]?.message.tool_calls?.find(
      (item) =>
        item.type === "function" &&
        item.function.name === "recall_learning_experience",
    );
    let parsedArgs: unknown;
    if (call) {
      if (call.type !== "function")
        throw new Error("Unexpected custom Tool call.");
      parsedArgs = learningExperienceRecallToolArgsSchema.parse(
        JSON.parse(call.function.arguments),
      );
    }
    results.push({
      id: testCase.id,
      shouldCall: testCase.shouldCall,
      called: Boolean(call),
      args: parsedArgs,
      finalText: call ? undefined : response.choices[0]?.message.content,
    });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.shouldCall !== result.called)) {
    process.exitCode = 1;
  }
}

void main();
