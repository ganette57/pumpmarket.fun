import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getProvider } from "@/lib/sportsProvider";
import {
  isAvailable as isApiSportsAvailable,
  fetchEvent,
} from "@/lib/sportsProviders/apiSportsProvider";

// Compute sport_trading_state from event data
function computeTradingState(event: any): "open" | "locked_by_sport" | "ended_by_sport" {
  const status = event.status;
  if (["finished", "cancelled", "postponed"].includes(status)) return "ended_by_sport";
  const endTime = event.end_time ? new Date(event.end_time).getTime() : NaN;
  const now = Date.now();
  if (Number.isFinite(endTime) && now >= endTime - 2 * 60_000) return "locked_by_sport";
  return "open";
}

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
      let change: { status: string; score: Record<string, unknown>; raw?: Record<string, unknown> | null; end_time?: string | null } | null = null;

      // Try API-Sports first if available and event has a real provider_event_id
      if (isApiSportsAvailable() && event.provider_event_id && !event.provider_event_id.startsWith("mock_") && !event.provider_event_id.startsWith("manual_")) {
        const apiResult = await fetchEvent(event.provider_event_id, event.sport);
        if (apiResult) {
          change = {
            status: apiResult.status,
            score: apiResult.score,
            raw: apiResult.raw,
            end_time: apiResult.end_time || event.end_time || null,
          };
        }
      }

      // Fallback to legacy mock provider
      if (!change) {
        const provider = getProvider();
        const legacyChange = await provider.updateEvent(event);
        if (legacyChange) {
          change = {
            status: legacyChange.status,
            score: legacyChange.score,
            raw: legacyChange.raw !== undefined ? legacyChange.raw : undefined,
          };
        }
      }

      if (change) {
        const patch: Record<string, unknown> = {
          status: change.status,
          score: change.score,
          last_update: new Date().toISOString(),
        };
        if (change.raw !== undefined) patch.raw = change.raw;
        if (change.end_time) patch.end_time = change.end_time;

        await supabase.from("sport_events").update(patch).eq("id", sportEventId);

        // Update sport_trading_state on linked markets
        const updatedEvent = { ...event, ...patch };
        const tradingState = computeTradingState(updatedEvent);

        await supabase
          .from("markets")
          .update({ sport_trading_state: tradingState })
          .eq("sport_event_id", sportEventId)
          .in("market_mode", ["sport", "sport_live"]);

        // Re-fetch updated row
        const { data: updated } = await supabase
          .from("sport_events")
          .select("*")
          .eq("id", sportEventId)
          .maybeSingle();

        const returnEvent = updated || event;
        return NextResponse.json({
          ok: true,
          event: returnEvent,
          trading_state: computeTradingState(returnEvent),
        });
      }
    }

    // Public / no change: return cached row with computed lock state
    return NextResponse.json({
      ok: true,
      event,
      trading_state: computeTradingState(event),
    });
  } catch (e: any) {
    console.error("sports/refresh-one crash:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
