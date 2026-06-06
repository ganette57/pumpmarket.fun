// app/src/app/world-cup/_lib/getWorldCupGroups.ts
// Server-only resolver for World Cup group standings.
//
// Source order (first reliable one wins):
//   1. Official TheSportsDB standings table (premium key) — real group names.
//   2. Derived from the full-season fixtures (group-stage rounds) when the
//      table is incomplete (e.g. free key caps the table at 5 rows).
//   3. null → page falls back to the built-in mock GROUPS.
//
// Never throws.

import "server-only";

import {
  fetchWorldCupTableTheSportsDB,
  listWorldCupSeasonMatchesTheSportsDB,
  type WorldCupTableRow,
} from "@/lib/sportsProviders/theSportsDbProvider";

import type { GroupStanding, GroupRow } from "../_components/mockData";

const WORLD_CUP_SEASON = "2026";
const MIN_GROUPS = 8; // accept real data only if we get a full-ish group set
const GROUP_SIZE = 4;
const GROUP_STAGE_ROUNDS = new Set(["1", "2", "3"]);

export type GroupsSource = "official" | "derived" | "mock";

export type WorldCupGroups = {
  source: GroupsSource;
  /** Real groups when source is "official"/"derived"; null when "mock". */
  groups: GroupStanding[] | null;
};

export async function getWorldCupGroups(): Promise<WorldCupGroups> {
  // 1. Official standings table (premium key).
  try {
    const official = await fromOfficialTable();
    if (official) return { source: "official", groups: official };
  } catch {
    /* helper never throws; belt-and-braces */
  }

  // 2. Derive from season fixtures.
  try {
    const derived = await fromFixtures();
    if (derived) return { source: "derived", groups: derived };
  } catch {
    /* ignore */
  }

  // 3. Mock fallback (handled by the page).
  return { source: "mock", groups: null };
}

// ---------------------------------------------------------------------------
// 1. Official standings table
// ---------------------------------------------------------------------------

async function fromOfficialTable(): Promise<GroupStanding[] | null> {
  const rows = await fetchWorldCupTableTheSportsDB({ season: WORLD_CUP_SEASON });
  if (rows.length <= 5) return null; // free-key cap / placeholder

  // Bucket rows by their group label (strDescription).
  const byGroup = new Map<string, WorldCupTableRow[]>();
  for (const r of rows) {
    const label = (r.group || "").trim();
    if (!label) return null; // no real group labels → reject, try derivation
    if (/playoff/i.test(label)) continue; // skip non-group buckets
    const list = byGroup.get(label) ?? [];
    list.push(r);
    byGroup.set(label, list);
  }

  if (byGroup.size < MIN_GROUPS) return null;

  const groups: GroupStanding[] = Array.from(byGroup.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([name, list]) => ({
      name,
      rows: list
        .slice()
        .sort(sortByRankThenPoints)
        .map(officialRowToGroupRow),
    }));

  return groups;
}

function sortByRankThenPoints(a: WorldCupTableRow, b: WorldCupTableRow): number {
  if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
  if (a.points !== b.points) return b.points - a.points;
  return b.goalDifference - a.goalDifference;
}

function officialRowToGroupRow(r: WorldCupTableRow): GroupRow {
  return {
    team: { name: r.team, badge: r.badge },
    played: r.played,
    win: r.win,
    draw: r.draw,
    loss: r.loss,
    gd: r.goalDifference,
    points: r.points,
  };
}

// ---------------------------------------------------------------------------
// 2. Derive groups + standings from fixtures
// ---------------------------------------------------------------------------

type Tally = {
  name: string;
  badge: string | null;
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  points: number;
};

async function fromFixtures(): Promise<GroupStanding[] | null> {
  const matches = await listWorldCupSeasonMatchesTheSportsDB({
    season: WORLD_CUP_SEASON,
  });

  // Group-stage fixtures only (matchdays 1-3).
  const groupStage = matches.filter((m) => {
    const round = String((m.raw as Record<string, unknown>)?.round ?? "");
    return GROUP_STAGE_ROUNDS.has(round);
  });
  if (groupStage.length === 0) return null;

  // Union-find over teams that meet in the group stage.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    parent.set(find(a), find(b));
  };

  const badges = new Map<string, string | null>();
  for (const m of groupStage) {
    const raw = (m.raw || {}) as Record<string, unknown>;
    if (!badges.has(m.home_team))
      badges.set(m.home_team, (raw.home_badge as string) ?? null);
    if (!badges.has(m.away_team))
      badges.set(m.away_team, (raw.away_badge as string) ?? null);
    union(m.home_team, m.away_team);
  }

  // Collect components.
  const components = new Map<string, Set<string>>();
  for (const team of Array.from(parent.keys())) {
    const root = find(team);
    const set = components.get(root) ?? new Set<string>();
    set.add(team);
    components.set(root, set);
  }

  // Keep only well-formed groups of GROUP_SIZE.
  const validComponents = Array.from(components.values()).filter(
    (s) => s.size === GROUP_SIZE,
  );
  if (validComponents.length < MIN_GROUPS) return null;

  // Tally standings from finished matches.
  const tallies = new Map<string, Tally>();
  const tallyOf = (team: string): Tally => {
    let t = tallies.get(team);
    if (!t) {
      t = {
        name: team,
        badge: badges.get(team) ?? null,
        played: 0,
        win: 0,
        draw: 0,
        loss: 0,
        gf: 0,
        ga: 0,
        points: 0,
      };
      tallies.set(team, t);
    }
    return t;
  };

  for (const m of groupStage) {
    if (m.status !== "finished") continue;
    const raw = (m.raw || {}) as Record<string, unknown>;
    const hs = raw.home_score;
    const as = raw.away_score;
    if (typeof hs !== "number" || typeof as !== "number") continue;

    const home = tallyOf(m.home_team);
    const away = tallyOf(m.away_team);
    home.played++;
    away.played++;
    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;
    if (hs > as) {
      home.win++;
      home.points += 3;
      away.loss++;
    } else if (hs < as) {
      away.win++;
      away.points += 3;
      home.loss++;
    } else {
      home.draw++;
      away.draw++;
      home.points += 1;
      away.points += 1;
    }
  }

  // Order groups by their earliest kickoff so labels are stable, then assign
  // positional letters (A, B, C…). These are inferred — official names come
  // from the table path above when the premium key is active.
  const componentFirstKickoff = (teams: Set<string>): number => {
    let min = Infinity;
    for (const m of groupStage) {
      if (teams.has(m.home_team)) {
        const t = new Date(m.start_time).getTime();
        if (Number.isFinite(t) && t < min) min = t;
      }
    }
    return min;
  };

  const ordered = validComponents
    .map((teams) => ({ teams, first: componentFirstKickoff(teams) }))
    .sort((a, b) => a.first - b.first);

  const groups: GroupStanding[] = ordered.map(({ teams }, i) => {
    const rows: GroupRow[] = Array.from(teams)
      .map((team) => tallyOf(team))
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.gf - b.ga - (a.gf - a.ga) ||
          b.gf - a.gf ||
          a.name.localeCompare(b.name),
      )
      .map((t) => ({
        team: { name: t.name, badge: t.badge },
        played: t.played,
        win: t.win,
        draw: t.draw,
        loss: t.loss,
        gd: t.gf - t.ga,
        points: t.points,
      }));
    return { name: `Group ${String.fromCharCode(65 + i)}`, rows };
  });

  return groups;
}
