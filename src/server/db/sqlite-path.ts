import { isAbsolute, resolve } from "node:path";
import { resolveMemoryOrigin } from "../memory/memory-origin";

export const DEFAULT_DATABASE_URL = "file:./dev.db";
export const LOCAL_DATABASE_PROFILE_ENV = "PATTERNCOACH_DATABASE_PROFILE";

export type LocalDatabaseProfileName = "iris" | "guest" | "try";

export type LocalDatabaseProfile = Readonly<{
  name: LocalDatabaseProfileName;
  databasePath: string;
  handle: string;
  memoryOrigin: "learner" | "development";
}>;

export type DatabaseIsolationEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * The local workbench deliberately has three separately owned databases:
 * Iris904's live learner ledger, a resettable guest interview/demo ledger,
 * and a disposable developer scratch ledger. Keep the mapping here so the
 * startup guard and all maintenance scripts enforce the same boundary.
 */
export function resolveLocalDatabaseProfile(
  name: LocalDatabaseProfileName,
  cwd = process.cwd(),
): LocalDatabaseProfile {
  const dataRoot = process.env.PATTERNCOACH_DATA_ROOT
    ? resolve(process.env.PATTERNCOACH_DATA_ROOT)
    : resolve(cwd, ".patterncoach-data");
  const profiles: Record<LocalDatabaseProfileName, LocalDatabaseProfile> = {
    iris: {
      name: "iris",
      databasePath: resolve(cwd, "dev.db"),
      handle: "Iris904",
      memoryOrigin: "learner",
    },
    guest: {
      name: "guest",
      databasePath: resolve(dataRoot, "demo/guest.db"),
      handle: "guest",
      memoryOrigin: "learner",
    },
    try: {
      name: "try",
      databasePath: resolve(dataRoot, "try/try.db"),
      handle: "try",
      memoryOrigin: "development",
    },
  };
  return profiles[name];
}

export function databaseUrlForLocalProfile(
  name: LocalDatabaseProfileName,
  cwd = process.cwd(),
) {
  return `file:${resolveLocalDatabaseProfile(name, cwd).databasePath}`;
}

/**
 * Automated processes must opt into an isolated SQLite file. This check runs
 * before Prisma, FTS, or sqlite-vec opens a connection so a test cannot mutate
 * the learner/development database and discover the mistake only afterwards.
 */
export function assertSafeDatabaseForProcess(args: {
  configuredDatabaseUrl?: string;
  env?: DatabaseIsolationEnvironment;
  cwd?: string;
}) {
  const env = args.env ?? process.env;
  const cwd = args.cwd ?? process.cwd();
  const origin = resolveMemoryOrigin(env);
  const automated =
    env.NODE_ENV === "test" ||
    origin === "test" ||
    origin === "evaluation" ||
    env.PATTERNCOACH_SMOKE_RUN === "1";

  if (automated) {
    const configured = args.configuredDatabaseUrl?.trim();
    if (!configured) {
      throw new Error(
        `Automated memory process (${origin}) requires an explicit isolated DATABASE_URL; refusing ${DEFAULT_DATABASE_URL}.`,
      );
    }

    const selectedPath = resolveSqliteFilePath(configured, cwd);
    const workspaceDevPath = resolve(cwd, "dev.db");
    if (selectedPath === workspaceDevPath) {
      throw new Error(
        `Automated memory process (${origin}) cannot use workspace dev.db: ${selectedPath}`,
      );
    }
  }

  assertLocalDatabaseProfileEnvironment({
    configuredDatabaseUrl: args.configuredDatabaseUrl,
    env,
    cwd,
  });
}

/**
 * Refuse a profile/database identity mix-up before Prisma, FTS, or sqlite-vec
 * opens a connection. An explicit profile must match exactly; known profile
 * paths are protected even when the profile variable was omitted.
 */
export function assertLocalDatabaseProfileEnvironment(args: {
  configuredDatabaseUrl?: string;
  env?: DatabaseIsolationEnvironment;
  cwd?: string;
}) {
  const env = args.env ?? process.env;
  const cwd = args.cwd ?? process.cwd();
  const configured = args.configuredDatabaseUrl?.trim() ?? DEFAULT_DATABASE_URL;
  const selectedPath = resolveSqliteFilePath(configured, cwd);
  const requestedProfile = env[LOCAL_DATABASE_PROFILE_ENV]?.trim();

  if (requestedProfile && !isLocalDatabaseProfileName(requestedProfile)) {
    throw new Error(
      `${LOCAL_DATABASE_PROFILE_ENV} must be iris, guest, or try; got ${requestedProfile}.`,
    );
  }

  const profiles = (['iris', 'guest', 'try'] as const).map((name) =>
    resolveLocalDatabaseProfile(name, cwd),
  );
  const pathProfile = profiles.find(
    (profile) => profile.databasePath === selectedPath,
  );
  const requestedProfileName = requestedProfile &&
    isLocalDatabaseProfileName(requestedProfile)
    ? requestedProfile
    : undefined;
  const expected = requestedProfileName
    ? resolveLocalDatabaseProfile(requestedProfileName, cwd)
    : pathProfile;

  if (!expected) return;

  if (requestedProfileName && selectedPath !== expected.databasePath) {
    throw new Error(
      `${LOCAL_DATABASE_PROFILE_ENV}=${expected.name} requires DATABASE_URL=file:${expected.databasePath}; got ${configured}.`,
    );
  }

  const origin = resolveMemoryOrigin(env);
  const handle = env.PATTERNCOACH_LOCAL_USER_HANDLE?.trim();
  if (origin !== expected.memoryOrigin || handle !== expected.handle) {
    throw new Error(
      `${expected.name} database requires PATTERNCOACH_MEMORY_ORIGIN=${expected.memoryOrigin} and PATTERNCOACH_LOCAL_USER_HANDLE=${expected.handle}.`,
    );
  }
}

function isLocalDatabaseProfileName(
  value: string,
): value is LocalDatabaseProfileName {
  return value === "iris" || value === "guest" || value === "try";
}

export function resolveSqliteFilePath(
  databaseUrl = DEFAULT_DATABASE_URL,
  cwd = process.cwd(),
) {
  if (!databaseUrl.startsWith("file:")) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(databaseUrl)) {
      throw new Error(`SQLite database URL must start with file:, got ${databaseUrl}`);
    }

    return isAbsolute(databaseUrl) ? databaseUrl : resolve(cwd, databaseUrl);
  }

  const withoutScheme = databaseUrl.slice("file:".length);
  const [rawPath] = withoutScheme.split("?");
  if (!rawPath) {
    throw new Error("SQLite database URL is missing a file path.");
  }

  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}
