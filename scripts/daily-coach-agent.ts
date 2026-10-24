import cron from "node-cron";
import { loadLocalEnv } from "@/lib/env";

loadLocalEnv();

type Environment = Readonly<Record<string, string | undefined>>;

type DailyCoachCliConfig = {
  handle: string;
  databaseUrl: string;
  to: string;
  from: string;
  timezone: string;
  cronExpression: string;
};

async function runOnce(config: DailyCoachCliConfig): Promise<void> {
  const { runDailyCoach } = await import(
    "@/server/jobs/proactive/run-daily-coach"
  );
  const result = await runDailyCoach({
    handle: config.handle,
    databaseUrl: config.databaseUrl,
    to: config.to,
    from: config.from,
    timezone: config.timezone,
  });
  const detail = "detail" in result ? result.detail : result.messageId;
  const outcome = result.transport === "file" ? "preview written" : "sent";
  console.log(`[daily-coach] ${outcome} via ${result.transport}: ${detail}`);
}

async function main(): Promise<void> {
  const config = readConfig(process.env);
  if (!process.argv.includes("--cron")) {
    await runOnce(config);
    return;
  }

  validateCronConfig(config);
  let running = false;
  let activeRun: Promise<void> | undefined;
  const task = cron.schedule(
    config.cronExpression,
    async () => {
      if (running) {
        console.warn("[daily-coach] skipped overlapping scheduled run");
        return;
      }
      running = true;
      activeRun = runOnce(config);
      try {
        await activeRun;
      } catch (error) {
        console.error(`[daily-coach] scheduled run failed: ${formatError(error)}`);
      } finally {
        activeRun = undefined;
        running = false;
      }
    },
    {
      name: "patterncoach-daily-coach",
      timezone: config.timezone,
      noOverlap: true,
    },
  );

  console.log(
    `[daily-coach] cron armed: ${config.cronExpression} (${config.timezone})`,
  );
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async () => {
    await task.stop();
    await activeRun?.catch(() => undefined);
    await task.destroy();
    console.log("[daily-coach] cron stopped");
  };
  const beginShutdown = () => {
    shutdownPromise ??= shutdown().catch((error: unknown) => {
      console.error(`[daily-coach] shutdown failed: ${formatError(error)}`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", beginShutdown);
  process.once("SIGTERM", beginShutdown);
}

function readConfig(env: Environment): DailyCoachCliConfig {
  return {
    handle: requireEnv(env, "DAILY_COACH_USER"),
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    to: requireEnv(env, "DAILY_COACH_TO"),
    from: requireEnv(env, "DAILY_COACH_FROM"),
    cronExpression: env.DAILY_COACH_CRON?.trim() || "0 9 * * *",
    timezone:
      env.DAILY_COACH_TIMEZONE?.trim() ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function validateCronConfig(config: DailyCoachCliConfig): void {
  if (!cron.validate(config.cronExpression)) {
    throw new Error(
      `Invalid DAILY_COACH_CRON expression: ${config.cronExpression}`,
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
    }).format(new Date());
  } catch {
    throw new Error(`Invalid DAILY_COACH_TIMEZONE: ${config.timezone}`);
  }
}

function requireEnv(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(`[daily-coach] ${formatError(error)}`);
  process.exitCode = 1;
});
