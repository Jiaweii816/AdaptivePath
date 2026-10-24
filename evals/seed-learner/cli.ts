import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/lib/env";
import { runSeedLearner } from "./runner";

type ParsedArgs = {
  scenarioPath?: string;
  dbInput?: string;
  outPath?: string;
};

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "evaluation";
  const args = parseArgs(argv);

  if (!args.scenarioPath) {
    throw new Error("Missing required --scenario <scenario-json>.");
  }
  if (!args.dbInput) {
    throw new Error("Missing required --db <sqlite-db-path>.");
  }
  if (!args.outPath) {
    throw new Error("Missing required --out <manifest-json>.");
  }

  const result = await runSeedLearner({
    scenarioPath: args.scenarioPath,
    dbInput: args.dbInput,
    outPath: args.outPath,
  });

  console.log("Seed learner passed.");
  console.log(`Eval DB: ${result.dbPath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Learner: ${result.learnerId}`);
  console.log(`User ID: ${result.userId}`);
  console.log(`Facts: ${result.factsCount}`);
  console.log(`Episodes: ${result.episodesCount}`);
  console.log(`Stale/superseded facts: ${result.staleOrSupersededFactsCount}`);
  console.log(`Preference facts: ${result.preferenceFactsCount}`);
  console.log(`Fact arbitration used: ${result.arbitrationUsed ? "yes" : "no"}`);
  console.log(`Real LLM calls: ${result.realLlmCalls ? "yes" : "no"}`);
  if (result.fixtureOnlyWrites.length > 0) {
    console.log(`Fixture-only writes: ${result.fixtureOnlyWrites.length}`);
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--scenario") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --scenario <scenario-json>.");
      }
      parsed.scenarioPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--scenario=")) {
      parsed.scenarioPath = arg.slice("--scenario=".length);
      continue;
    }

    if (arg === "--db") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --db <sqlite-db-path>.");
      }
      parsed.dbInput = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--db=")) {
      parsed.dbInput = arg.slice("--db=".length);
      continue;
    }

    if (arg === "--out") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --out <manifest-json>.");
      }
      parsed.outPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--out=")) {
      parsed.outPath = arg.slice("--out=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
