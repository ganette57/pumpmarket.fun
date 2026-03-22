import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { assertLiveMicroGuards, getLiveMicroFlags } from "@/lib/liveMicro/config";
import { ensureLiveMicroAutoTickStarted, getLiveMicroAutoTickStatus } from "@/lib/liveMicro/autoTick";
import { resolveFlashCryptoMajorSelection } from "@/lib/flashCrypto/majors";
import {
  listFlashCryptoGraduationSuggestions,
  startFlashCryptoCampaign,
  stopFlashCryptoCampaign,
  listFlashCryptoCampaigns,
  confirmFlashCryptoResolution,
  listPendingFlashCryptoResolutions,
} from "@/lib/flashCrypto/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionType =
  | "start_campaign"
  | "stop_campaign"
  | "list_campaigns"
  | "list_pending"
  | "list_suggestions"
  | "confirm_resolution";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
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
    // keep empty
  }

  const action = String(body.action || "list_campaigns").trim() as ActionType;

  try {
    const flags = assertLiveMicroGuards({ requireOperator: true });

    if (action === "start_campaign") {
      const mode = String(body.mode || "price").trim().toLowerCase() === "graduation" ? "graduation" : "price";
      const sourceType =
        mode === "price" && String(body.source_type || body.sourceType || "").trim().toLowerCase() === "major"
          ? "major"
          : "pump_fun";
      const majorSelection =
        sourceType === "major"
          ? resolveFlashCryptoMajorSelection({
              symbol: body.major_symbol || body.majorSymbol,
              pair: body.major_pair || body.majorPair,
              raw: body.token_mint || body.tokenMint,
            })
          : null;
      if (sourceType === "major" && !majorSelection) {
        return jsonError("major_symbol must be BTC, ETH, SOL, or BNB");
      }

      const tokenMint = String(body.token_mint || body.tokenMint || "").trim()
        || (majorSelection?.pair ?? "");
      if (!tokenMint) return jsonError("token_mint is required");

      const durationRaw = Number(body.duration_minutes || body.durationMinutes || (mode === "graduation" ? 10 : 5));
      const duration =
        mode === "graduation"
          ? ([10, 30, 60].includes(durationRaw) ? (durationRaw as 10 | 30 | 60) : 10)
          : ([1, 3, 5].includes(durationRaw) ? (durationRaw as 1 | 3 | 5) : 5);

      const totalMarkets = Math.max(1, Math.min(100, Math.floor(Number(body.total_markets || body.totalMarkets || 10))));
      const launchInterval = Math.max(1, Math.min(60, Math.floor(Number(body.launch_interval_minutes || body.launchIntervalMinutes || duration))));

      const result = await startFlashCryptoCampaign({
        tokenMint,
        mode,
        sourceType,
        majorSymbol: majorSelection?.symbol || null,
        majorPair: majorSelection?.pair || null,
        durationMinutes: duration,
        totalMarkets,
        launchIntervalMinutes: launchInterval,
      });

      return NextResponse.json({
        ok: true,
        action,
        auto_tick: getLiveMicroAutoTickStatus(),
        guards: {
          cluster: flags.currentCluster,
          allowed_cluster: flags.allowedCluster,
        },
        result,
      });
    }

    if (action === "stop_campaign") {
      const campaignId = String(body.campaign_id || body.campaignId || "").trim();
      if (!campaignId) return jsonError("campaign_id is required");

      const campaign = stopFlashCryptoCampaign(campaignId);
      if (!campaign) return jsonError("Campaign not found", 404);

      return NextResponse.json({
        ok: true,
        action,
        campaign,
      });
    }

    if (action === "list_campaigns") {
      const campaigns = listFlashCryptoCampaigns();
      return NextResponse.json({
        ok: true,
        action,
        campaigns,
      });
    }

    if (action === "list_pending") {
      const pending = await listPendingFlashCryptoResolutions();
      return NextResponse.json({
        ok: true,
        action,
        pending,
      });
    }

    if (action === "list_suggestions") {
      const durationRaw = Number(body.duration_minutes || body.durationMinutes || 10);
      const duration = [10, 30, 60].includes(durationRaw) ? (durationRaw as 10 | 30 | 60) : 10;
      const limit = Math.max(3, Math.min(60, Math.floor(Number(body.limit || 20))));
      const suggestions = await listFlashCryptoGraduationSuggestions({
        durationMinutes: duration,
        limit,
      });
      return NextResponse.json({
        ok: true,
        action,
        suggestions,
        duration_minutes: duration,
      });
    }

    if (action === "confirm_resolution") {
      const marketAddress = String(body.market_address || body.marketAddress || "").trim();
      if (!marketAddress) return jsonError("market_address is required");

      const outcome = String(body.outcome || "").trim().toUpperCase();
      if (outcome !== "YES" && outcome !== "NO") {
        return jsonError("outcome must be YES or NO");
      }

      const result = await confirmFlashCryptoResolution({
        marketAddress,
        outcome: outcome as "YES" | "NO",
      });

      return NextResponse.json({
        ok: true,
        action,
        result,
      });
    }

    return jsonError(`Unknown action: ${action}`, 400);
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return jsonError(msg, 500, { action });
  }
}
