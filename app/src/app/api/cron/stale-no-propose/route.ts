import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function assertCronAuth(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) throw new Error("Unauthorized");
}

function supabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request) {
  try {
    assertCronAuth(req);

    const supabase = supabaseAdmin();

    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    // markets ended 48h ago, still not proposed/resolved/cancelled
    const { data, error } = await supabase
      .from("markets")
      .select("market_address, end_date, resolution_status, resolved, cancelled")
      .eq("resolved", false)
      .eq("cancelled", false)
      .eq("resolution_status", "open")
      .lte("end_date", cutoff)
      .limit(200);

    if (error) throw error;

    const addrs = (data || []).map((x: any) => x.market_address).filter(Boolean);

    if (!addrs.length) return NextResponse.json({ ok: true, updated: 0 });

    // ✅ juste flag DB (pas d’on-chain ici tant qu’on n’a pas une instruction dédiée)
    const { error: updErr } = await supabase
      .from("markets")
      .update({
        resolution_status: "stale_no_propose",
        stale_at: new Date().toISOString(),
      })
      .in("market_address", addrs);

    if (updErr) throw updErr;

    return NextResponse.json({ ok: true, updated: addrs.length, markets: addrs });
} catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}