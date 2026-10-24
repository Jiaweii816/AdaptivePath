import type { CodeRunStatus } from "@/types/code-runner";

export type PracticeRunStatusClass =
  | "passed"
  | "tests_failed"
  | "compile_error"
  | "runtime_error"
  | "timeout";

export type PracticeRunMilestoneReason =
  | "first_run"
  | "status_class_changed"
  | "fail_to_pass"
  | "failure_signature_changed";

export type PracticeRunMilestoneRun = {
  id?: string;
  runOrdinal: number;
  status: CodeRunStatus | string;
  executionFingerprint: string | null;
  selectedTestCaseIds: string | readonly string[];
  rawResultJson: string;
};

export type PracticeRunMilestoneState = {
  executionFingerprint: string | null;
  statusClass: PracticeRunStatusClass;
  failureSignature?: string;
};

export type PracticeRunTransition = {
  reason: PracticeRunMilestoneReason;
  before?: PracticeRunMilestoneState;
  after: PracticeRunMilestoneState;
  eligibleForL2: false;
};

export function normalizeStatusClass(
  status: CodeRunStatus | string,
): PracticeRunStatusClass | undefined {
  switch (status) {
    case "passed_visible_tests":
      return "passed";
    case "failed":
      return "tests_failed";
    case "compile_error":
    case "syntax_error":
      return "compile_error";
    case "runtime_error":
      return "runtime_error";
    case "timeout":
      return "timeout";
    default:
      return undefined;
  }
}

export function buildFailureSignature(
  run: Pick<PracticeRunMilestoneRun, "status" | "rawResultJson">,
): string | undefined {
  const statusClass = normalizeStatusClass(run.status);
  if (!statusClass || statusClass === "passed") {
    return undefined;
  }

  const firstFailedTest = readTestResults(run.rawResultJson).find(
    (testResult) => !isPassedTestResult(testResult),
  );
  const firstFailedTestCaseId = readString(firstFailedTest?.id) ?? "none";
  const firstFailedTestStatus =
    readString(firstFailedTest?.status) ??
    (firstFailedTest?.passed === false ? "failed" : "none");

  return `${statusClass}:${firstFailedTestCaseId}:${firstFailedTestStatus}`;
}

export function classifyRunTransition(
  previous:
    | PracticeRunMilestoneRun
    | readonly PracticeRunMilestoneRun[]
    | null
    | undefined,
  current: PracticeRunMilestoneRun,
): PracticeRunTransition | undefined {
  const after = buildMilestoneState(current);
  if (!after) {
    return undefined;
  }

  const previousCandidates = Array.isArray(previous)
    ? previous
    : previous
      ? [previous]
      : [];
  const baseline = previousCandidates.find(
    (candidate) => normalizeStatusClass(candidate.status) !== undefined,
  );
  const before = baseline ? buildMilestoneState(baseline) : undefined;

  if (!baseline || !before) {
    return {
      reason: "first_run",
      after,
      eligibleForL2: false,
    };
  }

  if (isExactRepeat(baseline, current, before, after)) {
    return undefined;
  }

  if (before.statusClass !== after.statusClass) {
    const reason =
      before.statusClass !== "passed" &&
      after.statusClass === "passed" &&
      before.executionFingerprint !== after.executionFingerprint
        ? "fail_to_pass"
        : "status_class_changed";

    return {
      reason,
      before,
      after,
      eligibleForL2: false,
    };
  }

  if (
    after.statusClass !== "passed" &&
    before.failureSignature !== after.failureSignature &&
    before.executionFingerprint !== after.executionFingerprint
  ) {
    return {
      reason: "failure_signature_changed",
      before,
      after,
      eligibleForL2: false,
    };
  }

  return undefined;
}

export function foldRunSequence(runs: readonly PracticeRunMilestoneRun[]) {
  const normalizedRuns = runs.flatMap((run) => {
    const state = buildMilestoneState(run);
    return state ? [{ run, state }] : [];
  });
  const first = normalizedRuns.at(0);
  const last = normalizedRuns.at(-1);
  const failureSignatureCount = new Set(
    normalizedRuns.flatMap(({ state }) =>
      state.failureSignature ? [state.failureSignature] : [],
    ),
  ).size;

  return {
    runCount: runs.length,
    practiceRunLogIds: runs
      .flatMap((run) => (run.id ? [run.id] : []))
      .slice(-20),
    ...(first ? { before: first.state } : {}),
    ...(last ? { after: last.state } : {}),
    failureSignatureCount,
    eligibleForL2: false as const,
  };
}

function buildMilestoneState(
  run: PracticeRunMilestoneRun,
): PracticeRunMilestoneState | undefined {
  const statusClass = normalizeStatusClass(run.status);
  if (!statusClass) {
    return undefined;
  }
  const failureSignature = buildFailureSignature(run);

  return {
    executionFingerprint: run.executionFingerprint,
    statusClass,
    ...(failureSignature ? { failureSignature } : {}),
  };
}

function isExactRepeat(
  previous: PracticeRunMilestoneRun,
  current: PracticeRunMilestoneRun,
  before: PracticeRunMilestoneState,
  after: PracticeRunMilestoneState,
) {
  return (
    before.executionFingerprint === after.executionFingerprint &&
    serializeSelectedTestCaseIds(previous.selectedTestCaseIds) ===
      serializeSelectedTestCaseIds(current.selectedTestCaseIds) &&
    before.statusClass === after.statusClass &&
    before.failureSignature === after.failureSignature
  );
}

function serializeSelectedTestCaseIds(value: string | readonly string[]) {
  if (typeof value !== "string") {
    return JSON.stringify(value);
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? JSON.stringify(parsed) : value;
  } catch {
    return value;
  }
}

function readTestResults(rawResultJson: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(rawResultJson) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.testResults)) {
      return [];
    }
    return parsed.testResults.filter(isRecord);
  } catch {
    return [];
  }
}

function isPassedTestResult(testResult: Record<string, unknown>) {
  return testResult.status === "passed" ||
    (testResult.status === undefined && testResult.passed === true);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
