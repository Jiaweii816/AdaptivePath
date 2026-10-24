import { createRequire } from "node:module";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type SqliteStatement = {
  all: (...parameters: unknown[]) => unknown[];
};

type SqliteDatabase = {
  close: () => void;
  pragma: (source: string) => unknown;
  prepare: (source: string) => SqliteStatement;
};

type SqliteConstructor = new (
  path: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteDatabase;

type ReviewRow = {
  reviewAttemptId: string;
  chatSessionId: string;
  reviewCreatedAt: string;
  language: string;
  sessionTitle: string;
  problemTitle: string;
  problemSlug: string;
  leetcodeNumber: number | null;
  userIssueSummary: string | null;
  coachSummary: string | null;
  selfCheckQuestion: string | null;
  selfCheckAnswer: string | null;
  diagnosisJson: string;
};

type MessageRow = {
  id: string;
  sessionId: string;
  reviewAttemptId: string | null;
  role: string;
  contentMarkdown: string;
  sequence: number;
  createdAt: string;
};

type ActivityCluster = ReviewRow & {
  anchorSequence: number;
  messages: MessageRow[];
};

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

function readArg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replaceAll("\u0000", "").replaceAll("\r\n", "\n").trim();
}

function quoteBlock(value: string | null | undefined, fallback: string): string {
  const text = normalizeText(value) || fallback;
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeTable(value: string): string {
  return normalizeText(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function parseRunStatus(diagnosisJson: string): string {
  const labels: Record<string, string> = {
    failed: "可见测试失败",
    passed: "可见测试通过",
    passed_visible_tests: "可见测试通过",
    runtime_error: "运行错误",
    runner_error: "执行工具不可用",
    static_examiner: "仅静态检查",
    syntax_error: "语法错误",
    timeout: "运行超时",
  };

  try {
    const parsed = JSON.parse(diagnosisJson) as { runStatus?: unknown };
    return typeof parsed.runStatus === "string"
      ? (labels[parsed.runStatus] ?? parsed.runStatus)
      : "未记录";
  } catch {
    return "未记录";
  }
}

const chicagoDateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const chicagoDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseTimestamp(value: string): Date {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function formatDateTime(value: string): string {
  return chicagoDateTime.format(parseTimestamp(value)).replaceAll("/", "-");
}

function formatDate(value: string): string {
  return chicagoDate.format(parseTimestamp(value)).replaceAll("/", "-");
}

function renderConversation(cluster: ActivityCluster): string {
  if (cluster.messages.length === 0) {
    return "（没有找到与这次 Review 对应的对话消息。）";
  }

  return cluster.messages
    .map((message, index) => {
      const isReviewReply = message.reviewAttemptId === cluster.reviewAttemptId;
      const speaker = message.role === "user" ? "你" : "Coach";
      const kind = isReviewReply ? " · Review 回复" : "";
      return [
        `**${speaker}${kind}** · ${formatDateTime(message.createdAt)}`,
        "",
        quoteBlock(message.contentMarkdown, "（空消息）"),
        index === cluster.messages.length - 1 ? "" : "\n---",
      ].join("\n");
    })
    .join("\n");
}

function buildClusters(reviews: ReviewRow[], messages: MessageRow[]): ActivityCluster[] {
  const messagesBySession = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const list = messagesBySession.get(message.sessionId) ?? [];
    list.push(message);
    messagesBySession.set(message.sessionId, list);
  }
  for (const list of messagesBySession.values()) {
    list.sort((a, b) => a.sequence - b.sequence);
  }

  const reviewsBySession = new Map<string, ReviewRow[]>();
  for (const review of reviews) {
    const list = reviewsBySession.get(review.chatSessionId) ?? [];
    list.push(review);
    reviewsBySession.set(review.chatSessionId, list);
  }

  const clusters: ActivityCluster[] = [];
  for (const [sessionId, sessionReviews] of reviewsBySession) {
    const sessionMessages = messagesBySession.get(sessionId) ?? [];
    const anchoredReviews = sessionReviews
      .map((review) => ({
        ...review,
        anchorSequence:
          sessionMessages.find(
            (message) => message.reviewAttemptId === review.reviewAttemptId,
          )?.sequence ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) =>
        a.anchorSequence === b.anchorSequence
          ? parseTimestamp(a.reviewCreatedAt).getTime() -
            parseTimestamp(b.reviewCreatedAt).getTime()
          : a.anchorSequence - b.anchorSequence,
      );

    for (const [index, review] of anchoredReviews.entries()) {
      const startSequence =
        index === 0 ? Number.MIN_SAFE_INTEGER : review.anchorSequence;
      const nextAnchor =
        anchoredReviews[index + 1]?.anchorSequence ?? Number.MAX_SAFE_INTEGER;
      clusters.push({
        ...review,
        messages: sessionMessages.filter(
          (message) =>
            message.sequence >= startSequence &&
            message.sequence < nextAnchor &&
            (message.role === "user" || message.role === "assistant"),
        ),
      });
    }
  }

  return clusters;
}

function main(): void {
  const dbPath = realpathSync(resolve(readArg("--db")));
  const outputPath = resolve(readArg("--out"));
  const handle = readArg("--handle", "Iris904");
  const origin = readArg("--origin", "legacy_unknown");

  if (dbPath === outputPath) {
    throw new Error("Output path must not point to the source database.");
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");

  try {
    const reviews = db
      .prepare(
        `
          SELECT
            ra.id AS reviewAttemptId,
            ra.chatSessionId,
            ra.createdAt AS reviewCreatedAt,
            cs.primaryLanguage AS language,
            cs.title AS sessionTitle,
            p.title AS problemTitle,
            p.slug AS problemSlug,
            p.leetcodeNumber,
            dr.userIssueSummary,
            dr.coachSummary,
            dr.selfCheckQuestion,
            dr.selfCheckAnswer,
            dr.diagnosisJson
          FROM ReviewAttempt ra
          INNER JOIN User u ON u.id = ra.userId
          INNER JOIN Problem p ON p.id = ra.problemId
          INNER JOIN ChatSession cs ON cs.id = ra.chatSessionId
          INNER JOIN DiagnosisResult dr ON dr.reviewAttemptId = ra.id
          WHERE u.handle = ? AND ra.memoryOrigin = ?
          ORDER BY p.leetcodeNumber ASC, ra.createdAt DESC
        `,
      )
      .all(handle, origin) as ReviewRow[];

    const messages = db
      .prepare(
        `
          SELECT
            cm.id,
            cm.sessionId,
            cm.reviewAttemptId,
            cm.role,
            cm.contentMarkdown,
            cm.sequence,
            cm.createdAt
          FROM ChatMessage cm
          INNER JOIN ChatSession cs ON cs.id = cm.sessionId
          INNER JOIN User u ON u.id = cs.userId
          WHERE u.handle = ? AND cs.memoryOrigin = ?
          ORDER BY cm.sessionId ASC, cm.sequence ASC
        `,
      )
      .all(handle, origin) as MessageRow[];

    const clusters = buildClusters(reviews, messages).sort((a, b) => {
      const problemOrder =
        (a.leetcodeNumber ?? Number.MAX_SAFE_INTEGER) -
        (b.leetcodeNumber ?? Number.MAX_SAFE_INTEGER);
      return problemOrder !== 0
        ? problemOrder
        : parseTimestamp(b.reviewCreatedAt).getTime() -
            parseTimestamp(a.reviewCreatedAt).getTime();
    });

    const reviewedSessionIds = new Set(
      reviews.map((review) => review.chatSessionId),
    );
    const clusteredMessageIds = clusters.flatMap((cluster) =>
      cluster.messages.map((message) => message.id),
    );
    const expectedClusteredMessageIds = messages
      .filter((message) => reviewedSessionIds.has(message.sessionId))
      .map((message) => message.id);
    if (
      new Set(clusteredMessageIds).size !== clusteredMessageIds.length ||
      new Set(clusteredMessageIds).size !==
        new Set(expectedClusteredMessageIds).size
    ) {
      throw new Error(
        "Conversation attribution is incomplete or contains duplicate messages.",
      );
    }

    const chatOnlyMessages = messages.filter(
      (message) => !reviewedSessionIds.has(message.sessionId),
    );
    const chatOnlySessionCount = new Set(
      chatOnlyMessages.map((message) => message.sessionId),
    ).size;

    const byProblem = new Map<string, ActivityCluster[]>();
    for (const cluster of clusters) {
      const key = cluster.problemSlug;
      const list = byProblem.get(key) ?? [];
      list.push(cluster);
      byProblem.set(key, list);
    }

    const lines: string[] = [
      `# ${handle} 历史学习活动来源审批`,
      "",
      "> 这是一份人工审批材料，不是系统自动判断。它不会修改数据库。",
      "",
      `待审批范围：来源暂记为 \`${origin}\` 的 ${clusters.length} 次 Review，涉及 ${byProblem.size} 道题。`,
      "",
      `本轮按你的要求以 ReviewAttempt 为 cluster 根节点。因此，另有 ${chatOnlySessionCount} 个没有 ReviewAttempt 的纯聊天会话（${chatOnlyMessages.length} 条消息）暂未列入；数据没有删除，后续可单独审批。`,
      "",
      "每个活动以一次 **ReviewAttempt** 为起点，只展示：",
      "",
      "- DiagnosisResult 中可读的诊断摘要与自测问答；",
      "- 这次 Review 的 Coach 回复；",
      "- 同一 ChatSession 中与这次 Review 相邻的真实对话。",
      "",
      "代码快照、运行轨迹、内部标签、哈希和其他机器填充字段都未列出。一个会话在首次 Review 前的开场对话归入首次 Review；每次 Review 后的追问归入该次 Review，直到下一次 Review。每条消息只出现一次。时间均按芝加哥本地时间显示。",
      "",
      "## 怎么审批",
      "",
      "每个活动只勾选一项：",
      "",
      "- **Learner**：确实是你通过 WebUI 进行的真实学习活动。",
      "- **Development**：开发、联调或手工调试产生。",
      "- **Evaluation/Test**：自动化评测、测试脚本或批量验证产生。",
      "- **Unsure**：现在无法确认，继续隔离。",
      "",
      "可先扫诊断摘要；只有拿不准时，再展开完整对话。保存勾选后的文件即可，暂时不要改动隐藏注释。",
      "",
      "## 总览",
      "",
      "| 题目 | 待审批活动 | 日期范围 |",
      "| --- | ---: | --- |",
    ];

    for (const problemClusters of byProblem.values()) {
      const first = problemClusters[0];
      const dates = problemClusters
        .map((cluster) => parseTimestamp(cluster.reviewCreatedAt).getTime())
        .sort((a, b) => a - b);
      const start = formatDate(new Date(dates[0]).toISOString());
      const end = formatDate(new Date(dates.at(-1) ?? dates[0]).toISOString());
      const label = first.leetcodeNumber
        ? `LC ${first.leetcodeNumber} · ${first.problemTitle}`
        : first.problemTitle;
      lines.push(
        `| ${escapeTable(label)} | ${problemClusters.length} | ${start === end ? start : `${start} ～ ${end}`} |`,
      );
    }

    lines.push("", "## 逐项审批", "");

    for (const problemClusters of byProblem.values()) {
      const first = problemClusters[0];
      const problemLabel = first.leetcodeNumber
        ? `LC ${first.leetcodeNumber} · ${first.problemTitle}`
        : first.problemTitle;
      lines.push(`## ${problemLabel}`, "");

      for (const [index, cluster] of problemClusters.entries()) {
        lines.push(
          `### 活动 ${index + 1}/${problemClusters.length} · ${formatDateTime(cluster.reviewCreatedAt)}`,
          "",
          `<!-- patterncoach-provenance-review reviewAttemptId="${cluster.reviewAttemptId}" chatSessionId="${cluster.chatSessionId}" currentOrigin="${origin}" -->`,
          "",
          "- [ ] Learner",
          "- [ ] Development",
          "- [ ] Evaluation/Test",
          "- [ ] Unsure",
          "",
          "备注：",
          "",
          `**会话**：${normalizeText(cluster.sessionTitle) || cluster.problemTitle} · ${cluster.language} · 关联消息 ${cluster.messages.length} 条`,
          "",
          `**运行结论**：${parseRunStatus(cluster.diagnosisJson)}`,
          "",
          "**当时的问题摘要**",
          "",
          quoteBlock(cluster.userIssueSummary, "没有可读的问题摘要。"),
          "",
          "**Coach 诊断摘要**",
          "",
          quoteBlock(cluster.coachSummary, "没有可读的诊断摘要。"),
          "",
        );

        if (normalizeText(cluster.selfCheckQuestion)) {
          lines.push(
            "**当时的自测问答**",
            "",
            `- 问：${normalizeText(cluster.selfCheckQuestion)}`,
            `- 答：${normalizeText(cluster.selfCheckAnswer) || "（没有作答）"}`,
            "",
          );
        }

        lines.push(
          `<details><summary>查看这次 Review 与后续对话（${cluster.messages.length} 条）</summary>`,
          "",
          renderConversation(cluster),
          "</details>",
          "",
          "---",
          "",
        );
      }
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
    process.stdout.write(
      `${JSON.stringify({ dbPath, outputPath, handle, origin, clusters: clusters.length, problems: byProblem.size, messages: clusteredMessageIds.length, chatOnlySessionsExcluded: chatOnlySessionCount, chatOnlyMessagesExcluded: chatOnlyMessages.length }, null, 2)}\n`,
    );
  } finally {
    db.close();
  }
}

main();
