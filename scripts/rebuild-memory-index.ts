import { runMemoryIntegrityCli } from "./memory-integrity";

void runMemoryIntegrityCli(["rebuild-index", ...process.argv.slice(2)]).catch(
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
