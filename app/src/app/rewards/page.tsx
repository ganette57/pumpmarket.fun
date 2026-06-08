"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Trophy,
  Copy,
  Check,
  Gift,
  Users,
  Flame,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import {
  activityLabel,
  claimDailyReward,
  completeRewardTask,
  formatPoints,
  getActiveTasks,
  getFunPointsSummary,
  getReferralSummary,
  type FunPointsActivity,
  type FunPointsSummary,
  type ReferralSummary,
  type RewardTask,
} from "@/lib/funPoints";

const DAILY_REWARD_FALLBACK = 10;

export default function RewardsPage() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  const [summary, setSummary] = useState<FunPointsSummary | null>(null);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [claiming, setClaiming] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [taskBusy, setTaskBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, t] = await Promise.all([
        getFunPointsSummary(wallet),
        getReferralSummary(wallet),
        getActiveTasks(wallet),
      ]);
      setSummary(s);
      setReferral(r);
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { void load(); }, [load]);

  const balance       = summary?.balance ?? 0;
  const lifetime      = summary?.lifetimePoints ?? 0;
  const streak        = summary?.streak ?? 0;
  const claimedToday  = summary?.claimedToday ?? false;
  const recent: FunPointsActivity[] = summary?.recent ?? [];

  const referralCode      = referral?.code ?? "—";
  const referralLink      = referral?.link ?? "";
  const referralInvited   = referral?.invited ?? 0;
  const referralEarnings  = referral?.pointsEarned ?? 0;
  const referralLifetime  = referral?.lifetimePointsEarned ?? 0;

  async function handleClaim() {
    if (!wallet || claimedToday || claiming) return;
    setClaiming(true);
    const res = await claimDailyReward(wallet);
    setClaiming(false);
    if (res.awarded) {
      await load();
    } else if (res.balance) {
      // Already claimed elsewhere — sync state
      await load();
    }
  }

  async function handleCopy() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = referralLink;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
      document.body.removeChild(ta);
    }
  }

  async function handleTask(task: RewardTask) {
    if (!wallet || task.done || taskBusy) return;

    // Two-stage MVP flow: open the external action, then run a brief
    // "Verifying…" placeholder before crediting. We intentionally do
    // NOT call any real social API here — confirmation is on the honor
    // system for the launch MVP, gated server-side by the one-claim-
    // per-wallet rule inside task_completions.
    if (task.url) {
      window.open(task.url, "_blank", "noopener,noreferrer");
    }
    setTaskBusy(task.id);
    // Short fake verification window so the user gets a clear signal
    // that something is happening, not so long it feels broken.
    await new Promise((r) => setTimeout(r, 1400));
    const res = await completeRewardTask(wallet, task.id);
    setTaskBusy(null);
    if (res.awarded) await load();
    // If the API said "already claimed" we still refresh so the row
    // flips to the Completed state visually.
    else if (res.balance) await load();
  }

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
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

        {!wallet && (
          <div className="rounded-2xl border border-pump-green/25 bg-pump-gray p-4 text-sm text-gray-300">
            Connect your wallet to start earning Fun Points.
          </div>
        )}

        {/* 1. Your Fun Points */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/25 bg-pump-gray p-5 shadow-[0_0_40px_rgba(0,255,135,0.08)]">
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at top right, rgba(0,255,135,0.12) 0%, rgba(0,255,135,0) 60%)" }} />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              Your Fun Points
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl md:text-4xl">🏆</span>
              <span className="text-4xl font-extrabold tabular-nums text-white md:text-5xl">
                {loading ? "—" : formatPoints(balance)}
              </span>
              <span className="text-sm font-semibold text-gray-400">Fun Points</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-gray-300">
                Lifetime <span className="font-bold text-white tabular-nums">{formatPoints(lifetime)}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-orange-300">
                <Flame className="h-3 w-3" /> Streak <span className="font-bold tabular-nums">{streak}</span>
              </span>
            </div>
          </div>
        </section>

        {/* 2. Referral Program — marketing hero, sits right under the balance */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/50 bg-gradient-to-br from-pump-gray to-black p-6 shadow-[0_0_60px_rgba(0,255,135,0.15)] md:p-8">
          {/* glow */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-pump-green/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-pump-green/10 blur-3xl" />

          <div className="relative">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-pump-green/40 bg-black/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              <Sparkles className="h-3 w-3" />
              Invite & earn
            </div>

            {/* Headline */}
            <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-white md:text-3xl">
              Invite Friends
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300 md:text-base">
              Earn <span className="font-bold text-pump-green">10%</span> of every Fun Point your invited friends earn from trading.
              <span className="ml-1 font-semibold text-white">Unlimited rewards.</span>
            </p>

            {/* Code */}
            <div className="mt-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Your referral code
              </div>
              <div className="mt-1 font-mono text-2xl font-extrabold tracking-wider text-white md:text-3xl">
                {referralCode}
              </div>
            </div>

            {/* Link */}
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Your referral link
              </div>
              <input
                type="text"
                readOnly
                value={referralLink}
                className="mt-1 w-full rounded-xl border border-gray-700/60 bg-black/60 px-3 py-3 font-mono text-xs text-gray-200 outline-none focus:border-pump-green/60 md:text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            {/* Copy button — large, full-width on mobile, green */}
            <button
              type="button"
              onClick={handleCopy}
              disabled={!referralLink}
              aria-label="Copy invite link"
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-pump-green px-6 text-sm font-extrabold uppercase tracking-wide text-black transition hover:bg-pump-green/90 active:scale-[0.99] disabled:opacity-50 md:w-auto md:text-base"
            >
              {copied ? (
                <>
                  <Check className="h-5 w-5" />
                  Link copied!
                </>
              ) : (
                <>
                  <Copy className="h-5 w-5" />
                  Copy Invite Link
                </>
              )}
            </button>

            {/* Stats — Referral Earnings is the headline */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatBig
                label="Referral Earnings"
                value={`+${formatPoints(referralEarnings)}`}
                hint="Fun Points from your referrals"
                accent
              />
              <StatBig
                label="Lifetime Referral Earnings"
                value={`+${formatPoints(referralLifetime)}`}
                hint="All-time total"
              />
              <StatBig
                label="Friends Invited"
                value={formatPoints(referralInvited)}
                hint="Wallets you've referred"
              />
            </div>

            {!wallet && (
              <p className="mt-4 text-[11px] text-gray-500">
                Connect your wallet to get a personalized referral code.
              </p>
            )}
          </div>
        </section>

        {/* 3. Daily Check-in — kept as-is */}
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
                +{DAILY_REWARD_FALLBACK} Fun Points
              </div>
            </div>
            <button
              type="button"
              onClick={handleClaim}
              disabled={!wallet || claimedToday || claiming}
              className={
                claimedToday
                  ? "shrink-0 inline-flex h-10 items-center justify-center rounded-full border border-pump-green/40 bg-pump-green/10 px-4 text-xs font-semibold text-pump-green md:text-sm"
                  : "shrink-0 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-4 text-xs font-bold text-black transition hover:bg-pump-green/90 disabled:opacity-50 md:text-sm"
              }
              aria-label="Claim daily reward"
            >
              {claimedToday ? "Claimed today ✅" : claiming ? "Claiming…" : "Claim Daily Reward"}
            </button>
          </div>
        </section>

        {/* 4. Tasks */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <CheckCircle2 className="h-4 w-4 text-pump-green" />
            Tasks
          </div>
          {tasks.length === 0 && (
            <p className="text-sm text-gray-400">No tasks active right now. Check back soon.</p>
          )}
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/30 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {t.title}
                    {t.url && (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-pump-green"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Open task link"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {t.description && (
                    <div className="mt-0.5 text-xs text-gray-400">{t.description}</div>
                  )}
                </div>
                <div className="shrink-0 text-sm font-bold text-pump-green">+{formatPoints(t.points)}</div>
                <button
                  type="button"
                  onClick={() => handleTask(t)}
                  disabled={!wallet || t.done || taskBusy === t.id}
                  className={
                    t.done
                      ? "shrink-0 inline-flex h-9 min-w-[112px] items-center justify-center rounded-full border border-pump-green/40 bg-pump-green/10 px-3 text-xs font-semibold text-pump-green"
                      : taskBusy === t.id
                      ? "shrink-0 inline-flex h-9 min-w-[112px] items-center justify-center gap-1.5 rounded-full border border-pump-green/40 bg-black/40 px-3 text-xs font-semibold text-pump-green"
                      : "shrink-0 inline-flex h-9 min-w-[112px] items-center justify-center rounded-full bg-pump-green px-3 text-xs font-bold text-black hover:bg-pump-green/90 disabled:opacity-50"
                  }
                  aria-label={t.done ? "Task completed" : taskBusy === t.id ? "Verifying" : "Claim task"}
                >
                  {t.done ? (
                    "Completed ✓"
                  ) : taskBusy === t.id ? (
                    <>
                      <span
                        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pump-green/30 border-t-pump-green"
                        aria-hidden="true"
                      />
                      Verifying…
                    </>
                  ) : (
                    "Claim"
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. Recent Activity — least important, kept at the bottom */}
        <section className="rounded-2xl border border-pump-border bg-pump-gray p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Trophy className="h-4 w-4 text-pump-green" />
            Recent Activity
          </div>
          <ul className="divide-y divide-white/5">
            {recent.length === 0 && (
              <li className="py-3 text-sm text-gray-400">
                {wallet
                  ? "Nothing yet. Earn points by trading or checking in daily."
                  : "Connect your wallet to see activity."}
              </li>
            )}
            {recent.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between py-3 text-sm">
                <span className="text-gray-200">{entry.label || activityLabel(entry.kind)}</span>
                <span className={`font-bold tabular-nums ${entry.points >= 0 ? "text-pump-green" : "text-red-400"}`}>
                  {entry.points >= 0 ? "+" : ""}{formatPoints(entry.points)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StatBig({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-black/50 px-4 py-3 ${accent ? "border-pump-green/40" : "border-white/10"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums md:text-2xl ${accent ? "text-pump-green" : "text-white"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}
