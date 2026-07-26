import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import LeaderboardByMode from "@/components/leaderboard/LeaderboardByMode";

// Leaderboard shell.
//
// The previous version of this page ranked wallets by Fun Points. Fun Points
// are no longer surfaced publicly, and no ranking that reflects real trading
// performance exists yet, so this page deliberately shows nothing rather than
// a ranking we cannot stand behind. The ranking queries are still in
// src/lib/leaderboard.ts, unused, for whatever replaces them.
//
// That paragraph still describes REAL MODE exactly, and RealLeaderboardShell
// below is that page verbatim. Play Mode does have a ranking it can stand
// behind — authoritative realized P&L on settled Play markets — so the client
// gate swaps in PlayLeaderboardView there. One route, two views, no reload.

export const metadata: Metadata = {
  title: "Leaderboard — FunMarket",
  description: "Trader rankings on FunMarket.",
};

export default function LeaderboardPage() {
  return <LeaderboardByMode real={<RealLeaderboardShell />} />;
}

/** The Real leaderboard, unchanged. Everything below this line is production. */
function RealLeaderboardShell() {
  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Hero */}
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10">
            <Trophy className="h-5 w-5 text-pump-green" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Leaderboard
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Trader rankings on FunMarket.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-pump-border bg-pump-gray px-5 py-12 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-pump-green/30 bg-pump-green/10">
            <Trophy className="h-6 w-6 text-pump-green" />
          </div>
          <h2 className="text-base font-semibold text-white">
            Rankings aren&apos;t live yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">
            We&apos;re rebuilding the leaderboard around real trading
            performance. Nothing to show until it&apos;s something we can stand
            behind.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-5 text-sm font-bold text-black transition hover:bg-pump-green/90"
          >
            Browse markets
          </Link>
        </section>
      </div>
    </div>
  );
}
