import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminRequest } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

type MarketRow = {
  id: string;
  market_address: string;
  resolution_status: string | null;
  resolved: boolean | null;
  cancelled: boolean | null;
  contest_deadline: string | null;
  contest_count: number | null;
  end_date: string | null;
};

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

export async function POST(req: Request) {
  const ok = await isAdminRequest(req);
  if (!ok) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json().catch(() => ({}));
    const marketAddress = String(body?.market || body?.market_address || "").trim();
    if (!marketAddress) return jsonError("Missing market", 400);

    // Action can be "admin_cancel" (default) or "cancel_if_no_proposal" (for 24h stale markets)
    const action = String(body?.action || "admin_cancel");

    const supabase = supabaseAdmin();

    const { data: mk, error } = await supabase
      .from("markets")
      .select("id, market_address, resolution_status, resolved, cancelled, contest_deadline, contest_count, end_date")
      .eq("market_address", marketAddress)
      .maybeSingle();

    if (error) throw error;
    if (!mk) return jsonError("Market not found", 404);

    const market = mk as MarketRow;

    // Common checks
    if (market.resolved) return jsonError("Market already resolved (DB).", 409, { code: "ALREADY_RESOLVED" });
    if (market.cancelled) return jsonError("Market already cancelled (DB).", 409, { code: "ALREADY_CANCELLED" });

    const status = String(market.resolution_status || "open").toLowerCase();

    // === CASE 1: admin_cancel (for disputed proposed markets) ===
    if (action === "admin_cancel") {
      if (status !== "proposed") {
        return jsonError(`Market not in proposed state (status=${status})`, 409, { code: "BAD_STATUS" });
      }

      const deadlineMs = market.contest_deadline ? new Date(market.contest_deadline).getTime() : NaN;
      if (!Number.isFinite(deadlineMs)) {
        return jsonError("Missing/invalid contest_deadline", 409, { code: "NO_DEADLINE" });
      }
      if (deadlineMs > Date.now()) {
        return jsonError("Contest window still open.", 409, {
          code: "WINDOW_OPEN",
          contest_deadline: market.contest_deadline,
        });
      }

      return NextResponse.json({
        ok: true,
        action: "admin_cancel",
        market: {
          id: market.id,
          market_address: market.market_address,
          contest_count: market.contest_count ?? 0,
          contest_deadline: market.contest_deadline,
        },
      });
    }

    // === CASE 2: cancel_if_no_proposal (for 24h stale markets) ===
    if (action === "cancel_if_no_proposal") {
      // Must be in "open" status (no proposal made)
      if (status !== "open") {
        return jsonError(`Market not in open state (status=${status}). Use admin_cancel for proposed markets.`, 409, {
          code: "NOT_OPEN",
        });
      }

      // Must have ended
      const endMs = market.end_date ? new Date(market.end_date).getTime() : NaN;
      const now = Date.now();
      if (!Number.isFinite(endMs)) {
        return jsonError("Missing/invalid end_date", 409, { code: "NO_END_DATE" });
      }
      if (endMs > now) {
        return jsonError("Market has not ended yet.", 409, { code: "NOT_ENDED", end_date: market.end_date });
      }

      // Must be >24h since end (changed from 48h)
      const cutoff24h = now - 24 * 60 * 60 * 1000;
      if (endMs > cutoff24h) {
        const hoursRemaining = Math.ceil((endMs + 24 * 60 * 60 * 1000 - now) / (60 * 60 * 1000));
        return jsonError(`24h window not reached. Wait ${hoursRemaining}h more.`, 409, {
          code: "NOT_24H",
          end_date: market.end_date,
          hours_remaining: hoursRemaining,
        });
      }

      return NextResponse.json({
        ok: true,
        action: "cancel_if_no_proposal",
        market: {
          id: market.id,
          market_address: market.market_address,
          end_date: market.end_date,
        },
      });
    }

    return jsonError(`Unknown action: ${action}`, 400, { code: "UNKNOWN_ACTION" });
  } catch (e: unknown) {
    console.error("admin cancel route error:", e);
    return jsonError((e as { message?: string })?.message || "Failed", 500);
  }
}