import type { PrismaClient } from "@prisma/client";
import { irisHandle } from "@/features/onboarding/profile-defaults";

export const LOCAL_TRACE_USER_HANDLE = irisHandle;

/**
 * The local MVP has no authentication/session provider yet. Trace routes
 * resolve the fixed local learner on the server and never accept userId from
 * query parameters or request bodies. Replace only when real auth exists.
 */
export async function resolveLocalTraceUserId(
  prisma: Pick<PrismaClient, "user">,
) {
  const user = await prisma.user.findUnique({
    where: { handle: LOCAL_TRACE_USER_HANDLE },
    select: { id: true },
  });
  if (!user) throw new Error(`Local trace user ${LOCAL_TRACE_USER_HANDLE} was not found.`);
  return user.id;
}
