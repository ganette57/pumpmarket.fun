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
    const reason = String(body?.reason || "admin").trim(); // "admin" or "no_proposal_24h"

    if (!market || !txSig) {
      return jsonError("Missing market / tx_sig", 400, { got: { market: !!market, tx_sig: !!txSig } });
    }

    const supabase = supabaseAdmin();

    // Fetch current state
    const { data: cur, error: curErr } = await supabase
      .from("markets")
      .select("resolution_status, resolved, cancelled, cancel_tx")
      .eq("market_address", market)
      .maybeSingle();

    if (curErr) throw curErr;
    if (!cur) return jsonError("Market not found", 404);

    const status = String(cur.resolution_status || "open").toLowerCase();

    // ✅ CASE 1: Already cancelled - check if it's idempotent (same tx or needs update)
    if (cur.cancelled === true || status === "cancelled") {
      // If already cancelled with same tx_sig, just return success (idempotent)
      if (cur.cancel_tx === txSig) {
        return NextResponse.json({ 
          ok: true, 
          market, 
          tx_sig: txSig, 
          reason,
          note: "Already committed (idempotent)" 
        });
      }
      
      // If cancelled but no tx recorded, update with the tx_sig
      if (!cur.cancel_tx) {
        const { error } = await supabase
          .from("markets")
          .update({
            cancel_tx: txSig,
            cancel_reason: reason,
          })
          .eq("market_address", market);

        if (error) return jsonError("DB update failed", 500);

        return NextResponse.json({ 
          ok: true, 
          market, 
          tx_sig: txSig, 
          reason,
          note: "Updated cancel_tx on already cancelled market" 
        });
      }

      // Already cancelled with different tx - this is fine, tx succeeded on-chain
      return NextResponse.json({ 
        ok: true, 
        market, 
        tx_sig: txSig, 
        reason,
        note: "Market already cancelled, on-chain tx valid" 
      });
    }

    // ✅ CASE 2: Already resolved (finalized) - cannot cancel
    if (cur.resolved === true || status === "finalized") {
      return jsonError(
        `Market already finalized/resolved - cannot cancel`,
        409,
        { status, resolved: cur.resolved }
      );
    }

    // ✅ CASE 3: Normal flow - market is open or proposed, proceed with cancel
    const isNoProposal = reason === "no_proposal_24h" || reason === "no_proposal_48h";

    // Relaxed validation: allow cancel from open OR proposed state
    // On-chain tx already succeeded, so we should commit to DB
    if (status !== "open" && status !== "proposed") {
      // Unknown state - log but proceed anyway since on-chain succeeded
      console.warn(`[cancel/commit] Unexpected status=${status} for market=${market}, proceeding anyway`);
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