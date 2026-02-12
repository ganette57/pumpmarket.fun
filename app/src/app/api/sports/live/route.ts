// GET /api/sports/live?provider=thesportsdb&event_id=ID
// Returns live score data for a single event.
// Server-only. Never throws — returns status "unknown" on error.

import { NextRequest, NextResponse } from "next/server";
import { fetchLiveScore } from "@/lib/sportsProviders/theSportsDbProvider";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const provider = searchParams.get("provider");
  const eventId = searchParams.get("event_id");

  if (!provider || !eventId) {
    return NextResponse.json(
      { error: "Missing required params: provider, event_id" },
      { status: 400 },
    );
  }

  if (provider !== "thesportsdb") {
    return NextResponse.json(
      { error: `Unsupported provider: ${provider}. Supported: thesportsdb` },
      { status: 400 },
    );
  }

  try {
    const result = await fetchLiveScore(eventId);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({
      provider: "thesportsdb",
      provider_event_id: eventId,
      status: "unknown",
      home_team: "",
      away_team: "",
      home_score: null,
      away_score: null,
      minute: null,
      start_time: null,
      league: null,
      raw: {},
    });
  }
}
