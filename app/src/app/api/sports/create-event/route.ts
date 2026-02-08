import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

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

    const supabase = supabaseServer();

    const { data, error } = await supabase
      .from("sport_events")
      .insert({
        provider,
        provider_event_id: provider_event_id || `manual_${Date.now()}`,
        sport,
        league,
        home_team,
        away_team,
        start_time,
        end_time,
        status: "scheduled",
        score: {},
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
