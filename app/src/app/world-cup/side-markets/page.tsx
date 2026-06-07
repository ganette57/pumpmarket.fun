// app/src/app/world-cup/side-markets/page.tsx
// "View all" page for user-created soccer side markets.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import WorldCupMarketsBrowser from "../_components/WorldCupMarketsBrowser";
import { getWorldCupSideMarkets } from "../_lib/marketQueries";

// Fresh on every request so newly-created side markets appear at once.
export const dynamic = "force-dynamic";

export default async function WorldCupSideMarketsPage() {
  const markets = await getWorldCupSideMarkets();

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
          Side Markets
        </h1>
        <p className="mt-1 mb-6 text-sm text-gray-400">
          User-created soccer side markets. Filter by team to find all markets
          for your favourite nation.
        </p>

        <WorldCupMarketsBrowser
          markets={markets}
          emptyLabel="No soccer side markets yet."
        />
      </div>
    </div>
  );
}
