import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { loadProfileData } from "@/server/adaptivepath/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadProfileData({ db: prisma, coach: null }));
  } catch (error) {
    const response = biologyErrorResponse(error);
    if (response.status >= 500) console.error("AdaptivePath profile request failed", error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
