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

function jsonError(message: string, status: number, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

export async function POST(req: Request) {
  const ok = await isAdminRequest(req);
  if (!ok) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json().catch(() => ({}));

    const market = String(body?.market || body?.market_address || "").trim();
    const txSig = String(body?.tx_sig || body?.txSig || body?.signature || "").trim();
    const woRaw = body?.winning_outcome ?? body?.winningOutcome ?? body?.winner;
    const winningOutcome = Number(woRaw);

    if (!market || !txSig || !Number.isFinite(winningOutcome)) {
      return jsonError("Missing market / winning_outcome / tx_sig", 400, {
        got: { market: !!market, tx_sig: !!txSig, winning_outcome: woRaw },
      });
    }
    if (winningOutcome < 0 || winningOutcome > 255) {
      return jsonError("winning_outcome out of range (u8)", 400, { winning_outcome: winningOutcome });
    }

    const supabase = supabaseAdmin();

    // Guard: only commit if still proposed (avoid double-click / race)
    const { data: cur, error: curErr } = await supabase
      .from("markets")
      .select("resolution_status, resolved, cancelled")
      .eq("market_address", market)
      .maybeSingle();

    if (curErr) throw curErr;
    if (!cur) return jsonError("Market not found", 404);

    const status = String(cur.resolution_status || "open").toLowerCase();
    if (status !== "proposed" || cur.resolved || cur.cancelled) {
      return jsonError(`Cannot commit approve (status=${status}, resolved=${!!cur.resolved}, cancelled=${!!cur.cancelled})`, 409);
    }

    const { error } = await supabase
      .from("markets")
      .update({
        resolved: true,
        cancelled: false,
        resolution_status: "finalized",
        winning_outcome: winningOutcome,
        resolved_at: new Date().toISOString(),
        resolve_tx: txSig,
      })
      .eq("market_address", market);

    if (error) return jsonError("DB update failed", 500);

    return NextResponse.json({ ok: true, market, winning_outcome: winningOutcome, tx_sig: txSig });
  } catch (e: any) {
    console.error("approve commit route error:", e);
    return jsonError(e?.message || "Failed", 500);
  }
}