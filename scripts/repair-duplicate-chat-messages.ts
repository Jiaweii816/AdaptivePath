import { prisma } from "@/server/db/prisma";

export type ChatMessageRow = {
  id: string;
  sessionId: string;
  sequence: number;
  role: string;
  contentMarkdown: string;
};

/**
 * Fingerprint of the eager-write bug fixed in chat-reply.ts: a failed turn left
 * its user message committed, the learner retried, and a byte-identical row
 * landed immediately after. Only adjacent identical user rows qualify — a
 * learner legitimately re-asking the same question a turn later must survive.
 */
export function findDuplicateUserMessages(
  rows: readonly ChatMessageRow[],
): ChatMessageRow[] {
  const ordered = [...rows].sort(
    (left, right) =>
      left.sessionId.localeCompare(right.sessionId) || left.sequence - right.sequence,
  );

  const orphans: ChatMessageRow[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous.sessionId === current.sessionId &&
      previous.role === "user" &&
      current.role === "user" &&
      previous.contentMarkdown === current.contentMarkdown
    ) {
      orphans.push(previous);
    }
  }
  return orphans;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.chatMessage.findMany({
    select: { id: true, sessionId: true, sequence: true, role: true, contentMarkdown: true },
  });
  const orphans = findDuplicateUserMessages(rows);

  if (orphans.length === 0) {
    console.log("No duplicate user messages found.");
    return;
  }

  console.log(`Found ${orphans.length} orphaned user message(s) from failed turns:\n`);
  for (const orphan of orphans) {
    const preview = orphan.contentMarkdown.replace(/\s+/g, " ").slice(0, 60);
    console.log(`  session ${orphan.sessionId} · seq ${orphan.sequence} · ${preview}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to delete these rows.");
    return;
  }

  await prisma.chatMessage.deleteMany({
    where: { id: { in: orphans.map((orphan) => orphan.id) } },
  });
  console.log(`\nDeleted ${orphans.length} row(s).`);
}

if (process.argv[1]?.includes("repair-duplicate-chat-messages")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
