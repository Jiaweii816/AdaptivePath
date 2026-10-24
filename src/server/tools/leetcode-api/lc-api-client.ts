import { loadLocalEnv } from "@/lib/env";

export type LeetCodeSite = "global" | "cn";

export type LcProblemCodeSnippet = {
  lang: string;
  langSlug: string;
  code: string;
};

export type LcProblem = {
  questionId: string;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  content: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topicTags: Array<{ name: string; slug: string }>;
  codeSnippets: LcProblemCodeSnippet[];
  exampleTestcases: string;
  metaData: string;
};

export type LcSubmitSolutionResult = {
  providerUsed: "lc_submit";
  submissionId: string;
  titleSlug: string;
  problem: LcProblem;
  start: unknown;
  check: LcSubmissionCheckResult;
};

export type LcRunCodeResult = {
  providerUsed: "lc_run";
  interpretId: string;
  titleSlug: string;
  problem: LcProblem;
  dataInput: string;
  start: unknown;
  check: LcSubmissionCheckResult;
};

export type LcRecentSubmission = {
  id?: string;
  title: string;
  titleSlug: string;
  timestamp: string;
  statusDisplay: string;
  lang: string;
};

export type LcSubmissionCheckResult = Record<string, unknown>;

type FetchLike = typeof fetch;

export type LeetCodeApiClientOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  loadEnv?: boolean;
};

export class LcAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LcAuthError";
  }
}

export class LcExternalServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LcExternalServiceError";
  }
}

export function hasLeetCodeSession(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.LEETCODE_SESSION?.trim());
}

export function getLeetCodeOrigin(site: string | undefined) {
  return normalizeSite(site) === "cn"
    ? "https://leetcode.cn"
    : "https://leetcode.com";
}

export class LeetCodeApiClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: LeetCodeApiClientOptions = {}) {
    if (options.loadEnv !== false) {
      loadLocalEnv();
    }

    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 1200;
    this.maxPollAttempts = options.maxPollAttempts ?? 30;
  }

  async getProblem(titleSlug: string): Promise<LcProblem> {
    const response = await this.requestGraphql<{
      question: LcProblem | null;
    }>({
      query: problemDetailQuery,
      variables: { titleSlug },
    });

    if (!response.question) {
      throw new Error(`LeetCode problem not found: ${titleSlug}`);
    }

    return normalizeProblem(response.question);
  }

  async submitSolution(args: {
    titleSlug: string;
    lang: string;
    typedCode: string;
  }): Promise<LcSubmitSolutionResult> {
    const problem = await this.getProblem(args.titleSlug);
    const start = await this.requestJson<Record<string, unknown>>(
      `/problems/${args.titleSlug}/submit/`,
      {
        method: "POST",
        body: JSON.stringify({
          lang: args.lang,
          question_id: problem.questionId,
          typed_code: args.typedCode,
        }),
      },
    );
    const submissionId = readId(start, ["submission_id", "submissionId"]);

    if (!submissionId) {
      throw new Error("LeetCode submit did not return a submission id.");
    }

    return {
      providerUsed: "lc_submit",
      submissionId,
      titleSlug: args.titleSlug,
      problem,
      start,
      check: await this.pollSubmission(submissionId),
    };
  }

  async runCode(args: {
    titleSlug: string;
    lang: string;
    typedCode: string;
    dataInput: string;
  }): Promise<LcRunCodeResult> {
    const problem = await this.getProblem(args.titleSlug);
    const start = await this.requestJson<Record<string, unknown>>(
      `/problems/${args.titleSlug}/interpret_solution/`,
      {
        method: "POST",
        body: JSON.stringify({
          data_input: args.dataInput,
          lang: args.lang,
          question_id: problem.questionId,
          typed_code: args.typedCode,
        }),
      },
    );
    const interpretId = readId(start, [
      "interpret_id",
      "interpretId",
      "submission_id",
      "submissionId",
    ]);

    if (!interpretId) {
      throw new Error("LeetCode run_code did not return an interpret id.");
    }

    return {
      providerUsed: "lc_run",
      interpretId,
      titleSlug: args.titleSlug,
      problem,
      dataInput: args.dataInput,
      start,
      check: await this.pollSubmission(interpretId),
    };
  }

  async getRecentSubmissions(
    username: string,
    limit = 100,
  ): Promise<LcRecentSubmission[]> {
    const response = await this.requestGraphql<{
      recentSubmissionList: LcRecentSubmission[];
    }>({
      query: recentSubmissionsQuery,
      variables: { username, limit },
    });

    return response.recentSubmissionList;
  }

  private async requestGraphql<TData>(args: {
    query: string;
    variables: Record<string, unknown>;
  }) {
    const response = await this.requestJson<{
      data?: TData;
      errors?: Array<{ message?: string }>;
    }>("/graphql", {
      method: "POST",
      body: JSON.stringify(args),
    });

    if (response.errors?.length) {
      throw new Error(
        response.errors.map((error) => error.message).filter(Boolean).join("; "),
      );
    }

    if (!response.data) {
      throw new Error("LeetCode GraphQL response did not include data.");
    }

    return response.data;
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const auth = this.readAuth();
    const origin = getLeetCodeOrigin(this.env.LEETCODE_SITE);
    const response = await this.fetchImpl(`${origin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: auth.cookie,
        origin,
        referer: `${origin}/`,
        "user-agent": "PatternCoach AI local workbench",
        ...(auth.csrfToken ? { "x-csrftoken": auth.csrfToken } : {}),
        ...init.headers,
      },
    });

    if (response.status === 429) {
      throw new LcExternalServiceError(externalJudgeBusyMessage(), 429);
    }

    if (response.status === 401 || response.status === 403) {
      const body = await response.text();

      if (isExternalBlockResponse(response, body)) {
        throw new LcExternalServiceError(
          externalJudgeUnavailableMessage(),
          response.status,
        );
      }

      throw new LcAuthError(
        "Remote judge sign-in is no longer valid. Reconnect the judge integration or switch to local visible tests.",
      );
    }

    if (!response.ok) {
      throw new Error(
        `LeetCode request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }

    return (await response.json()) as T;
  }

  private async pollSubmission(
    submissionId: string,
  ): Promise<LcSubmissionCheckResult> {
    const auth = this.readAuth();
    const origin = getLeetCodeOrigin(this.env.LEETCODE_SITE);

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const response = await this.fetchImpl(
        `${origin}/submissions/detail/${submissionId}/check/`,
        {
          headers: {
            accept: "application/json",
            cookie: auth.cookie,
            referer: `${origin}/submissions/detail/${submissionId}/`,
            "user-agent": "PatternCoach AI local workbench",
            ...(auth.csrfToken ? { "x-csrftoken": auth.csrfToken } : {}),
          },
        },
      );

      if (response.status === 429) {
        await sleep(this.pollIntervalMs * 2);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.text();

        if (isExternalBlockResponse(response, body)) {
          throw new LcExternalServiceError(
            externalJudgeUnavailableMessage(),
            response.status,
          );
        }

        throw new LcAuthError(
          "Remote judge sign-in is no longer valid. Reconnect the judge integration or switch to local visible tests.",
        );
      }

      if (!response.ok) {
        throw new Error(
          `LeetCode polling failed with HTTP ${response.status}: ${await response.text()}`,
        );
      }

      const check = (await response.json()) as LcSubmissionCheckResult;
      const state = String(check.state ?? "").toUpperCase();

      if (state !== "PENDING" && state !== "STARTED") {
        return check;
      }

      await sleep(this.pollIntervalMs);
    }

    throw new Error(`LeetCode polling timed out for ${submissionId}.`);
  }

  private readAuth() {
    const session = this.env.LEETCODE_SESSION?.trim();
    const csrfToken = this.env.LEETCODE_CSRF_TOKEN?.trim();

    if (!session) {
      throw new LcAuthError(
        "Remote judge sign-in is not configured. Reconnect the judge integration or use the local demo runner.",
      );
    }

    return {
      csrfToken,
      cookie: [
        `LEETCODE_SESSION=${session}`,
        csrfToken ? `csrftoken=${csrfToken}` : undefined,
      ]
        .filter(Boolean)
        .join("; "),
    };
  }
}

