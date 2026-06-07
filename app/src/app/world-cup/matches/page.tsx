// app/src/app/world-cup/matches/page.tsx
// "View all" page for official World Cup match markets (admin/official flow).

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import WorldCupMarketsBrowser from "../_components/WorldCupMarketsBrowser";
import { getWorldCupMatchMarkets } from "../_lib/marketQueries";

// Fresh on every request so newly-created official match markets appear at once.
export const dynamic = "force-dynamic";

export default async function WorldCupMatchesPage() {
  const markets = await getWorldCupMatchMarkets();

  return (
    <div className="min-h-screen bg-pump-dark text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/world-cup"
          className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-white"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to World Cup
        </Link>

        <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
          World Cup Matches
        </h1>
        <p className="mt-1 mb-6 text-sm text-gray-400">
          Official World Cup match markets.
        </p>

        <WorldCupMarketsBrowser
          markets={markets}
          cardKind="match"
          emptyLabel="No official World Cup match markets yet."
        />
      </div>
    </div>
  );
}
