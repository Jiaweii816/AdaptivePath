import type { KnowledgeNote, PrismaClient } from "@prisma/client";
import type { CodeRunnerLanguage } from "@/types/code-runner";
import type { FtsStore } from "./fts-store";
import {
  indexKnowledgeNote,
  parseKnowledgeNoteFtsRefId,
  touchKnowledgeNoteLookup,
} from "./knowledge-note-store";

export type KnowledgeBookLookupStatus =
  | "covered"
  | "partial"
  | "related"
  | "none";

export type KnowledgeBookMatchedNote = {
  noteId: string;
  conceptKey: string;
  title: string;
  snippet: string;
  whenToUse: string;
  category: string;
  previousLookupCount: number;
  lookupCount: number;
  touched: boolean;
  coveredAspects: string[];
  missingAspects: string[];
  coverageReason: string;
};

export type KnowledgeBookLookup = {
  status: KnowledgeBookLookupStatus;
  canonicalTopic?: string;
  queryAspects: string[];
  matchedNotes: KnowledgeBookMatchedNote[];
};

type KnowledgeBookResolverPrisma = Pick<
  PrismaClient,
  "knowledgeNote" | "l1MemoryEvent"
>;

type TopicSpec = {
  canonicalTopic: string;
  language?: CodeRunnerLanguage;
  categories: string[];
  topicAliases: string[];
  basicAspects: string[];
  broadAspects: string[];
  aspects: Record<string, string[]>;
};

type ResolvedKnowledgeQueryProfile = {
  spec: TopicSpec;
  requiredAspects: string[];
  searchText: string;
};

const TOPIC_SPECS: TopicSpec[] = [
  {
    canonicalTopic: "python_deque",
    language: "Python",
    categories: ["python_api", "stdlib"],
    topicAliases: [
      "python deque",
      "collections.deque",
      "deque",
      "queue",
      "队列",
      "双端队列",
      "左弹出",
      "右弹出",
      "左入队",
      "右入队",
      "pop front",
      "push front",
      "push back",
    ],
    basicAspects: ["append", "popleft"],
    broadAspects: [
      "append",
      "appendleft",
      "pop",
      "popleft",
      "extend",
      "extendleft",
      "rotate",
      "maxlen",
    ],
    aspects: {
      append: ["append(", ".append(", "push_back", "push back", "右入", "入队"],
      appendleft: [
        "appendleft",
        ".appendleft(",
        "push_front",
        "push front",
        "左入",
        "左边入",
      ],
      pop: ["pop()", ".pop(", "pop_back", "pop back", "右弹出", "右出"],
      popleft: [
        "popleft",
        ".popleft(",
        "pop_front",
        "pop front",
        "左弹出",
        "左边弹出",
        "弹出左",
        "弹出左边",
        "左侧弹出",
        "出队",
      ],
      extend: ["extend(", ".extend(", "批量右", "批量入队"],
      extendleft: ["extendleft", ".extendleft(", "批量左"],
      rotate: ["rotate", ".rotate(", "旋转"],
      maxlen: ["maxlen", "固定长度", "最大长度"],
    },
  },
  {
    canonicalTopic: "python_heapq",
    language: "Python",
    categories: ["python_api", "stdlib"],
    topicAliases: ["python heapq", "heapq", "heap", "堆", "优先队列"],
    basicAspects: ["heappush", "heappop"],
    broadAspects: ["heappush", "heappop", "heapify", "nlargest", "nsmallest"],
    aspects: {
      heappush: ["heappush", "push", "入堆"],
      heappop: ["heappop", "pop", "弹出最小"],
      heapify: ["heapify", "建堆"],
      nlargest: ["nlargest", "最大"],
      nsmallest: ["nsmallest", "最小"],
    },
  },
  {
    canonicalTopic: "cpp_priority_queue",
    language: "C++",
    categories: ["cpp_stl", "stdlib"],
    topicAliases: ["priority_queue", "std::priority_queue", "优先队列", "heap"],
    basicAspects: ["push", "top", "pop"],
    broadAspects: ["push", "top", "pop", "min_heap", "comparator"],
    aspects: {
      push: ["push", ".push("],
      top: ["top", ".top("],
      pop: ["pop", ".pop("],
      min_heap: ["greater", "min heap", "小根堆", "最小堆"],
      comparator: ["comparator", "compare", "自定义比较"],
    },
  },
  {
    canonicalTopic: "cpp_deque",
    language: "C++",
    categories: ["cpp_stl", "stdlib"],
    topicAliases: ["std::deque", "deque", "队列", "双端队列"],
    basicAspects: ["push_back", "pop_front"],
    broadAspects: ["push_back", "push_front", "pop_back", "pop_front"],
    aspects: {
      push_back: ["push_back", "右入", "入队"],
      push_front: ["push_front", "左入"],
      pop_back: ["pop_back", "右弹出"],
      pop_front: ["pop_front", "左弹出", "出队"],
    },
  },
];

