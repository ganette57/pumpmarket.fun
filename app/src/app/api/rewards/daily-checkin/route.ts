import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { wallet } = await req.json().catch(() => ({}));
    const w = String(wallet || "").trim();
    if (!w) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const supa = supabaseServer();
    const { data, error } = await supa.rpc("fp_claim_daily_checkin", { wallet_in: w });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      awarded: !!row?.awarded,
      points: Number(row?.points) || 0,
      streak: Number(row?.streak) || 0,
      balance: Number(row?.balance) || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
