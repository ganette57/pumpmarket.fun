// app/src/app/world-cup/_components/MatchRails.tsx
"use client";

import { Clock } from "lucide-react";
import type { LiveMatch, UpcomingMatch, MatchOutcome, Team } from "./mockData";

/**
 * World Cup match cards — styled to match the homepage market cards:
 * dark card (bg-[#05070b]), gray border with green hover, sport/status pills,
 * team crests, and large FunMarket green/pink outcome buttons.
 */

const SPORT_BADGE =
  "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/80 border border-gray-700 text-gray-200";

const CARD_SHELL =
  "min-w-[300px] max-w-[320px] flex-shrink-0 rounded-xl overflow-hidden border border-gray-800 bg-[#05070b] transition-all hover:border-pump-green hover:shadow-xl";

// ---------------------------------------------------------------------------
// Live card — keeps score emphasis, FunMarket card shell + outcome buttons.
// ---------------------------------------------------------------------------

export function LiveMatchCard({ m }: { m: LiveMatch }) {
  return (
    <article className={CARD_SHELL}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className={SPORT_BADGE}>Soccer</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            Live {m.minute}
          </span>
        </div>

        {/* Crests + score */}
        <div className="flex items-center justify-center gap-3">
          <Crest team={m.home} />
          <span className="px-1 text-2xl font-extrabold tabular-nums text-white">
            {m.scoreHome}–{m.scoreAway}
          </span>
          <Crest team={m.away} />
        </div>

        <h3 className="line-clamp-2 text-center text-[15px] font-semibold leading-tight text-white">
          {m.home.name} vs {m.away.name}
        </h3>

        <div className="text-center text-[11px] uppercase tracking-wide text-gray-400">
          {m.group}
        </div>

        <OutcomeButtons outcomes={m.outcomes} />

        <div className="flex items-center justify-between border-t border-gray-800 pt-2 text-[11px] text-gray-400">
          <span>{m.markets} markets</span>
          <span className="font-semibold text-pump-green">Trade →</span>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Upcoming card — homepage-market-card feel with outcome buttons.
// ---------------------------------------------------------------------------

export function UpcomingMatchCard({ m }: { m: UpcomingMatch }) {
  return (
    <article className={CARD_SHELL}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className={SPORT_BADGE}>Soccer</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-pump-green/30 bg-pump-green/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-pump-green">
            Upcoming
          </span>
        </div>

        {/* Crests */}
        <div className="flex items-center justify-center gap-3">
          <Crest team={m.home} />
          <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
            vs
          </span>
          <Crest team={m.away} />
        </div>

        <h3 className="line-clamp-2 text-center text-[15px] font-semibold leading-tight text-white">
          {m.home.name} vs {m.away.name}
        </h3>

        <div className="flex items-center justify-center gap-2 text-[11px] text-gray-400">
          <span className="uppercase tracking-wide">{m.group}</span>
          <span className="opacity-40">•</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {m.kickoff}
          </span>
        </div>

        <OutcomeButtons outcomes={m.outcomes} />

        <div className="flex items-center justify-between border-t border-gray-800 pt-2 text-[11px] text-gray-400">
          <span>{m.markets} markets</span>
          <span className="font-semibold text-pump-green">Open →</span>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Abbreviate long team names so outcome buttons stay readable. */
function abbrev(label: string): string {
  const s = label.trim();
  if (s.length <= 9) return s;
  return s.slice(0, 8) + "…";
}

/**
 * Outcome buttons in FunMarket style: first = green, last = pink, any middle
 * outcome (e.g. "Draw" in a 3-way) = neutral slate. Works for 2 or 3 outcomes.
 */
function OutcomeButtons({ outcomes }: { outcomes: MatchOutcome[] }) {
  const colorFor = (i: number) => {
    if (i === 0) return "bg-[#00FF87] text-black";
    if (i === outcomes.length - 1) return "bg-[#ff5c73] text-black";
    return "bg-gray-700 text-white";
  };
  return (
    <div className="flex gap-2">
      {outcomes.map((o, i) => (
        <div
          key={`${o.label}-${i}`}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg p-2 text-center ${colorFor(
            i,
          )}`}
        >
          <span className="max-w-full truncate text-[10px] font-bold uppercase tracking-wide">
            {abbrev(o.label)}
          </span>
          <span className="text-[17px] font-bold md:text-[19px]">{o.pct}%</span>
        </div>
      ))}
    </div>
  );
}

/** Team crest: real badge → emoji flag → neutral placeholder. */
function Crest({ team }: { team: Team }) {
  if (team.badge) {
    return (
      <img
        src={team.badge}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded-full bg-black/40 object-contain p-0.5"
      />
    );
  }
  if (team.flag) {
    return (
      <span className="text-3xl leading-none" aria-hidden="true">
        {team.flag}
      </span>
    );
  }
  return (
    <div className="h-10 w-10 shrink-0 rounded-full border border-gray-700 bg-gray-800" />
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function HorizontalRail({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ scrollbarWidth: "thin" }}
    >
      {children}
    </div>
  );
}

/** Compact empty state shown when there are no live World Cup matches. */
export function LiveEmptyState() {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#05070b] px-4 py-5 text-sm text-gray-400">
      No live World Cup matches right now.
    </div>
  );
}
