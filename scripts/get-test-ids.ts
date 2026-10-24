import { loadLocalEnv } from "@/lib/env";
loadLocalEnv();
import prisma from "@/server/db/prisma";

async function main() {
  const p = await prisma.problem.findFirst({ where: { slug: "two-sum" }, include: { testCases: { where: { isVisible: true, userId: null }, take: 2 } } });
  const user = await prisma.user.findFirst({ where: { handle: "Iris904" } });
  console.log("Two Sum ID:", p?.id);
  console.log("Test IDs:", p?.testCases.map(t => t.id));
  console.log("User ID:", user?.id);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
