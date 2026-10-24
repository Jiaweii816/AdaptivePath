import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { buildManualProvenanceManifest } from "@/server/memory/replay/manual-provenance-review";

async function main() {
  const inputPath = resolve(readArg("--input"));
  const outputPath = resolve(readArg("--out"));
  const learnerHandle = readArg("--handle", "Iris904");
  const markdown = await readFile(inputPath, "utf8");
  const manifest = buildManualProvenanceManifest({ learnerHandle, markdown });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({ inputPath, outputPath, ...manifest.counts, decisionFingerprint: manifest.decisionFingerprint }, null, 2)}\n`,
  );
}

function readArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
