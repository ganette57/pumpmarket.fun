// GET /api/sports/event-details?event_id=ID
// Returns detailed event data from TheSportsDB: lineups, statistics, timeline.
// Uses dedicated endpoints: lookupeventstats, lookuptimeline, lookuplineup.
// Used by the SoccerMatchDrawer on the trade page. Never throws.

import { NextRequest, NextResponse } from "next/server";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function getKey(): string {
  return process.env.THESPORTSDB_KEY || "3";
}

function v1Url(endpoint: string): string {
  return `https://www.thesportsdb.com/api/v1/json/${getKey()}/${endpoint}`;
}

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerEntry = { name: string; position: string };
type StatEntry = { label: string; home: string; away: string };
type GoalEntry = { player: string; minute: string; cutout?: string };
type TimelineEntry = {
  type: string;
  detail: string;
  player: string;
  team: string;
  isHome: boolean;
  minute: number;
  cutout?: string;
  assist?: string;
};

// ---------------------------------------------------------------------------
// Lineup from lookuplineup.php
// ---------------------------------------------------------------------------

function parseLineupResponse(data: any): {
  home: { starters: PlayerEntry[]; substitutes: PlayerEntry[] };
  away: { starters: PlayerEntry[]; substitutes: PlayerEntry[] };
} {
  const empty = { starters: [] as PlayerEntry[], substitutes: [] as PlayerEntry[] };
  const lineup = data?.lineup;
  if (!lineup || !Array.isArray(lineup)) return { home: { ...empty }, away: { ...empty } };

  const homeStarters: PlayerEntry[] = [];
  const homeSubs: PlayerEntry[] = [];
  const awayStarters: PlayerEntry[] = [];
  const awaySubs: PlayerEntry[] = [];

  for (const p of lineup) {
    const name = p.strPlayer || "";
    const pos = p.strPosition || "";
    const isSub = (p.strSubstitute || "").toLowerCase() === "yes";
    const isHome = (p.strHome || "").toLowerCase() === "yes";

    const entry: PlayerEntry = { name, position: pos };
    if (isHome) {
      (isSub ? homeSubs : homeStarters).push(entry);
    } else {
      (isSub ? awaySubs : awayStarters).push(entry);
    }
  }

  return {
    home: { starters: homeStarters, substitutes: homeSubs },
    away: { starters: awayStarters, substitutes: awaySubs },
  };
}

// ---------------------------------------------------------------------------
// Lineup fallback from lookupevent.php inline fields
// ---------------------------------------------------------------------------

function parseLineupField(raw: string | null | undefined): PlayerEntry[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, position: "" }));
}

function buildInlineLineup(ev: any, side: "Home" | "Away") {
  const gk = parseLineupField(ev[`str${side}LineupGoalkeeper`]);
  const def = parseLineupField(ev[`str${side}LineupDefense`]);
  const mid = parseLineupField(ev[`str${side}LineupMidfield`]);
  const fwd = parseLineupField(ev[`str${side}LineupForward`]);
  const subs = parseLineupField(ev[`str${side}LineupSubstitutes`]);

  gk.forEach((p) => (p.position = "GK"));
  def.forEach((p) => (p.position = "DEF"));
  mid.forEach((p) => (p.position = "MID"));
  fwd.forEach((p) => (p.position = "FWD"));
  subs.forEach((p) => (p.position = "SUB"));

  return { starters: [...gk, ...def, ...mid, ...fwd], substitutes: subs };
}

// ---------------------------------------------------------------------------
// Statistics from lookupeventstats.php
// ---------------------------------------------------------------------------

function parseStatsResponse(data: any): StatEntry[] {
  const rawStats = data?.eventstats;
  if (!rawStats || !Array.isArray(rawStats)) return [];

  return rawStats
    .filter((s: any) => s.strStat && (s.intHome != null || s.intAway != null))
    .map((s: any) => {
      const label = String(s.strStat || "");
      let home = String(s.intHome ?? "0");
      let away = String(s.intAway ?? "0");
      // Add % suffix for possession
      if (label.toLowerCase().includes("possession") || label.toLowerCase().includes("passes %")) {
        if (!home.includes("%")) home += "%";
        if (!away.includes("%")) away += "%";
      }
      return { label, home, away };
    });
}

