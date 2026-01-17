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

// Types for admin overview
type ActionableMarket = {
  market_address: string;
  question: string | null;
  contest_deadline: string | null;
  contest_count: number;
  end_date: string | null;
  proposed_winning_outcome: number | null;
  // Computed fields
  type: "proposed_no_dispute" | "proposed_disputed" | "no_proposal_48h";
  is_actionable: boolean;
  due_date: string | null; // contest_deadline for proposed, end_date for 48h
};

export async function GET(req: Request) {
  // protect route with your admin cookie/session
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
        "id, resolved, resolution_status, end_date, total_volume, contest_count, contested, contest_deadline, question, market_address, proposed_winning_outcome, cancelled"
      )
      .limit(5000);

    if (mErr) throw mErr;

    const now = Date.now();
    const cutoff48h = now - 48 * 60 * 60 * 1000;

    let markets_total = 0;
    let markets_open = 0;
    let markets_ended = 0;
    let markets_proposed = 0;
    let markets_finalized = 0;
    let markets_cancelled = 0;

    let volume_sol_total = 0;

    // Unified actionable_markets list
    const actionable_markets: ActionableMarket[] = [];

    for (const mk of markets || []) {
      markets_total += 1;

      const status = String(mk.resolution_status || "open").toLowerCase();
      const resolved = !!mk.resolved;
      const cancelled = !!mk.cancelled;

      const endMs = mk.end_date ? new Date(mk.end_date).getTime() : NaN;
      const ended = Number.isFinite(endMs) ? endMs <= now : false;

      volume_sol_total += toNumber(mk.total_volume) / 1e9; // assuming total_volume is lamports

      if (status === "cancelled" || cancelled) markets_cancelled += 1;
      if (status === "finalized" || resolved) markets_finalized += 1;

      // Case A/B: Proposed markets (with or without disputes)
      if (status === "proposed" && !resolved && !cancelled) {
        markets_proposed += 1;

        const contestCount = Number(mk.contest_count || 0) || 0;
        const deadlineMs = mk.contest_deadline ? new Date(mk.contest_deadline).getTime() : NaN;
        const isActionable = Number.isFinite(deadlineMs) && now >= deadlineMs;

        actionable_markets.push({
          market_address: String(mk.market_address || ""),
          question: mk.question ?? null,
          contest_deadline: mk.contest_deadline ?? null,
          contest_count: contestCount,
          end_date: mk.end_date ?? null,
          proposed_winning_outcome: mk.proposed_winning_outcome ?? null,
          type: contestCount > 0 ? "proposed_disputed" : "proposed_no_dispute",
          is_actionable: isActionable,
          due_date: mk.contest_deadline ?? null,
        });
      }

      // Case C: No proposal > 48h (open, ended, > 48h since end, not resolved/cancelled)
      if (status === "open" && !resolved && !cancelled && ended) {
        const is48hPassed = Number.isFinite(endMs) && endMs <= cutoff48h;
        if (is48hPassed) {
          actionable_markets.push({
            market_address: String(mk.market_address || ""),
            question: mk.question ?? null,
            contest_deadline: null,
            contest_count: 0,
            end_date: mk.end_date ?? null,
            proposed_winning_outcome: null,
            type: "no_proposal_48h",
            is_actionable: true, // always actionable once 48h passed
            due_date: mk.end_date ?? null,
          });
        }
      }

      // "open" = not resolved, not proposed, not cancelled, not ended
      const closed = resolved || cancelled || status === "proposed" || status === "cancelled" || ended;
      if (!closed) markets_open += 1;
      if (ended) markets_ended += 1;
    }

    // Sort: actionable first, then by due_date soonest, then by dispute count
    actionable_markets.sort((a, b) => {
      // Actionable first
      if (a.is_actionable !== b.is_actionable) return a.is_actionable ? -1 : 1;
      // Then by due_date soonest
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      // Then by dispute count (more disputes first)
      return (b.contest_count || 0) - (a.contest_count || 0);
    });

    // ---- TRANSACTIONS KPIs ----
    const { count: tx_count, error: txErr } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true });
    if (txErr) throw txErr;

    // unique traders (fetch distinct user_address)
    const { data: traders, error: trErr } = await supabase.from("transactions").select("user_address").limit(5000);
    if (trErr) throw trErr;

    const unique_traders = new Set(
      (traders || []).map((t: any) => String(t.user_address || "")).filter(Boolean)
    ).size;

    // ---- DISPUTES KPIs ----
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
      actionable_markets: actionable_markets.slice(0, 50),
    });
  } catch (e: any) {
    console.error("admin overview error", e);
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}