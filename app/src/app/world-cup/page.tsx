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
  UpcomingMatchCard,
} from "./_components/MatchRails";
import { SideMarketRowCard } from "./_components/MarketsBlocks";
import LeaderboardPreview from "./_components/LeaderboardPreview";
import GroupsGrid from "./_components/GroupsTable";
import TreasuryPreview from "./_components/TreasuryPreview";
import MarketCard from "@/components/MarketCard";
import {
  UPCOMING_MATCHES,
  SIDE_MARKETS,
  GROUPS,
} from "./_components/mockData";
import { getWorldCupFixtures } from "./_lib/getWorldCupFixtures";
import { getWorldCupGroups } from "./_lib/getWorldCupGroups";
import { getWorldCupSideMarkets } from "./_lib/getWorldCupSideMarkets";

// Re-fetch at most every 5 minutes (route-level cache); the provider stack
// already has its own 15 min cache, so this is a cheap upper bound.
export const revalidate = 300;

/**
 * World Cup Hub overview.
 * Layout reuses FunMarket's dark theme + neon-green accents; gold (#EAB54C)
 * is reserved for championship-coded elements.
 */
export default async function WorldCupHubPage() {
  const [{ hasRealFixtures, liveMatches, upcomingMatches }, groupsResult, sideMarkets] =
    await Promise.all([
      getWorldCupFixtures(),
      getWorldCupGroups(),
      getWorldCupSideMarkets(),
    ]);

  // Live: real live matches only — never mock, never fake. Section is hidden
  // entirely when there are none.
  const live = liveMatches;

  // Upcoming: real fixtures when available; mock fallback only when the
  // provider returned zero World Cup fixtures.
  const upcoming = hasRealFixtures ? upcomingMatches : UPCOMING_MATCHES;

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

      {/* 3. Upcoming Matches */}
      <HubSection
        title="Upcoming Matches"
        subtitle="Next World Cup fixtures"
        action={
          <Link
            href="#"
            className="inline-flex items-center gap-1 text-xs font-semibold text-pump-green hover:underline"
            aria-disabled
          >
            View all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <HorizontalRail>
          {upcoming.map((m) => (
            <UpcomingMatchCard key={m.id} m={m} />
          ))}
        </HorizontalRail>
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
