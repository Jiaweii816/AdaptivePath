import {
  DURABLE_WRITE_TOOL_NAMES,
  type DurableWriteToolName,
} from "../durable-write-types";

export type DurableWriteSpec = {
  targets: readonly RegExp[];
  implicitIntent?: readonly RegExp[];
  displayName: { zh: string; en: string };
};

export const DURABLE_WRITE_REGISTRY = {
  note_memory: {
    targets: [
      /(?:偏好|习惯|默认设置|长期记忆|记忆)/u,
      /\b(?:preference|default setting|long[-_\s]*term memory)\b/iu,
    ],
    implicitIntent: [
      /(?:以后|之后|后面|下次|从现在起|往后|默认).{0,72}(?:请|要|用|使用|别|不要|优先|先|只|都|给我).{0,72}(?:语言|python|c\+\+|中文|英文|解释|提示|答案|完整解|题解|solution|代码|标题|风格|方式|例子)/iu,
      /(?:我(?:更)?喜欢|我(?:不|不太)喜欢|我的偏好|我习惯).{0,72}(?:语言|python|c\+\+|中文|英文|解释|提示|答案|完整解|题解|solution|代码|标题|风格|方式|例子)/iu,
      /我(?:更)?吃.{0,48}(?:手动|例子|解释|提示|代码|风格|方式).{0,72}(?:那种|这一套|这种|别|不要)/iu,
      /(?:以后|之后|后面|下次|从现在起|往后).{0,32}(?:短一点|简短一点|少一点|精简一点)/iu,
      /\b(?:from now on|next time|going forward|by default)\b.{0,96}\b(?:use|answer|explain|show|give|avoid|prefer)\b/iu,
      /\bi (?:prefer|do not like|don't like)\b.{0,96}\b(?:python|c\+\+|chinese|english|explanation|hint|answer|solution|code|title|style|approach|example)\b/iu,
    ],
    displayName: { zh: "长期偏好", en: "Long-term preference" },
  },
  save_knowledge_note: {
    targets: [
      /(?:知识手册|知识本|知识库|知识卡(?:片)?|复习(?:手册|本|里)|手册)/u,
      /\b(?:handbook|knowledge[\s_-]*(?:book|handbook|note|card))\b/iu,
    ],
    implicitIntent: [
      /我想.{0,40}(?:之后|以后).{0,40}复习.{0,24}(?:看到|找到|用到|查到)/iu,
      /(?:这种|这个).{0,32}(?:以后|之后).{0,32}(?:手册|复习).{0,20}(?:看到|找到|查到)/iu,
    ],
    displayName: { zh: "知识手册", en: "Knowledge Handbook" },
  },
  save_mistake_book_entry: {
    targets: [/(?:错题本|错题簿)/u, /\bmistake[\s_-]*(?:book|notebook)\b/iu],
    displayName: { zh: "错题本", en: "Mistake Book" },
  },
} as const satisfies Record<DurableWriteToolName, DurableWriteSpec>;

export function getDurableWriteSpec(
  toolName: DurableWriteToolName,
): DurableWriteSpec {
  return DURABLE_WRITE_REGISTRY[toolName];
}

export function getDurableWriteDisplayName(
  toolName: DurableWriteToolName,
  locale: "zh" | "en",
) {
  return DURABLE_WRITE_REGISTRY[toolName].displayName[locale];
}

export function listDurableWriteSpecs() {
  return DURABLE_WRITE_TOOL_NAMES.map((toolName) => ({
    toolName,
    spec: getDurableWriteSpec(toolName),
  }));
}
