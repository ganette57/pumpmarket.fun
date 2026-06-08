import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Awards trading points for a confirmed trade. 1 USD volume = 1 point.
// Referral propagation (first-trade bonus + 10% trading bonus) is handled
// inside the SECURITY DEFINER RPC fp_award_trade so the ledger stays
// authoritative.
//
// Called from the client immediately after a successful buy. Re-calling
// with the same txSignature is safe — the ledger metadata records the
// signature but we do not dedupe (Phase 2 is best-effort idempotency).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet || "").trim();
    const costSolRaw = Number(body?.costSol);
    const marketAddress = body?.marketAddress ?? null;
    const txSignature = body?.txSignature ?? null;

    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    }
    if (!Number.isFinite(costSolRaw) || costSolRaw <= 0) {
      return NextResponse.json({ awarded: 0, reason: "zero_volume" });
    }

    const supa = supabaseServer();
    const { data, error } = await supa.rpc("fp_award_trade", {
      wallet_in: wallet,
      cost_sol_in: costSolRaw,
      metadata_in: { market: marketAddress, tx: txSignature },
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ awarded: Number(data) || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
