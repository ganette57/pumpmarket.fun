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

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

export async function POST(req: Request) {
  const ok = await isAdminRequest(req);
  if (!ok) return jsonError("Unauthorized", 401);

  try {
    const body = await req.json().catch(() => ({}));

    const market = String(body?.market || body?.market_address || "").trim();
    const txSig = String(body?.tx_sig || body?.txSig || body?.signature || "").trim();
    const reason = String(body?.reason || "admin").trim(); // "admin" or "no_proposal_48h"

    if (!market || !txSig) {
      return jsonError("Missing market / tx_sig", 400, { got: { market: !!market, tx_sig: !!txSig } });
    }

    const supabase = supabaseAdmin();

    // Guard: only commit if not already resolved/cancelled
    const { data: cur, error: curErr } = await supabase
      .from("markets")
      .select("resolution_status, resolved, cancelled")
      .eq("market_address", market)
      .maybeSingle();

    if (curErr) throw curErr;
    if (!cur) return jsonError("Market not found", 404);

    const status = String(cur.resolution_status || "open").toLowerCase();

    // For admin_cancel: must be proposed
    // For cancel_if_no_proposal: must be open
    if (reason === "no_proposal_48h") {
      if (status !== "open" || cur.resolved || cur.cancelled) {
        return jsonError(`Cannot commit 48h cancel (status=${status}, resolved=${!!cur.resolved}, cancelled=${!!cur.cancelled})`, 409);
      }
    } else {
      // Default admin cancel - must be proposed
      if (status !== "proposed" || cur.resolved || cur.cancelled) {
        return jsonError(`Cannot commit cancel (status=${status}, resolved=${!!cur.resolved}, cancelled=${!!cur.cancelled})`, 409);
      }
    }

    const { error } = await supabase
      .from("markets")
      .update({
        resolution_status: "cancelled",
        cancelled: true,
        resolved: false,
        cancelled_at: new Date().toISOString(),
        cancel_tx: txSig,
        cancel_reason: reason,
      })
      .eq("market_address", market);

    if (error) return jsonError("DB update failed", 500);

    return NextResponse.json({ ok: true, market, tx_sig: txSig, reason });
  } catch (e: unknown) {
    console.error("cancel commit route error:", e);
    return jsonError((e as { message?: string })?.message || "Failed", 500);
  }
}