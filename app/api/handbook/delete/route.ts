import { NextResponse } from "next/server";
import { z } from "zod";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";
import { deleteKnowledgeNote } from "@/server/memory/store/knowledge-note-store";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";

export const runtime = "nodejs";

const bodySchema = z.object({
  noteId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    const { noteId } = bodySchema.parse(await request.json());
    const user = await prisma.user.upsert({
      where: { handle: irisHandle },
      update: {},
      create: { handle: irisHandle },
    });
    await deleteKnowledgeNote(prisma, {
      userId: user.id,
      noteId,
      ftsStore: getDefaultFtsStore(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: "无法删除条目。" }, { status: 500 });
  }
}