const BROAD_QUERY_PATTERNS = [
  /所有/,
  /全部/,
  /完整/,
  /全套/,
  /\ball\b/i,
  /\bfull\b/i,
  /\bevery\b/i,
  /\bcomplete\b/i,
];

export async function resolveKnowledgeBookQuery(
  prisma: KnowledgeBookResolverPrisma,
  args: {
    userId: string;
    queryText: string;
    language?: CodeRunnerLanguage;
    chatSessionId?: string;
    problemId?: string;
    userMessageId?: string;
    ftsStore?: FtsStore;
    now?: Date;
  },
): Promise<KnowledgeBookLookup> {
  const queryProfile = resolveKnowledgeQueryProfile(args.queryText, args.language);
  if (!queryProfile.spec) {
    return {
      status: "none",
      queryAspects: queryProfile.requiredAspects,
      matchedNotes: [],
    };
  }
  const resolvedProfile: ResolvedKnowledgeQueryProfile = {
    spec: queryProfile.spec,
    requiredAspects: queryProfile.requiredAspects,
    searchText: queryProfile.searchText,
  };

  const activeNotes = await prisma.knowledgeNote.findMany({
    where: { userId: args.userId, status: "active" },
    orderBy: [{ lookupCount: "desc" }, { lastNeededAt: "desc" }],
  });
  for (const note of activeNotes) {
    indexKnowledgeNote(args.ftsStore, note);
  }

  const ftsIds = searchKnowledgeNoteIds(args.ftsStore, resolvedProfile.searchText);
  const ranked = activeNotes
    .map((note) => scoreNote(note, resolvedProfile, ftsIds))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    return {
      status: "none",
      canonicalTopic: resolvedProfile.spec.canonicalTopic,
      queryAspects: resolvedProfile.requiredAspects,
      matchedNotes: [],
    };
  }

  const status = classifyCoverage(best, resolvedProfile);
  if (status === "none") {
    return {
      status: "none",
      canonicalTopic: resolvedProfile.spec.canonicalTopic,
      queryAspects: resolvedProfile.requiredAspects,
      matchedNotes: [],
    };
  }

  const shouldTouch = status === "covered" || status === "partial";
  const touched = shouldTouch
    ? await touchKnowledgeNoteLookup(prisma, {
        userId: args.userId,
        noteId: best.note.id,
        problemId: args.problemId,
        chatSessionId: args.chatSessionId,
        userMessageId: args.userMessageId,
        status,
        canonicalTopic: resolvedProfile.spec.canonicalTopic,
        coveredAspects: best.coveredAspects,
        missingAspects: best.missingAspects,
        now: args.now,
        ftsStore: args.ftsStore,
      })
    : undefined;

  const note = touched?.note ?? best.note;
  return {
    status,
    canonicalTopic: resolvedProfile.spec.canonicalTopic,
    queryAspects: resolvedProfile.requiredAspects,
    matchedNotes: [
      {
        noteId: note.id,
        conceptKey: note.conceptKey,
        title: note.title,
        snippet: note.snippet,
        whenToUse: note.whenToUse,
        category: note.category,
        previousLookupCount: touched?.previousLookupCount ?? note.lookupCount,
        lookupCount: touched?.lookupCount ?? note.lookupCount,
        touched: touched?.touched ?? false,
        coveredAspects: best.coveredAspects,
        missingAspects: best.missingAspects,
        coverageReason: coverageReason(status, best, resolvedProfile),
      },
    ],
  };
}

export function resolveKnowledgeQueryProfile(
  queryText: string,
  language?: CodeRunnerLanguage,
) {
  const query = normalizeText(queryText);
  const inferredLanguage = language ?? inferLanguage(query);
  const spec = TOPIC_SPECS.find((candidate) => {
    if (inferredLanguage && candidate.language && candidate.language !== inferredLanguage) {
      return false;
    }
    return candidate.topicAliases.some((alias) => query.includes(normalizeText(alias)));
  });

  if (!spec) {
    return {
      spec: undefined as TopicSpec | undefined,
      requiredAspects: [] as string[],
      searchText: queryText,
    };
  }

  const explicitAspects = detectAspects(queryText, spec);
  const requiredAspects = isBroadQuery(queryText)
    ? spec.broadAspects
    : explicitAspects.length > 0
      ? explicitAspects
      : spec.basicAspects;

  return {
    spec,
    requiredAspects,
    searchText: [
      queryText,
      spec.canonicalTopic,
      ...spec.topicAliases,
      ...requiredAspects,
    ].join(" "),
  };
}

