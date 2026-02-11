import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  isAvailable as isApiSportsAvailable,
  fetchEvent,
} from "@/lib/sportsProviders/apiSportsProvider";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const provider = String(body.provider || "manual").trim();
    const provider_event_id = String(body.provider_event_id || "").trim();
    const sport = String(body.sport || "").trim();
    const home_team = String(body.home_team || "").trim();
    const away_team = String(body.away_team || "").trim();
    const start_time = String(body.start_time || "").trim();
    const end_time = body.end_time ? String(body.end_time).trim() : null;
    const league = body.league ? String(body.league).trim() : null;

    if (!sport || !home_team || !away_team || !start_time) {
      return NextResponse.json(
        { error: "sport, home_team, away_team, and start_time are required" },
        { status: 400 },
      );
    }

    // If provider_event_id looks like an API-Sports ID, try to fetch enriched data
    let enriched: {
      status?: string;
      score?: Record<string, unknown>;
      raw?: Record<string, unknown>;
      league?: string | null;
      start_time?: string | null;
      end_time?: string | null;
    } | null = null;

    if (
      provider_event_id &&
      !provider_event_id.startsWith("mock_") &&
      !provider_event_id.startsWith("manual_") &&
      isApiSportsAvailable()
    ) {
      try {
        const apiResult = await fetchEvent(provider_event_id, sport);
        if (apiResult) {
          enriched = {
            status: apiResult.status,
            score: apiResult.score,
            raw: apiResult.raw,
            league: apiResult.league || league,
            start_time: apiResult.start_time || start_time,
            end_time: apiResult.end_time || end_time,
          };
        }
      } catch (e: any) {
        console.error("create-event enrichment error (continuing with basic data):", e?.message);
      }
    }

    const supabase = supabaseServer();

    const { data, error } = await supabase
      .from("sport_events")
      .insert({
        provider: enriched ? "api-sports" : provider,
        provider_event_id: provider_event_id || `manual_${Date.now()}`,
        sport,
        league: enriched?.league ?? league,
        home_team,
        away_team,
        start_time: enriched?.start_time ?? start_time,
        end_time: enriched?.end_time ?? end_time,
        status: enriched?.status ?? "scheduled",
        score: enriched?.score ?? {},
        raw: enriched?.raw ?? body.raw ?? null,
        last_update: enriched ? new Date().toISOString() : null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("create-event insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, event: data });
  } catch (e: any) {
    console.error("sports/create-event crash:", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
