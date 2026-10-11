// GET /api/sports/live?provider=thesportsdb&event_id=ID&sport=basketball
// Returns live score data for a single event.
// NBA/basketball now uses TheSportsDB, same as other sports.
// Server-only. Never throws — returns status "unknown" on error.

import { NextRequest, NextResponse } from "next/server";
import { findApiFootballLiveMinute } from "@/lib/sportsProviders/fixturesProvider";
import {
  fetchLiveScore,
  fetchNflLiveProgress,
} from "@/lib/sportsProviders/theSportsDbProvider";

const NO_STORE = { "Cache-Control": "no-store" };

function normalizeProvider(input: string | null, sport: string): "thesportsdb" | "" {
  const p = String(input || "").trim().toLowerCase();
  if (p === "thesportsdb" || p === "the-sports-db") return "thesportsdb";

  // Backward compatibility: old NBA calls may still send api-nba.
  if (p === "api-nba") return "thesportsdb";

  // If no provider is passed but a sport is known, default to TheSportsDB.
  if (!p && sport) return "thesportsdb";
  return "";
}

function authoritativeTheSportsDbMinute(result: Awaited<ReturnType<typeof fetchLiveScore>>): number | null {
  if (typeof result.minute === "number" && Number.isFinite(result.minute) && result.minute >= 0) {
    return Math.floor(result.minute);
  }

  const progress = (result.raw as Record<string, unknown> | null)?.progress;
  if (typeof progress === "number" && Number.isFinite(progress) && progress >= 0) {
    return Math.floor(progress);
  }
  if (typeof progress === "string") {
    const match = progress.trim().match(/^(\d{1,3})(?:\s*(?:'|min(?:ute)?s?|:.*))?$/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function nflV2Status(
  statusText: string | null,
  progress: string | null,
  fallback: Awaited<ReturnType<typeof fetchLiveScore>>["status"],
): Awaited<ReturnType<typeof fetchLiveScore>>["status"] {
  const status = String(statusText || "").trim();
  const detail = String(progress || "").trim();
  if (/^(?:ft|final|game finished)$/i.test(status) || /^(?:ft|final|game finished)$/i.test(detail)) {
    return "finished";
  }
  if (/^(?:ns|scheduled|not started)$/i.test(status)) return "scheduled";
  if (
    /^(?:q[1-4]|ht|half[ -]?time|ot|overtime)$/i.test(status) ||
    /^\d{1,2}:[0-5]\d\s*-\s*(?:1st|2nd|3rd|4th)$/i.test(detail) ||
    /^\d{1,2}:[0-5]\d\s*-\s*(?:ot|overtime)$/i.test(detail) ||
    /^(?:ot|overtime)$/i.test(detail)
  ) {
    return "live";
  }
  return fallback;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const eventId = String(searchParams.get("event_id") || "").trim();
  const sport = String(searchParams.get("sport") || "").trim().toLowerCase();
  const officialLinked = searchParams.get("scope") === "official";
  const provider = normalizeProvider(searchParams.get("provider"), sport);

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing required param: event_id" },
      { status: 400 },
    );
  }

  if (!provider) {
    return NextResponse.json(
      { error: "Missing required param: provider (or sport for auto-routing)" },
      { status: 400 },
    );
  }

  try {
    const result = await fetchLiveScore(eventId);
    const primaryMinute = authoritativeTheSportsDbMinute(result);
    if (primaryMinute != null) result.minute = primaryMinute;

    if (officialLinked && (sport === "american_football" || sport === "nfl")) {
      const nflLive = await fetchNflLiveProgress(eventId);
      if (nflLive) {
        if (nflLive.home_score != null) result.home_score = nflLive.home_score;
        if (nflLive.away_score != null) result.away_score = nflLive.away_score;
        result.status = nflV2Status(nflLive.status_text, nflLive.progress, result.status);
        result.raw = {
          ...result.raw,
          nfl_v2_status: nflLive.status_text,
          nfl_v2_progress: nflLive.progress,
          nfl_v2_updated: nflLive.updated,
        };
      }
    }

    if (
      officialLinked &&
      (sport === "soccer" || sport === "football") &&
      result.status === "live" &&
      primaryMinute == null &&
      result.home_team &&
      result.away_team &&
      result.start_time
    ) {
      try {
        const fallback = await findApiFootballLiveMinute({
          homeTeam: result.home_team,
          awayTeam: result.away_team,
          league: result.league,
          startTime: result.start_time,
        });
        if (fallback) {
          result.minute = fallback.elapsed;
          result.raw = {
            ...result.raw,
            minute_source: "api-football",
            api_football_fixture_id: fallback.fixtureId,
            api_football_status: fallback.statusShort,
          };
        }
      } catch {
        // TheSportsDB result remains authoritative and usable without a minute.
      }
    }
    return NextResponse.json(result, { headers: NO_STORE });
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
