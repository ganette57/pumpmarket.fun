// app/src/app/api/admin/overview/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminRequest } from "@/lib/admin";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function toNumber(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

type MarketRow = {
  market_address: string;
  question: string | null;
  contest_deadline: string | null;
  contest_count: number;
};

export async function GET(req: Request) {
  // ✅ protect route with your admin cookie/session
  const ok = await isAdminRequest(req);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use service role for admin KPIs (server-only env)
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  try {
    // ---- MARKETS COUNTS ----
    // We fetch minimal columns once then compute. (simple + stable)
    const { data: markets, error: mErr } = await supabase
      .from("markets")
      .select(
        "id, resolved, resolution_status, end_date, total_volume, contest_count, contested, contest_deadline, question, market_address"
      )
      .limit(5000);

    if (mErr) throw mErr;

    const now = Date.now();

    let markets_total = 0;
    let markets_open = 0;
    let markets_ended = 0;
    let markets_proposed = 0;
    let markets_finalized = 0;
    let markets_cancelled = 0;

    let volume_sol_total = 0;

    const proposed_markets: MarketRow[] = [];
    const disputed_markets: MarketRow[] = [];

    for (const mk of markets || []) {
      markets_total += 1;

      const status = String(mk.resolution_status || "open").toLowerCase();
      const resolved = !!mk.resolved;

      const endMs = mk.end_date ? new Date(mk.end_date).getTime() : NaN;
      const ended = Number.isFinite(endMs) ? endMs <= now : false;

      volume_sol_total += toNumber(mk.total_volume) / 1e9; // assuming total_volume is lamports

      if (status === "cancelled") markets_cancelled += 1;
      if (status === "finalized" || resolved) markets_finalized += 1;

      if (status === "proposed") {
        markets_proposed += 1;

        const row: MarketRow = {
          market_address: String(mk.market_address || ""),
          question: mk.question ?? null,
          contest_deadline: mk.contest_deadline ?? null,
          contest_count: Number(mk.contest_count || 0) || 0,
        };

        proposed_markets.push(row);
        if (row.contest_count > 0) disputed_markets.push(row);
      }

      // "open" = not resolved, not proposed, not cancelled, not ended
      const closed = resolved || status === "proposed" || status === "cancelled" || ended;
      if (!closed) markets_open += 1;
      if (ended) markets_ended += 1;
    }

    // sort proposed by contest_deadline soonest first (or most disputed)
    proposed_markets.sort((a, b) => {
      const ad = a.contest_deadline ? new Date(a.contest_deadline).getTime() : Infinity;
      const bd = b.contest_deadline ? new Date(b.contest_deadline).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (b.contest_count || 0) - (a.contest_count || 0);
    });

    // disputes: hottest first
    disputed_markets.sort((a, b) => {
      if (a.contest_count !== b.contest_count) return b.contest_count - a.contest_count;
      const ad = a.contest_deadline ? new Date(a.contest_deadline).getTime() : Infinity;
      const bd = b.contest_deadline ? new Date(b.contest_deadline).getTime() : Infinity;
      return ad - bd;
    });

    // ---- TRANSACTIONS KPIs ----
    const { count: tx_count, error: txErr } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true });
    if (txErr) throw txErr;

    // unique traders (fetch distinct user_address)
    // If your table is big, you can optimize later with an RPC.
    const { data: traders, error: trErr } = await supabase.from("transactions").select("user_address").limit(5000);
    if (trErr) throw trErr;

    const unique_traders = new Set(
      (traders || []).map((t: any) => String(t.user_address || "")).filter(Boolean)
    ).size;

    // ---- DISPUTES KPIs ----
    // If you track disputes via contested/contest_count on markets:
    let disputes_total = 0;
    let disputes_open = 0;

    for (const mk of markets || []) {
      const count = Number(mk.contest_count || 0) || 0;
      disputes_total += count;

      const status = String(mk.resolution_status || "open").toLowerCase();
      const resolved = !!mk.resolved;

      const deadlineMs = mk.contest_deadline ? new Date(mk.contest_deadline).getTime() : NaN;
      const contestOpen = status === "proposed" && !resolved && Number.isFinite(deadlineMs) && deadlineMs > now;

      if (contestOpen && count > 0) disputes_open += count;
    }

    return NextResponse.json({
      kpi: {
        markets_total,
        markets_open,
        markets_ended,
        markets_proposed,
        markets_finalized,
        markets_cancelled,
        volume_sol_total: Number(volume_sol_total.toFixed(4)),
        tx_count: tx_count || 0,
        unique_traders,
        disputes_open,
        disputes_total,
      },
      proposed_markets: proposed_markets.slice(0, 30),
      disputed_markets: disputed_markets.slice(0, 30),
    });
  } catch (e: any) {
    console.error("admin overview error", e);
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}