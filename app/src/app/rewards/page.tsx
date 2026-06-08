"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Trophy, Copy, Check, Gift, Users } from "lucide-react";
import {
  claimDailyReward,
  formatPoints,
  getDailyRewardPoints,
  getFunPointsSummary,
  getReferralSummary,
  type FunPointsActivity,
} from "@/lib/funPoints";

export default function RewardsPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const initialSummary = useMemo(() => getFunPointsSummary(wallet), [wallet]);
  const referral = useMemo(() => getReferralSummary(wallet), [wallet]);
  const dailyPoints = getDailyRewardPoints();

  const [balance, setBalance] = useState<number>(initialSummary.balance);
  const [recent, setRecent] = useState<FunPointsActivity[]>(initialSummary.recent);
  const [claimed, setClaimed] = useState<boolean>(initialSummary.claimedToday);
  const [copied, setCopied] = useState<boolean>(false);

  function handleClaim() {
    if (claimed) return;
    const { points, newBalance } = claimDailyReward(wallet);
    setBalance(newBalance);
    setClaimed(true);
    setRecent((prev) => [
      {
        id: `claim-${Date.now()}`,
        kind: "daily_checkin",
        label: "Daily Check-in",
        points,
        at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referral.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = referral.link;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {/* Page header */}
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10 text-xl">
            🏆
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Rewards
            </h1>
            <p className="text-sm text-gray-400">
              Earn Fun Points by trading, checking in, and inviting friends.
            </p>
          </div>
        </header>

        {/* A. Points balance card */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/25 bg-pump-gray p-5 shadow-[0_0_40px_rgba(0,255,135,0.08)]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at top right, rgba(0,255,135,0.12) 0%, rgba(0,255,135,0) 60%)",
            }}
          />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              Your Fun Points
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl md:text-4xl">🏆</span>
              <span className="text-4xl font-extrabold tabular-nums text-white md:text-5xl">
                {formatPoints(balance)}
              </span>
              <span className="text-sm font-semibold text-gray-400">Fun Points</span>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              Points are tracked per wallet. More ways to earn are coming soon.
            </p>
          </div>
        </section>

        {/* B. Daily Check-in */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Gift className="h-4 w-4 text-pump-green" />
                Daily Check-in
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Come back every day to claim a free reward.
              </div>
              <div className="mt-2 text-sm font-bold text-pump-green">
                +{dailyPoints} Fun Points
              </div>
            </div>

            <button
              type="button"
              onClick={handleClaim}
              disabled={claimed}
              className={
                claimed
                  ? "shrink-0 inline-flex h-10 items-center justify-center rounded-full border border-pump-green/40 bg-pump-green/10 px-4 text-xs font-semibold text-pump-green md:text-sm"
                  : "shrink-0 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-4 text-xs font-bold text-black transition hover:bg-pump-green/90 md:text-sm"
              }
              aria-label="Claim daily reward"
            >
              {claimed ? "Claimed today ✅" : "Claim Daily Reward"}
            </button>
          </div>
        </section>

        {/* C. Recent Activity */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Trophy className="h-4 w-4 text-pump-green" />
            Recent Activity
          </div>
          <ul className="divide-y divide-white/5">
            {recent.length === 0 && (
              <li className="py-3 text-sm text-gray-400">
                Nothing yet. Earn points by trading or checking in daily.
              </li>
            )}
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <span className="text-gray-200">{entry.label}</span>
                <span className="font-bold tabular-nums text-pump-green">
                  +{entry.points}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* D. Referral Program */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-pump-green" />
            Referral Program
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400">
                Referral Code
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-white">
                {referral.code}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400">
                Referral Link
              </div>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={referral.link}
                  className="w-full rounded-lg border border-gray-700/60 bg-black/60 px-3 py-2 text-xs text-gray-200 outline-none md:text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-pump-green/40 bg-pump-green/10 px-3 py-2 text-xs font-semibold text-pump-green hover:bg-pump-green/20 md:text-sm"
                  aria-label="Copy referral link"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <span className="text-xs text-gray-400">Friends Invited</span>
              <span className="text-sm font-bold text-white">{referral.invited}</span>
            </div>

            {!wallet && (
              <p className="text-[11px] text-gray-500">
                Connect your wallet to get a personalized referral code.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