function scoreNote(
  note: KnowledgeNote,
  queryProfile: ResolvedKnowledgeQueryProfile,
  ftsIds: Set<string>,
) {
  const noteTopic = inferNoteTopic(note);
  const spec = queryProfile.spec;
  const noteAspects = detectAspects(noteText(note), spec);
  const coveredAspects = queryProfile.requiredAspects.filter((aspect) =>
    noteAspects.includes(aspect),
  );
  const missingAspects = queryProfile.requiredAspects.filter(
    (aspect) => !coveredAspects.includes(aspect),
  );
  const topicScore = noteTopic === spec.canonicalTopic ? 5 : 0;
  const ftsScore = ftsIds.has(note.id) ? 2 : 0;
  const aspectScore = coveredAspects.length * 2;
  const aliasScore = spec.topicAliases.some((alias) =>
    normalizeText(noteText(note)).includes(normalizeText(alias)),
  )
    ? 1
    : 0;

  return {
    note,
    noteAspects,
    coveredAspects,
    missingAspects,
    score: topicScore + ftsScore + aspectScore + aliasScore,
  };
}

function classifyCoverage(
  scored: ReturnType<typeof scoreNote>,
  queryProfile: ResolvedKnowledgeQueryProfile,
): KnowledgeBookLookupStatus {
  if (inferNoteTopic(scored.note) !== queryProfile.spec.canonicalTopic) {
    return "none";
  }

  if (queryProfile.requiredAspects.length === 0) {
    return scored.noteAspects.length > 0 ? "covered" : "related";
  }

  if (scored.missingAspects.length === 0) {
    return "covered";
  }

  return scored.coveredAspects.length > 0 || scored.noteAspects.length > 0
    ? "partial"
    : "related";
}

function coverageReason(
  status: KnowledgeBookLookupStatus,
  scored: ReturnType<typeof scoreNote>,
  queryProfile: ResolvedKnowledgeQueryProfile,
) {
  if (status === "covered") {
    return `matched ${queryProfile.spec.canonicalTopic} and covered ${scored.coveredAspects.join(", ")}`;
  }
  if (status === "partial") {
    return `matched ${queryProfile.spec.canonicalTopic}; missing ${scored.missingAspects.join(", ")}`;
  }
  return `matched ${queryProfile.spec.canonicalTopic} topic but no required aspect coverage`;
}

function searchKnowledgeNoteIds(ftsStore: FtsStore | undefined, queryText: string) {
  if (!ftsStore) {
    return new Set<string>();
  }

  return new Set(
    ftsStore
      .searchMemoryFts(queryText, { kind: "knowledge_note", limit: 8 })
      .map((hit) => parseKnowledgeNoteFtsRefId(hit.refId))
      .filter((id): id is string => Boolean(id)),
  );
}

function inferNoteTopic(note: KnowledgeNote) {
  const text = normalizeText(noteText(note));
  return TOPIC_SPECS.find((spec) => {
    if (!spec.categories.includes(note.category)) {
      return false;
    }
    if (spec.language === "Python" && note.category === "cpp_stl") {
      return false;
    }
    if (spec.language === "C++" && note.category === "python_api") {
      return false;
    }
    return (
      text.includes(normalizeText(spec.canonicalTopic)) ||
      spec.topicAliases.some((alias) => text.includes(normalizeText(alias)))
    );
  })?.canonicalTopic;
}

function detectAspects(text: string, spec: TopicSpec) {
  const normalized = normalizeText(text);
  const aspects = Object.entries(spec.aspects)
    .filter(([, aliases]) =>
      aliases.some((alias) => normalized.includes(normalizeText(alias))),
    )
    .map(([aspect]) => aspect);
  return [...new Set(aspects)];
}

function inferLanguage(query: string): CodeRunnerLanguage | undefined {
  if (/c\+\+|cpp|std::|stl|priority_queue|unordered_map/.test(query)) {
    return "C++";
  }
  if (/python|py|collections|heapq|deque|队列/.test(query)) {
    return "Python";
  }
  return undefined;
}

function isBroadQuery(text: string) {
  return BROAD_QUERY_PATTERNS.some((pattern) => pattern.test(text));
}

function noteText(note: Pick<
  KnowledgeNote,
  "conceptKey" | "title" | "snippet" | "whenToUse" | "category"
>) {
  return [
    note.conceptKey,
    note.title,
    note.category,
    note.whenToUse,
    note.snippet,
  ].join(" ");
}

function normalizeText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replaceAll("std::", "")
    .replace(/[\s._-]+/g, " ")
    .trim();
}
