import "server-only";

import { fetchEvent } from "@/lib/sportsProviders/apiSportsProvider";
import { fetchLiveScore } from "@/lib/sportsProviders/theSportsDbProvider";

export type SnapshotStatus = "scheduled" | "live" | "finished" | "unknown";

export type SoccerScoreSnapshot = {
  providerName: string;
  providerMatchId: string;
  status: SnapshotStatus;
  homeScore: number;
  awayScore: number;
  homeTeam: string | null;
  awayTeam: string | null;
  payload: Record<string, unknown>;
};

function toInt(x: unknown, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function normalizeProviderName(input: string): string {
  const p = String(input || "").trim().toLowerCase();
  if (!p) return "api-football";

  if (p === "api_football" || p === "api-football" || p === "api_sports" || p === "api-sports") {
    return "api-football";
  }
  if (p === "thesportsdb" || p === "the-sports-db") return "thesportsdb";
  return p;
}

function normalizeStatus(input: string): SnapshotStatus {
  const s = String(input || "").trim().toLowerCase();
  if (s === "scheduled" || s === "live" || s === "finished") return s;
  return "unknown";
}

function normalizeApiFootballShortStatus(short: unknown): SnapshotStatus {
  const s = String(short || "").trim().toUpperCase();
  if (!s || s === "NS" || s === "TBD" || s === "PST") return "scheduled";
  if (s === "FT" || s === "AET" || s === "PEN" || s === "AWD" || s === "WO" || s === "CANC" || s === "ABD") {
    return "finished";
  }
  if (
    s === "1H" ||
    s === "HT" ||
    s === "2H" ||
    s === "ET" ||
    s === "BT" ||
    s === "P" ||
    s === "INT" ||
    s === "LIVE" ||
    s === "SUSP"
  ) {
    return "live";
  }
  return "unknown";
}

async function fetchSoccerSnapshotFromApiFootballV3(providerMatchId: string): Promise<SoccerScoreSnapshot | null> {
  const key = String(process.env.APISPORTS_KEY || "").trim();
  if (!key) return null;

  const url = `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(providerMatchId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": key,
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  const fixture = Array.isArray(json?.response) ? json.response[0] : null;
  if (!fixture) return null;

  const homeScore = toInt(fixture?.goals?.home, 0);
  const awayScore = toInt(fixture?.goals?.away, 0);
  const status = normalizeApiFootballShortStatus(fixture?.fixture?.status?.short);

  return {
    providerName: "api-football",
    providerMatchId,
    status,
    homeScore,
    awayScore,
    homeTeam: fixture?.teams?.home?.name || null,
    awayTeam: fixture?.teams?.away?.name || null,
    payload: {
      source: "api-football-v3",
      fixture,
    },
  };
}

export async function fetchSoccerSnapshot(params: {
  providerName: string;
  providerMatchId: string;
}): Promise<SoccerScoreSnapshot> {
  const provider = normalizeProviderName(params.providerName);
  const providerMatchId = String(params.providerMatchId || "").trim();
  if (!providerMatchId) throw new Error("providerMatchId is required");

  if (provider === "api-football") {
    try {
      const event = await fetchEvent(providerMatchId, "soccer");
      if (event) {
        const home = toInt((event.score as any)?.home, 0);
        const away = toInt((event.score as any)?.away, 0);

        return {
          providerName: provider,
          providerMatchId,
          status: normalizeStatus(event.status),
          homeScore: home,
          awayScore: away,
          homeTeam: event.home_team || null,
          awayTeam: event.away_team || null,
          payload: {
            source: "apiSportsProvider.fetchEvent",
            event,
          },
        };
      }
    } catch {
      // Fallback below
    }

    const v3 = await fetchSoccerSnapshotFromApiFootballV3(providerMatchId);
    if (v3) return v3;

    throw new Error(
      `No API-Football snapshot found for provider_match_id=${providerMatchId} (checked RAPIDAPI + APISPORTS)`,
    );
  }

  if (provider === "thesportsdb") {
    const live = await fetchLiveScore(providerMatchId);
    return {
      providerName: provider,
      providerMatchId,
      status: normalizeStatus(live.status),
      homeScore: toInt(live.home_score, 0),
      awayScore: toInt(live.away_score, 0),
      homeTeam: live.home_team || null,
      awayTeam: live.away_team || null,
      payload: {
        source: "theSportsDbProvider.fetchLiveScore",
        live,
      },
    };
  }

  throw new Error(`Unsupported provider for soccer live micro-market: ${provider}`);
}
