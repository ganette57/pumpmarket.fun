// app/src/app/world-cup/page.tsx
//
// Server component: fetches real World Cup fixtures (TheSportsDB league 4429,
// full 2026 season) via the existing provider stack. Upcoming Matches is wired
// to real data; Live Matches shows real live games only (hidden when none).
// Groups, Side Markets, Leaderboard, and Treasury remain mock previews.
//
// Section order: Hero → (Live) → Upcoming → Side Markets → Groups →
// Leaderboard → Treasury. Match/market rows (Live, Upcoming, Side Markets)
// use the shared HorizontalRail. Flash Markets and Knockout Stage are
// intentionally not rendered on the overview yet (their components/data kept).

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import HubHero from "./_components/HubHero";
import HubSection from "./_components/HubSection";
import {
  HorizontalRail,
  LiveMatchCard,
} from "./_components/MatchRails";
import { SideMarketRowCard } from "./_components/MarketsBlocks";
import LeaderboardPreview from "./_components/LeaderboardPreview";
import GroupsGrid from "./_components/GroupsTable";
import TreasuryPreview from "./_components/TreasuryPreview";
import MarketCard from "@/components/MarketCard";
import WorldCupMatchMarketCard from "./_components/WorldCupMatchMarketCard";
import { SIDE_MARKETS, GROUPS } from "./_components/mockData";
import { getWorldCupFixtures } from "./_lib/getWorldCupFixtures";
import { getWorldCupGroups } from "./_lib/getWorldCupGroups";
import {
  getWorldCupMatchMarkets,
  getWorldCupSideMarkets,
} from "./_lib/marketQueries";

// Render fresh on every request so newly-created official match markets and
// side markets appear immediately (the TheSportsDB provider keeps its own
// in-memory cache, so this does not hammer the provider).
export const dynamic = "force-dynamic";

/**
 * World Cup Hub overview.
 * Layout reuses FunMarket's dark theme + neon-green accents; gold (#EAB54C)
 * is reserved for championship-coded elements.
 */
export default async function WorldCupHubPage() {
  const [{ liveMatches }, groupsResult, matchMarkets, sideMarkets] =
    await Promise.all([
      getWorldCupFixtures(),
      getWorldCupGroups(),
      getWorldCupMatchMarkets(12),
      getWorldCupSideMarkets(12),
    ]);

  // Live: real live matches only — never mock, never fake. Section is hidden
  // entirely when there are none.
  const live = liveMatches;

  // Groups: official standings → fixture-derived → mock.
  const groups = groupsResult.groups ?? GROUPS;
  const groupsSubtitle =
    groupsResult.source === "official"
      ? "Live group standings"
      : groupsResult.source === "derived"
        ? "Group standings from World Cup fixtures"
        : "Group standings — mock data for now";

  return (
    <div className="min-h-screen bg-pump-dark text-white">
      {/* 1. Championship Hero */}
      <HubHero />

      {/* 2. Live Matches — only rendered when there are real live matches. */}
      {live.length > 0 && (
        <HubSection title="Live Matches" subtitle="Live World Cup action">
          <HorizontalRail>
            {live.map((m) => (
              <LiveMatchCard key={m.id} m={m} />
            ))}
          </HorizontalRail>
        </HubSection>
      )}

      {/* 3. Upcoming Matches — official admin-created match markets only
          (sourced from the markets table, not raw provider fixtures). */}
      <HubSection
        title="Upcoming Matches"
        subtitle="Official World Cup match markets"
        action={
          <Link
            href="/world-cup/matches"
            className="inline-flex items-center gap-1 text-xs font-semibold text-pump-green hover:underline"
          >
            View all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {matchMarkets.length > 0 ? (
          <HorizontalRail>
            {matchMarkets.map((m) => (
              <div
                key={m.publicKey}
                className="min-w-[300px] max-w-[320px] flex-shrink-0"
              >
                <WorldCupMatchMarketCard market={m} />
              </div>
            ))}
          </HorizontalRail>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-[#05070b] px-4 py-6 text-sm text-gray-400">
            No official World Cup match markets yet.
          </div>
        )}
      </HubSection>

      {/* 4. Side Markets — horizontal rail like Upcoming. Real user-created
          soccer side markets, else mock fallback. */}
      <HubSection
        title="Side Markets"
        subtitle={
          sideMarkets.length > 0
            ? "User-created soccer side markets."
            : "Classic match markets."
        }
        action={
          <Link
            href="/world-cup/side-markets"
            className="inline-flex items-center gap-1 text-xs font-semibold text-pump-green hover:underline"
          >
            View all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <HorizontalRail>
          {sideMarkets.length > 0
            ? sideMarkets.map((m) => (
                <div
                  key={m.publicKey}
                  className="min-w-[300px] max-w-[320px] flex-shrink-0"
                >
                  <MarketCard market={m} />
                </div>
              ))
            : SIDE_MARKETS.map((m) => (
                <div
                  key={m.id}
                  className="min-w-[300px] max-w-[320px] flex-shrink-0"
                >
                  <SideMarketRowCard m={m} />
                </div>
              ))}
        </HorizontalRail>
      </HubSection>

      {/* 5. Groups */}
      <HubSection title="Groups" subtitle={groupsSubtitle}>
        <GroupsGrid groups={groups} />
      </HubSection>

      {/* 6. Championship Leaderboard Preview */}
      <HubSection
        title="Championship Leaderboard"
        subtitle="Top 5 traders — preview only."
        action={
          <Link
            href="/world-cup/leaderboard"
            className="inline-flex h-9 items-center justify-center rounded-full border border-gray-700 bg-pump-gray px-4 text-xs font-semibold text-white transition hover:border-pump-green hover:text-pump-green"
          >
            View Leaderboard
          </Link>
        }
      >
        <LeaderboardPreview />
      </HubSection>

      {/* 7. Treasury Preview */}
      <HubSection
        title="Treasury"
        subtitle="Championship treasury — preview only."
        action={
          <Link
            href="/world-cup/treasury"
            className="inline-flex h-9 items-center justify-center rounded-full border border-gray-700 bg-pump-gray px-4 text-xs font-semibold text-white transition hover:border-pump-green hover:text-pump-green"
          >
            View Treasury
          </Link>
        }
      >
        <TreasuryPreview />
      </HubSection>

      {/* Bottom spacer so the last section breathes above the mobile bottom nav. */}
      <div className="h-16 md:h-12" />
    </div>
  );
}
