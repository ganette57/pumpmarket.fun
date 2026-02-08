import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getProvider, type SportEvent } from "@/lib/sportsProvider";

export async function POST(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────
  const token = req.headers.get("x-refresh-token");
  const expected = process.env.SPORTS_REFRESH_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = supabaseServer();
    const provider = getProvider();

    // ── Fetch pollable events (scheduled or live, within ±6h) ────
    const now = new Date();
    const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();

    const { data: events, error: fetchErr } = await supabase
      .from("sport_events")
      .select("*")
      .in("status", ["scheduled", "live"])
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd)
      .order("start_time", { ascending: true })
      .limit(50);

    if (fetchErr) {
      console.error("sports/refresh fetch error:", fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const updated: string[] = [];
    const skipped: string[] = [];

    for (const row of (events || []) as SportEvent[]) {
      const change = await provider.updateEvent(row);
      if (!change) {
        skipped.push(row.provider_event_id);
        continue;
      }

      // ── Update sport_events row ──────────────────────────────
      const patch: Record<string, unknown> = {
        status: change.status,
        score: change.score,
        last_update: new Date().toISOString(),
      };
      if (change.raw !== undefined) patch.raw = change.raw;

      const { error: updateErr } = await supabase
        .from("sport_events")
        .update(patch)
        .eq("id", row.id);

      if (updateErr) {
        console.error(`sports/refresh update error for ${row.id}:`, updateErr);
        skipped.push(row.provider_event_id);
        continue;
      }

      updated.push(row.provider_event_id);

      // ── If terminal, end linked live sessions ────────────────
      if (change.status === "finished" || change.status === "cancelled") {
        await endLinkedLiveSessions(supabase, row.id);
      }
    }

    return NextResponse.json({ ok: true, updated, skipped });
  } catch (e: any) {
    console.error("sports/refresh crash:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

/* -------------------------------------------------------------------------- */
/*  Helper: end linked live sessions defensively                               */
/* -------------------------------------------------------------------------- */

async function endLinkedLiveSessions(
  supabase: ReturnType<typeof supabaseServer>,
  sportEventId: string
) {
  try {
    // Find markets linked to this sport event
    const { data: markets, error: mErr } = await supabase
      .from("markets")
      .select("market_address")
      .eq("market_mode", "sport_live")
      .eq("sport_event_id", sportEventId);

    if (mErr || !markets?.length) return;

    const addresses = markets.map((m: { market_address: string }) => m.market_address);

    // End any active live sessions for these markets
    const now = new Date().toISOString();
    await supabase
      .from("live_sessions")
      .update({ status: "ended", ended_at: now, end_at: now })
      .in("market_address", addresses)
      .in("status", ["live", "locked", "scheduled"]);
  } catch (e) {
    // Defensive: if live_sessions table doesn't exist or query fails, ignore
    console.warn("endLinkedLiveSessions (non-fatal):", e);
  }
}
