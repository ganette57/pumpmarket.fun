// src/app/api/markets/contest/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

const supabaseAdmin = () => {
  const url = mustEnv("SUPABASE_URL");
  const key = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
};

type Body = {
  market_address: string;

  // ✅ align with UI + DB
  disputor: string;          // wallet base58
  note?: string | null;      // free text
  proof_url?: string | null;
  proof_image?: string | null;
  proof_note?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const market_address = String(body.market_address || "").trim();
    const disputor = String(body.disputor || "").trim();

    const note = body.note ? String(body.note).trim() : null;
    const proof_url = body.proof_url ? String(body.proof_url).trim() : null;
    const proof_image = body.proof_image ? String(body.proof_image).trim() : null;
    const proof_note = body.proof_note ? String(body.proof_note).trim() : null;

    if (!market_address) return NextResponse.json({ error: "Missing market_address" }, { status: 400 });
    if (!disputor) return NextResponse.json({ error: "Missing disputor" }, { status: 400 });

    // allow note OR proof (or both)
    if (!note && !proof_url && !proof_image) {
      return NextResponse.json({ error: "Add a note and/or a proof (url or image)" }, { status: 400 });
    }
    if (proof_url && proof_image) {
      return NextResponse.json({ error: "Provide either proof_url OR proof_image, not both." }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    // 1) Load market + validate proposed + window open
    const { data: mk, error: mkErr } = await supabase
      .from("markets")
      .select("market_address,resolution_status,contest_deadline,resolved")
      .eq("market_address", market_address)
      .maybeSingle();

    if (mkErr) throw mkErr;
    if (!mk) return NextResponse.json({ error: "Market not found" }, { status: 404 });

    if (mk.resolved) return NextResponse.json({ error: "Market already resolved" }, { status: 400 });
    if (String(mk.resolution_status || "open") !== "proposed") {
      return NextResponse.json({ error: "Market is not in proposed state" }, { status: 400 });
    }

    const dl = mk.contest_deadline ? new Date(mk.contest_deadline).getTime() : NaN;
    if (!Number.isFinite(dl)) return NextResponse.json({ error: "Missing contest_deadline" }, { status: 400 });
    if (Date.now() > dl) return NextResponse.json({ error: "Contest window closed" }, { status: 400 });

    // 2) Insert dispute (ONLY include optional fields if provided)
    const row: any = {
        market_address,
        disputor,
        note,
        proof_url,
      };
  
      if (proof_image) row.proof_image = proof_image; // only if provided
      if (proof_note) row.proof_note = proof_note;    // only if provided
  
      const { data: inserted, error: insErr } = await supabase
        .from("market_disputes")
        .insert([row])
        .select("id,created_at")
        .single();

    // 3) Increment counters atomically via SQL function
    await supabase.rpc("increment_market_contest_count", { p_market_address: market_address });

    return NextResponse.json({ ok: true, dispute: inserted });
  } catch (e: any) {
    console.error("contest POST error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}