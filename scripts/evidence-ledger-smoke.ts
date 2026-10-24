/**
 * Read-only projection smoke for the Evidence Ledger page.
 * Run against an explicit isolated database copy, never learner `dev.db`:
 *   DATABASE_URL="file:/abs/path/copy.db" npx tsx scripts/evidence-ledger-smoke.ts
 */
import { getEvidenceLedgerData } from "@/features/profile/ledger/load-evidence-ledger";

function line(label: string, value: string | number) {
  console.log(`${label.padEnd(26)} ${value}`);
}

async function main() {
  const data = await getEvidenceLedgerData();

  console.log("=== totals ===");
  for (const [key, value] of Object.entries(data.totals)) line(key, value);

  console.log("\n=== L3 slots (gate values) ===");
  for (const slot of data.slots) {
    line(
      `${slot.clusterCount}c/${slot.problemCount}p ${slot.facts.length}f`,
      `[${slot.slot}] proposed=${slot.proposedConfidence.toFixed(2)} ${slot.text.slice(0, 46)}`,
    );
  }

  console.log("\n=== L2 facts, newest first (top 12) ===");
  for (const fact of data.facts.slice(0, 12)) {
    const drift = fact.untraceableCount > 0 ? ` DRIFT+${fact.untraceableCount}` : "";
    line(
      `${fact.group}/${fact.confidence.toFixed(2)} x${fact.evidenceCount}`,
      `${fact.mechanismKey} | rows=${fact.evidence.length} ver=${fact.verifiedCount} probs=${fact.distinctProblemCount}${drift}`,
    );
  }

  const groups = data.facts.reduce<Record<string, number>>((acc, fact) => {
    acc[fact.group] = (acc[fact.group] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\n=== group tallies ===");
  for (const [group, count] of Object.entries(groups)) line(group, count);

  const drifting = data.facts.filter((fact) => fact.untraceableCount > 0);
  line("facts with drift", `${drifting.length} / ${data.facts.length}`);

  console.log("\n=== self-reported audit ===");
  for (const audit of data.selfReported) {
    line(
      `${audit.verdict}/${audit.claimedAs}`,
      `${audit.label} -> +${audit.positiveFacts.length} -${audit.negativeFacts.length}`,
    );
  }

  console.log("\n=== episodes (top 5) ===");
  for (const episode of data.episodes.slice(0, 5)) {
    line(`${episode.kind}/${episode.outcome}`, episode.title.slice(0, 58));
  }

  console.log("\n=== candidates (top 3) ===");
  for (const candidate of data.candidates.slice(0, 3)) {
    line(candidate.factType, `${candidate.problemTitle} | ${candidate.statement.slice(0, 44)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
