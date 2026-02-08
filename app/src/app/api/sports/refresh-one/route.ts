import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getProvider } from "@/lib/sportsProvider";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sportEventId = String(body.sport_event_id || "").trim();
    if (!sportEventId) {
      return NextResponse.json({ error: "sport_event_id required" }, { status: 400 });
    }

    const supabase = supabaseServer();

    // Fetch current row
    const { data: event, error: fetchErr } = await supabase
      .from("sport_events")
      .select("*")
      .eq("id", sportEventId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: "Sport event not found" }, { status: 404 });
    }

    // If admin token provided AND event is pollable, call provider
    const token = req.headers.get("x-refresh-token");
    const expected = process.env.SPORTS_REFRESH_TOKEN;
    const isAdmin = !!expected && token === expected;

    if (isAdmin && ["scheduled", "live"].includes(event.status)) {
      const provider = getProvider();
      const change = await provider.updateEvent(event);
      if (change) {
        const patch: Record<string, unknown> = {
          status: change.status,
          score: change.score,
          last_update: new Date().toISOString(),
        };
        if (change.raw !== undefined) patch.raw = change.raw;

        await supabase.from("sport_events").update(patch).eq("id", sportEventId);

        // Update sport_trading_state on linked markets if terminal
        if (["finished", "cancelled", "postponed"].includes(change.status)) {
          await supabase
            .from("markets")
            .update({ sport_trading_state: "ended_by_sport" })
            .eq("sport_event_id", sportEventId)
            .in("market_mode", ["sport", "sport_live"]);
        }

        // Re-fetch updated row
        const { data: updated } = await supabase
          .from("sport_events")
          .select("*")
          .eq("id", sportEventId)
          .maybeSingle();

        return NextResponse.json({ ok: true, event: updated || event });
      }
    }

    // Public / no change: return cached row
    return NextResponse.json({ ok: true, event });
  } catch (e: any) {
    console.error("sports/refresh-one crash:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