// ---------------------------------------------------------------------------
// Timeline from lookuptimeline.php (goals, cards, subs)
// ---------------------------------------------------------------------------

function parseTimelineResponse(data: any): {
  timeline: TimelineEntry[];
  homeGoals: GoalEntry[];
  awayGoals: GoalEntry[];
} {
  const raw = data?.timeline;
  if (!raw || !Array.isArray(raw)) {
    return { timeline: [], homeGoals: [], awayGoals: [] };
  }

  const timeline: TimelineEntry[] = [];
  const homeGoals: GoalEntry[] = [];
  const awayGoals: GoalEntry[] = [];

  for (const t of raw) {
    const entry: TimelineEntry = {
      type: t.strTimeline || "",
      detail: t.strTimelineDetail || "",
      player: t.strPlayer || "",
      team: t.strTeam || "",
      isHome: (t.strHome || "").toLowerCase() === "yes",
      minute: parseInt(t.intTime) || 0,
      cutout: t.strCutout || undefined,
      assist: t.strAssist || undefined,
    };
    timeline.push(entry);

    // Extract goals
    if (entry.type.toLowerCase() === "goal") {
      const goal: GoalEntry = {
        player: entry.player,
        minute: `${entry.minute}'`,
        cutout: entry.cutout,
      };
      if (entry.isHome) {
        homeGoals.push(goal);
      } else {
        awayGoals.push(goal);
      }
    }
  }

  return { timeline, homeGoals, awayGoals };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("event_id");

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing required param: event_id" },
      { status: 400 },
    );
  }

  try {
    // Fetch all data in parallel
    const [eventJson, statsJson, timelineJson, lineupJson] = await Promise.all([
      fetchJson(v1Url(`lookupevent.php?id=${eventId}`)),
      fetchJson(v1Url(`lookupeventstats.php?id=${eventId}`)),
      fetchJson(v1Url(`lookuptimeline.php?id=${eventId}`)),
      fetchJson(v1Url(`lookuplineup.php?id=${eventId}`)),
    ]);

    const ev = eventJson?.events?.[0];
    if (!ev) {
      return NextResponse.json(
        { available: false, message: "Event not found" },
        { headers: NO_STORE },
      );
    }

    // Parse stats
    const statistics = parseStatsResponse(statsJson);

    // Parse timeline (goals, cards)
    const { timeline, homeGoals, awayGoals } = parseTimelineResponse(timelineJson);

    // Parse lineups: try dedicated endpoint first, fall back to inline fields
    let lineups = parseLineupResponse(lineupJson);
    if (lineups.home.starters.length === 0 && lineups.away.starters.length === 0) {
      lineups = {
        home: buildInlineLineup(ev, "Home"),
        away: buildInlineLineup(ev, "Away"),
      };
    }

    const hasLineups = lineups.home.starters.length > 0 || lineups.away.starters.length > 0;
    const hasStats = statistics.length > 0;
    const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;
    const hasTimeline = timeline.length > 0;

    return NextResponse.json(
      {
        available: hasLineups || hasStats || hasGoals || hasTimeline,
        home_team: ev.strHomeTeam || "",
        away_team: ev.strAwayTeam || "",
        home_badge: ev.strHomeTeamBadge || null,
        away_badge: ev.strAwayTeamBadge || null,
        home_goals: homeGoals,
        away_goals: awayGoals,
        home_lineup: lineups.home,
        away_lineup: lineups.away,
        statistics,
        timeline,
        home_formation: ev.strHomeFormation || null,
        away_formation: ev.strAwayFormation || null,
      },
      { headers: NO_STORE },
    );
  } catch (err: any) {
    console.error("[event-details] error:", err?.message);
    return NextResponse.json(
      { available: false, error: "Failed to fetch event details" },
      { status: 500 },
    );
  }
}
