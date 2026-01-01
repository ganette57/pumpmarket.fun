import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function toInt(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const market_address = String(body.market_address || "").trim();
    const proposed_winning_outcome = toInt(body.proposed_winning_outcome, 0);
    const contest_deadline_iso = String(body.contest_deadline_iso || "").trim();

    const proposed_proof_url = body.proposed_proof_url ?? null;
    const proposed_proof_image = body.proposed_proof_image ?? null;
    const proposed_proof_note = body.proposed_proof_note ?? null;

    if (!market_address) {
      return NextResponse.json({ error: "market_address is required" }, { status: 400 });
    }
    if (!contest_deadline_iso) {
      return NextResponse.json({ error: "contest_deadline_iso is required" }, { status: 400 });
    }
    if (proposed_proof_url && proposed_proof_image) {
      return NextResponse.json({ error: "Provide either proposed_proof_url OR proposed_proof_image, not both." }, { status: 400 });
    }

    const payload = {
      resolution_status: "proposed",
      proposed_winning_outcome,
      resolution_proposed_at: new Date().toISOString(),
      contest_deadline: contest_deadline_iso,
      contested: false,
      contest_count: 0,
      proposed_proof_url,
      proposed_proof_image,
      proposed_proof_note,
    };

    const supabase = supabaseServer();

    // ⚠️ Option A: pas d’auth Supabase → on autorise si le caller prouve qu’il est le creator (message wallet)
    // Pour Phase 1.5: on laisse simple, on fait just update.
    // Phase 2: on verrouille avec signature wallet.
    const { error } = await supabase
      .from("markets")
      .update(payload)
      .eq("market_address", market_address);

    if (error) {
      console.error("API propose error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("API propose crash:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}