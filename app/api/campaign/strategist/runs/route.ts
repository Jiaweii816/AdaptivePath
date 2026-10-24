import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import {
  loadCampaignStrategistProductView,
  loadCampaignPlanningReviewView,
  requestCampaignStrategistProposal,
  requestCampaignStrategistSimulation,
  resolveActiveCampaignForLearner,
} from "@/server/campaign/services";
import { classifyStrategistTodayScope } from "@/server/campaign/services/strategist-today-scope";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

const requestSchema = z.object({
  campaignId: z.string().min(1).optional(),
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestText: z.string().trim().min(1).max(2_000),
  runMode: z.enum(["proposal", "simulation"]).default("proposal"),
}).strict();

export async function GET(request: Request) {
  try {
    const runId = new URL(request.url).searchParams.get("runId")?.trim() || undefined;
    const userId = await resolveLocalTraceUserId(prisma);
    const active = await resolveActiveCampaignForLearner(prisma, userId);
    if (active.kind !== "active") {
      return NextResponse.json({ ok: false, code: "campaign_not_found", error: "No active Campaign was found." }, { status: 404 });
    }
    const [strategist, planning] = await Promise.all([
      loadCampaignStrategistProductView({ db: prisma, userId, campaignId: active.campaign.id, runId, now: new Date() }),
      loadCampaignPlanningReviewView({ db: prisma, userId, campaignId: active.campaign.id }),
    ]);
    if (runId && !strategist.latestRun) {
      return NextResponse.json({ ok: false, code: "run_not_found", message: "The requested Strategist run was not found.", error: "The requested Strategist run was not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, strategist, planning });
  } catch (error) {
    console.error("Campaign Strategist status request failed.", error);
    return NextResponse.json({ ok: false, code: "strategist_unavailable", message: "Strategist status is temporarily unavailable.", error: "Strategist status is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const [userId, body] = await Promise.all([resolveLocalTraceUserId(prisma), request.json()]);
    const parsed = requestSchema.parse(body);
    const todayScope = classifyStrategistTodayScope(parsed.requestText);
    if (todayScope.todayMutationRequested) {
      return NextResponse.json({
        ok: false,
        code: "unsupported_scope_today_immutable",
        message: "Strategist can adjust tomorrow and later only. Today's materialized task will not be replaced.",
        error: "Strategist can adjust tomorrow and later only. Today's materialized task will not be replaced.",
      }, { status: 422 });
    }
    const active = parsed.campaignId
      ? { kind: "active" as const, campaign: { id: parsed.campaignId } }
      : await resolveActiveCampaignForLearner(prisma, userId);
    if (active.kind !== "active") {
      return NextResponse.json({ ok: false, code: "campaign_not_found", error: "No active Campaign was found." }, { status: 404 });
    }
    const runInput = { db: prisma, userId, campaignId: active.campaign.id, campaignDate: parsed.campaignDate, requestText: parsed.requestText, now: new Date() };
    const result = parsed.runMode === "simulation"
      ? await requestCampaignStrategistSimulation(runInput)
      : await requestCampaignStrategistProposal(runInput);
    const status = result.kind === "rate_limited" ? 429
      : result.kind === "pending_patch" ? 409
      : result.kind === "campaign_not_found" ? 404
      : 202;
    const run = "run" in result ? result.run : null;
    const ok = result.kind === "queued" || result.kind === "already_exists";
    const errorMessages: Record<string, string> = {
      pending_patch: "A Patch is already awaiting review. Resolve the current proposal first.",
      campaign_not_found: "No active Campaign is available.",
      rate_limited: "Today's Strategist run limit has been reached. Today and Workbench are unaffected.",
    };
    return NextResponse.json({
      ok,
      ...(ok ? {} : { code: result.kind, message: errorMessages[result.kind] ?? "Strategist could not start.", error: errorMessages[result.kind] ?? "Strategist could not start." }),
      result: {
        kind: result.kind,
        runId: run?.id ?? null,
        status: run?.status ?? null,
        runMode: parsed.runMode,
        ...(result.kind === "rate_limited" ? { code: result.code, quota: result.quota } : {}),
      },
    }, { status });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, code: "validation_failed", message: "Strategist request is invalid.", error: "Strategist request is invalid." }, { status: 400 });
    }
    console.error("Campaign Strategist proposal request failed.", error);
    return NextResponse.json({ ok: false, code: "strategist_unavailable", message: "Strategist is temporarily unavailable.", error: "Strategist is temporarily unavailable." }, { status: 503 });
  }
}
