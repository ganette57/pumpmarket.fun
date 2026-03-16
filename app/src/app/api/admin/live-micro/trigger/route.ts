import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import {
  assertLiveMicroGuards,
  getLiveMicroFlags,
  getLiveMicroSoccerLoopConfig,
  getLiveMicroWindowMinutes,
} from "@/lib/liveMicro/config";
import { ensureLiveMicroAutoTickStarted, getLiveMicroAutoTickStatus } from "@/lib/liveMicro/autoTick";
import { activateLiveMicroMatchLoop, startLiveMicroMarket, tickLiveMicroMarkets } from "@/lib/liveMicro/engine";
import { findLiveMicroMatchLoopByMatch, getLiveMicroMatchLoopById, listRecentLiveMicroMatchLoops } from "@/lib/liveMicro/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TriggerAction = "start" | "tick" | "activate_match" | "start_loop" | "loop_status";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

function toInt(x: unknown, fallback: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function parseSnapshotOverride(body: Record<string, unknown>) {
  const override = body.override_snapshot as Record<string, unknown> | undefined;
  if (!override || typeof override !== "object") return undefined;

  const homeScore = Number(override.home_score ?? override.homeScore);
  const awayScore = Number(override.away_score ?? override.awayScore);
  const statusRaw = String(override.status || "live").trim().toLowerCase();
  const status =
    statusRaw === "scheduled" || statusRaw === "live" || statusRaw === "finished" || statusRaw === "unknown"
      ? (statusRaw as "scheduled" | "live" | "finished" | "unknown")
      : "live";

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    throw new Error("override_snapshot requires numeric home_score and away_score");
  }

  return {
    homeScore: Math.floor(homeScore),
    awayScore: Math.floor(awayScore),
    status,
  };
}

async function isAuthorized(req: Request): Promise<boolean> {
  const adminOk = await isAdminRequest(req);
  if (adminOk) return true;

  const flags = getLiveMicroFlags();
  const expected = flags.triggerToken;
  if (!expected) return false;

  const token = String(req.headers.get("x-live-micro-token") || "").trim();
  return token === expected;
}

export async function POST(req: Request) {
  ensureLiveMicroAutoTickStarted();
  const authorized = await isAuthorized(req);
  if (!authorized) return jsonError("Unauthorized", 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // keep empty body
  }

  const actionRaw = String(body.action || "start").trim().toLowerCase();
  const action: TriggerAction =
    actionRaw === "tick" ||
      actionRaw === "activate_match" ||
      actionRaw === "start_loop" ||
      actionRaw === "loop_status"
      ? actionRaw
      : "start";

  try {
    const flags = assertLiveMicroGuards({ requireOperator: true });

    if (action === "start") {
      const providerMatchId = String(body.provider_match_id || body.providerMatchId || "").trim();
      if (!providerMatchId) {
        return jsonError("provider_match_id is required", 400);
      }

      const providerName = String(body.provider_name || body.providerName || "api-football").trim();
      const windowMinutes = toInt(body.window_minutes, getLiveMicroWindowMinutes());

      const result = await startLiveMicroMarket({
        providerMatchId,
        providerName,
        windowMinutes,
      });

      return NextResponse.json({
        ok: true,
        action,
        auto_tick: getLiveMicroAutoTickStatus(),
        guards: {
          cluster: flags.currentCluster,
          allowed_cluster: flags.allowedCluster,
          dev_only: flags.devOnly,
        },
        result,
      });
    }

    if (action === "activate_match" || action === "start_loop") {
      const providerMatchId = String(body.provider_match_id || body.providerMatchId || "").trim();
      if (!providerMatchId) return jsonError("provider_match_id is required", 400);

      const providerName = String(body.provider_name || body.providerName || "api-football").trim();
      const windowMinutes = toInt(body.window_minutes, getLiveMicroWindowMinutes());
      const activatedBy = String(
        body.activated_by ||
        body.activatedBy ||
        req.headers.get("x-live-micro-actor") ||
        "admin_or_token",
      ).trim();

      const result = await activateLiveMicroMatchLoop({
        providerMatchId,
        providerName,
        activatedBy: activatedBy || "admin_or_token",
        windowMinutes,
      });

      return NextResponse.json({
        ok: true,
        action,
        auto_tick: getLiveMicroAutoTickStatus(),
        guards: {
          cluster: flags.currentCluster,
          allowed_cluster: flags.allowedCluster,
          dev_only: flags.devOnly,
        },
        loop_config: getLiveMicroSoccerLoopConfig(),
        result,
      });
    }

    if (action === "loop_status") {
      const id = String(body.loop_id || body.id || "").trim();
      const providerMatchId = String(body.provider_match_id || body.providerMatchId || "").trim();
      const providerName = String(body.provider_name || body.providerName || "api-football").trim();
      const limit = toInt(body.limit, 20);

      if (id) {
        const loop = await getLiveMicroMatchLoopById(id);
        return NextResponse.json({
          ok: true,
          action,
          auto_tick: getLiveMicroAutoTickStatus(),
          guards: {
            cluster: flags.currentCluster,
            allowed_cluster: flags.allowedCluster,
            dev_only: flags.devOnly,
          },
          loop_config: getLiveMicroSoccerLoopConfig(),
          loop,
        });
      }

      if (providerMatchId) {
        const loop = await findLiveMicroMatchLoopByMatch({ providerMatchId, providerName });
        return NextResponse.json({
          ok: true,
          action,
          auto_tick: getLiveMicroAutoTickStatus(),
          guards: {
            cluster: flags.currentCluster,
            allowed_cluster: flags.allowedCluster,
            dev_only: flags.devOnly,
          },
          loop_config: getLiveMicroSoccerLoopConfig(),
          loop,
        });
      }

      const loops = await listRecentLiveMicroMatchLoops(limit);
      return NextResponse.json({
        ok: true,
        action,
        auto_tick: getLiveMicroAutoTickStatus(),
        guards: {
          cluster: flags.currentCluster,
          allowed_cluster: flags.allowedCluster,
          dev_only: flags.devOnly,
        },
        loop_config: getLiveMicroSoccerLoopConfig(),
        loops,
      });
    }

    const tickResult = await tickLiveMicroMarkets({
      id: String(body.id || "").trim() || undefined,
      providerMatchId: String(body.provider_match_id || body.providerMatchId || "").trim() || undefined,
      limit: toInt(body.limit, 20),
      snapshotOverride: parseSnapshotOverride(body),
    });

    return NextResponse.json({
      ok: true,
      action,
      auto_tick: getLiveMicroAutoTickStatus(),
      guards: {
        cluster: flags.currentCluster,
        allowed_cluster: flags.allowedCluster,
        dev_only: flags.devOnly,
      },
      ...tickResult,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return jsonError(msg, 500, { action });
  }
}