function normalizeProblem(problem: LcProblem): LcProblem {
  const difficulty =
    problem.difficulty === "Easy" ||
    problem.difficulty === "Medium" ||
    problem.difficulty === "Hard"
      ? problem.difficulty
      : titleCase(problem.difficulty);

  return {
    ...problem,
    difficulty,
    topicTags: problem.topicTags ?? [],
    codeSnippets: problem.codeSnippets ?? [],
    content: problem.content ?? "",
    exampleTestcases: problem.exampleTestcases ?? "",
    metaData: problem.metaData ?? "{}",
  };
}

function normalizeSite(site: string | undefined): LeetCodeSite {
  return site?.trim().toLowerCase() === "cn" ? "cn" : "global";
}

function titleCase(value: string): "Easy" | "Medium" | "Hard" {
  const normalized = value.toLowerCase();

  if (normalized === "hard") {
    return "Hard";
  }

  if (normalized === "medium") {
    return "Medium";
  }

  return "Easy";
}

function readId(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const id = value[key];

    if (typeof id === "string" && id.trim()) {
      return id;
    }

    if (typeof id === "number" && Number.isFinite(id)) {
      return String(id);
    }
  }

  return undefined;
}

function isExternalBlockResponse(response: Response, body: string) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const normalizedBody = body.toLowerCase();

  return (
    contentType.includes("text/html") ||
    normalizedBody.includes("just a moment") ||
    normalizedBody.includes("cf-chl") ||
    normalizedBody.includes("cloudflare")
  );
}

function externalJudgeUnavailableMessage() {
  return "External judge service is temporarily unavailable. Your code was not reviewed with remote tests; try again later or switch to local visible tests.";
}

function externalJudgeBusyMessage() {
  return "External judge service is busy. Wait a bit before trying remote execution again, or switch to local visible tests.";
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const problemDetailQuery = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    topicTags {
      name
      slug
    }
    codeSnippets {
      lang
      langSlug
      code
    }
    exampleTestcases
    metaData
  }
}
`;

const recentSubmissionsQuery = `
query recentSubmissionList($username: String!, $limit: Int!) {
  recentSubmissionList(username: $username, limit: $limit) {
    id
    title
    titleSlug
    timestamp
    statusDisplay
    lang
  }
}
`;
