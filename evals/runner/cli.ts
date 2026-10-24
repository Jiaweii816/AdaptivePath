import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/lib/env";
import { EvalRunnerError, runEvalCoach } from "./eval-coach-runner";

type ParsedArgs = {
  suiteName?: string;
  dbInput?: string;
  keepDb: boolean;
  repeats?: number;
  recordRunEvidence: boolean;
  manifestPath?: string;
  datasetPath?: string;
  citationDatasetPath?: string;
};

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv();
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "evaluation";
  const args = parseArgs(argv);

  if (!args.suiteName) {
    throw new Error("Missing required --suite <name>.");
  }

  const report = await runEvalCoach({
    suiteName: args.suiteName,
    dbInput: args.dbInput,
    keepDb: args.keepDb,
    repeats: args.repeats,
    recordRunEvidence: args.recordRunEvidence,
    manifestPath: args.manifestPath,
    datasetPath: args.datasetPath,
    citationDatasetPath: args.citationDatasetPath,
  });

  console.log(`Eval suite ${report.suiteName} passed.`);
  console.log(`Report markdown: ${report.reportPaths.markdown}`);
  console.log(`Report JSON: ${report.reportPaths.json}`);
  if ("dbPath" in report) {
    console.log(
      report.dbKept
        ? `Eval DB kept: ${report.dbPath}`
        : `Eval DB removed after success: ${report.dbPath}`,
    );
  } else if ("armNames" in report) {
    for (const armName of report.armNames) {
      const arm = report.arms[armName];
      console.log(
        report.dbKept
          ? `${armName} eval DB kept: ${arm.dbPath}`
          : `${armName} eval DB removed after success: ${arm.dbPath}`,
      );
    }
  } else {
    console.log("No eval DB was created for this report-only suite.");
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    keepDb: false,
    recordRunEvidence: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--suite") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --suite <name>.");
      }
      parsed.suiteName = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--suite=")) {
      parsed.suiteName = arg.slice("--suite=".length);
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

    if (arg === "--keep-db") {
      parsed.keepDb = true;
      continue;
    }

    if (arg === "--repeats") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --repeats <n>.");
      }
      parsed.repeats = parseRepeatsArg(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--repeats=")) {
      parsed.repeats = parseRepeatsArg(arg.slice("--repeats=".length));
      continue;
    }

    if (arg === "--record-run-evidence") {
      parsed.recordRunEvidence = true;
      continue;
    }

    if (arg === "--manifest") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --manifest <manifest-json>.");
      }
      parsed.manifestPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--manifest=")) {
      parsed.manifestPath = arg.slice("--manifest=".length);
      continue;
    }

    if (arg === "--dataset") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --dataset <dataset-json>.");
      }
      parsed.datasetPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--dataset=")) {
      parsed.datasetPath = arg.slice("--dataset=".length);
      continue;
    }

    if (arg === "--citation-dataset") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --citation-dataset <dataset-json>.");
      }
      parsed.citationDatasetPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--citation-dataset=")) {
      parsed.citationDatasetPath = arg.slice("--citation-dataset=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parseRepeatsArg(value: string) {
  const repeats = Number(value);

  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error("--repeats must be a positive integer.");
  }

  return repeats;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    if (error instanceof EvalRunnerError) {
      console.error(error.message);
      if (error.details.dbPath) {
        console.error(`Eval DB retained for inspection: ${error.details.dbPath}`);
      }
      if (error.details.report) {
        console.error(`Report markdown: ${error.details.report.reportPaths.markdown}`);
        console.error(`Report JSON: ${error.details.report.reportPaths.json}`);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
