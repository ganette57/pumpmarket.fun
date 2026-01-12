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
  proposed_winning_outcome: number | null;
};

function jsonError(message: string, status: number, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

export async function POST(req: Request) {
  const ok = await isAdminRequest(req);
  if (!ok) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json().catch(() => ({}));
    const marketAddress = String(body?.market || body?.market_address || "").trim();
    if (!marketAddress) return jsonError("Missing market", 400);

    const supabase = supabaseAdmin();

    const { data: mk, error } = await supabase
      .from("markets")
      .select(
        "id, market_address, resolution_status, resolved, cancelled, contest_deadline, contest_count, proposed_winning_outcome"
      )
      .eq("market_address", marketAddress)
      .maybeSingle();

    if (error) throw error;
    if (!mk) return jsonError("Market not found", 404);

    const market = mk as MarketRow;

    const status = String(market.resolution_status || "open").toLowerCase();
    if (status !== "proposed") {
      return jsonError(`Market not in proposed state (status=${status})`, 409, { code: "BAD_STATUS" });
    }
    if (market.resolved) return jsonError("Market already resolved (DB).", 409, { code: "ALREADY_RESOLVED" });
    if (market.cancelled) return jsonError("Market already cancelled (DB).", 409, { code: "ALREADY_CANCELLED" });

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

    // IMPORTANT: Do NOT require proposed_winning_outcome here.
    // UI can fallback to on-chain proposedOutcome.
    return NextResponse.json({
      ok: true,
      action: "approve",
      market: {
        id: market.id,
        market_address: market.market_address,
        proposed_winning_outcome: market.proposed_winning_outcome, // may be null
        contest_count: market.contest_count ?? 0,
        contest_deadline: market.contest_deadline,
      },
    });
  } catch (e: any) {
    console.error("admin approve route error:", e);
    return jsonError(e?.message || "Failed", 500);
  }
}