"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Trophy, Crown, Medal, Flame, Users, Sparkles } from "lucide-react";
import {
  displayNameForRow,
  getLeaderboard,
  getLeaderboardStats,
  getUserRank,
  shortWallet,
  type LeaderboardRow,
  type LeaderboardStats,
  type UserRank,
} from "@/lib/leaderboard";
import { formatPoints } from "@/lib/funPoints";

export default function LeaderboardPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [userRank, setUserRank] = useState<UserRank | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, u] = await Promise.all([
        getLeaderboard(100),
        getLeaderboardStats(),
        getUserRank(wallet),
      ]);
      setRows(r);
      setStats(s);
      setUserRank(u);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { void load(); }, [load]);

  const isEmpty = !loading && rows.length === 0;

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Hero */}
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10 text-2xl">
            🏆
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Global Leaderboard
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Earn Fun Points by trading, checking in, completing tasks and inviting active traders.
            </p>
          </div>
        </header>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<Users className="h-4 w-4 text-pump-green" />}
            label="Total Players"
            value={loading ? "—" : formatPoints(stats?.totalPlayers ?? 0)}
          />
          <StatCard
            icon={<Sparkles className="h-4 w-4 text-pump-green" />}
            label="Total Fun Points"
            value={loading ? "—" : formatPoints(stats?.totalPoints ?? 0)}
          />
          <StatCard
            icon={<Crown className="h-4 w-4 text-[#EAB54C]" />}
            label="Top Trader"
            value={loading ? "—" : stats?.topTraderName || (stats?.topTraderWallet ? shortWallet(stats.topTraderWallet) : "—")}
            small
          />
          <StatCard
            icon={<Trophy className="h-4 w-4 text-pump-green" />}
            label="Your Rank"
            value={
              !wallet ? "—" : loading ? "—" : userRank ? `#${formatPoints(userRank.rank)}` : "Unranked"
            }
          />
        </div>

        {/* Your Rank card */}
        {wallet ? (
          userRank ? (
            <section className="relative overflow-hidden rounded-2xl border border-pump-green/40 bg-gradient-to-br from-pump-gray to-black p-5 shadow-[0_0_40px_rgba(0,255,135,0.10)]">
              <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-pump-green/15 blur-3xl" />
              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pump-green">
                    Your Rank
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold tabular-nums text-white md:text-4xl">
                      #{formatPoints(userRank.rank)}
                    </span>
                    <span className="text-sm text-gray-400">of {formatPoints(stats?.totalPlayers ?? 0)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <Pill label="Fun Points" value={formatPoints(userRank.totalPoints)} />
                  <Pill label="Lifetime" value={formatPoints(userRank.lifetimePoints)} />
                  <Pill label="Streak" value={String(userRank.streak)} flame />
                </div>
              </div>
              {userRank.pointsToNextRank != null && userRank.rank > 1 && (
                <div className="relative mt-3 text-xs text-gray-400">
                  <span className="font-semibold text-pump-green">
                    +{formatPoints(userRank.pointsToNextRank)}
                  </span>{" "}
                  Fun Points to reach rank #{formatPoints(userRank.rank - 1)}.
                </div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-pump-border bg-pump-gray p-5 text-sm text-gray-300">
              You don&apos;t have any Fun Points yet.{" "}
              <a href="/rewards" className="font-semibold text-pump-green hover:underline">
                Start earning →
              </a>
            </section>
          )
        ) : (
          <section className="rounded-2xl border border-pump-green/25 bg-pump-gray p-5 text-sm text-gray-300">
            Connect your wallet to see your rank.
          </section>
        )}

        {/* Leaderboard list */}
        <section className="overflow-hidden rounded-2xl border border-pump-border bg-pump-gray">
          {/* Desktop table header */}
          <div className="hidden grid-cols-12 gap-2 border-b border-white/5 bg-black/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 md:grid">
            <div className="col-span-1">Rank</div>
            <div className="col-span-5">Player</div>
            <div className="col-span-2 text-right">Fun Points</div>
            <div className="col-span-2 text-right">Lifetime</div>
            <div className="col-span-2 text-right">Streak</div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">Loading leaderboard…</div>
          ) : isEmpty ? (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-pump-green/30 bg-pump-green/10 text-2xl">
                🏆
              </div>
              <div className="text-sm font-semibold text-white">No leaderboard entries yet</div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">
                Start earning Fun Points to appear here.
              </p>
              <a
                href="/rewards"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-pump-green px-4 text-xs font-bold text-black hover:bg-pump-green/90"
              >
                Earn Fun Points
              </a>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((row) => {
                const isMe = wallet != null && row.wallet === wallet;
                return (
                  <li
                    key={row.wallet}
                    className={`grid grid-cols-12 items-center gap-2 px-4 py-3 md:px-5 ${
                      isMe ? "bg-pump-green/5" : "hover:bg-black/20"
                    } transition`}
                  >
                    {/* Rank */}
                    <div className="col-span-2 md:col-span-1">
                      <RankBadge rank={row.rank} />
                    </div>

                    {/* Player */}
                    <div className="col-span-6 flex items-center gap-2 md:col-span-5">
                      <Avatar row={row} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                          {displayNameForRow(row)}
                          {isMe && (
                            <span className="rounded-full bg-pump-green/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-pump-green">
                              You
                            </span>
                          )}
                        </div>
                        {row.displayName && (
                          <div className="truncate text-[11px] text-gray-500">{shortWallet(row.wallet)}</div>
                        )}
                      </div>
                    </div>

                    {/* Fun Points */}
                    <div className="col-span-4 text-right text-sm font-bold tabular-nums text-pump-green md:col-span-2">
                      {formatPoints(row.totalPoints)}
                      {/* mobile-only lifetime + streak under the points */}
                      <div className="mt-0.5 text-[10px] font-normal text-gray-500 md:hidden">
                        {formatPoints(row.lifetimePoints)} lifetime · 🔥{row.streak}
                      </div>
                    </div>

                    {/* Lifetime (desktop) */}
                    <div className="col-span-2 hidden text-right text-sm font-semibold tabular-nums text-white md:block">
                      {formatPoints(row.lifetimePoints)}
                    </div>

                    {/* Streak (desktop) */}
                    <div className="col-span-2 hidden items-center justify-end gap-1 text-right text-sm font-semibold tabular-nums text-orange-300 md:flex">
                      <Flame className="h-3.5 w-3.5" />
                      {row.streak}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  small = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-pump-border bg-pump-gray p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {icon}
        {label}
      </div>
      <div className={`mt-1.5 font-extrabold text-white ${small ? "truncate text-base md:text-lg" : "text-xl tabular-nums md:text-2xl"}`}>
        {value}
      </div>
    </div>
  );
}

function Pill({ label, value, flame = false }: { label: string; value: string; flame?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
        flame
          ? "border-orange-500/30 bg-orange-500/10 text-orange-300"
          : "border-white/10 bg-black/40 text-gray-300"
      }`}
    >
      {flame && <Flame className="h-3 w-3" />}
      {label} <span className="font-bold tabular-nums text-white">{value}</span>
    </span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EAB54C] text-black" title="1st">
        <Crown className="h-4 w-4" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#C0C7D0] text-black" title="2nd">
        <Medal className="h-4 w-4" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#CD7F32] text-black" title="3rd">
        <Medal className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-xs font-bold text-gray-300 tabular-nums">
      {rank}
    </div>
  );
}

function Avatar({ row }: { row: LeaderboardRow }) {
  if (row.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={row.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  const initials = (row.displayName?.trim() || row.wallet).slice(0, 2).toUpperCase();
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-black/40 text-[10px] font-semibold text-gray-300">
      {initials}
    </div>
  );
}
