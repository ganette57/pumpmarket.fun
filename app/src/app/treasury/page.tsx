"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  Trophy,
  Target,
  Flag,
  Users,
  BarChart3,
  Sparkles,
  Crown,
  ArrowDown,
  ShieldCheck,
} from "lucide-react";
import {
  CHAMPIONSHIP_TREASURY,
  CHAMPIONSHIP_TARGET_USD,
  getChampionshipStats,
  getTradedVolume,
  formatSol,
  formatUsd,
  formatUsdApprox,
  formatMilestone,
  formatProgressPct,
  shortWallet,
  type ChampionshipStats,
  type TradedVolume,
} from "@/lib/treasury";
import { formatPoints } from "@/lib/funPoints";

const GREEN = "#00FF87";
const GREEN_SOFT = "#61ff9a";

export default function TreasuryPage() {
  const [stats, setStats] = useState<ChampionshipStats | null>(null);
  const [volume, setVolume] = useState<TradedVolume | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getChampionshipStats().catch(() => null),
      getTradedVolume().catch(() => null),
    ])
      .then(([s, v]) => {
        if (cancelled) return;
        setStats(s);
        setVolume(v);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const t = CHAMPIONSHIP_TREASURY;

  const progressBarPct = volume ? Math.round(volume.progressPct) : 0; // visual width
  const progressLabel = volume ? formatProgressPct(volume.progressPct) : "—";
  const volumeSol = volume ? formatSol(volume.sol) : "—";
  const volumeUsd = volume ? formatUsdApprox(volume.usd) : "";
  const currentMilestoneLabel = volume ? formatMilestone(volume.currentMilestone) : "—";
  const nextMilestoneLabel = volume ? formatMilestone(volume.nextMilestone) : "—";

  const topPlayer =
    stats?.topPlayerName ||
    (stats?.topPlayerWallet ? shortWallet(stats.topPlayerWallet) : "—");

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/25 bg-gradient-to-br from-pump-gray to-black p-6 shadow-[0_0_50px_rgba(0,255,135,0.10)] md:p-8">
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-pump-green/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-pump-green/40 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              <Sparkles className="h-3 w-3" />
              Championship
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
              Treasury
            </h1>
            <p className="mt-2 text-lg font-semibold text-white">
              The engine behind the Championship.
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-300">
              Every trade helps grow the FunMarket ecosystem.
            </p>
          </div>
        </section>

        {/* Championship Progress */}
        <section className="space-y-4">
          <SectionTitle icon={<TrendingUp className="h-4 w-4 text-pump-green" />} title="Championship Progress" />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              icon={<BarChart3 className="h-4 w-4 text-pump-green" />}
              label="Trading Volume"
              value={loading ? "—" : volumeSol}
              sub={loading ? undefined : volumeUsd}
              accent
            />
            <MetricCard icon={<Flag className="h-4 w-4 text-pump-green" />} label="Current Milestone" value={currentMilestoneLabel} />
            <MetricCard icon={<Target className="h-4 w-4 text-pump-green" />} label="Next Milestone" value={nextMilestoneLabel} accent />
            <MetricCard icon={<Trophy className="h-4 w-4 text-[#EAB54C]" />} label="Target Prize Pool" value={t.targetPrizePool} />
          </div>

          {/* Progress bar — within the current → next milestone band,
              from the estimated USD value of real traded volume. */}
          <div className="rounded-2xl border border-pump-border bg-pump-gray p-5">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
              <span>Progress toward {nextMilestoneLabel}</span>
              <span className="font-bold text-pump-green">{progressLabel}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressBarPct}%`,
                  background: `linear-gradient(90deg, ${GREEN} 0%, ${GREEN_SOFT} 100%)`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-gray-500">
              <span>{loading ? "—" : `${volumeSol} traded${volumeUsd ? ` (${volumeUsd})` : ""}`}</span>
              <span>{nextMilestoneLabel}</span>
            </div>

            {/* Context: prize pool + the far-off championship ambition */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-gray-400">
              <span>
                Current Prize Pool{" "}
                <span className="font-semibold text-white">{t.currentPrizePool}</span>
              </span>
              <span>
                Championship Target{" "}
                <span className="font-semibold text-pump-green">{formatUsd(CHAMPIONSHIP_TARGET_USD)} volume</span>
              </span>
            </div>
          </div>
        </section>

        {/* Championship Stats */}
        <section className="space-y-4">
          <SectionTitle icon={<Sparkles className="h-4 w-4 text-pump-green" />} title="Championship Stats" />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Users className="h-4 w-4 text-pump-green" />}
              label="Active Players"
              value={loading ? "—" : formatPoints(stats?.activePlayers ?? 0)}
            />
            <MetricCard
              icon={<BarChart3 className="h-4 w-4 text-pump-green" />}
              label="Markets"
              value={loading ? "—" : formatPoints(stats?.markets ?? 0)}
            />
            <MetricCard
              icon={<Sparkles className="h-4 w-4 text-pump-green" />}
              label="Fun Points Distributed"
              value={loading ? "—" : formatPoints(stats?.funPointsDistributed ?? 0)}
              accent
            />
            <MetricCard
              icon={<Crown className="h-4 w-4 text-[#EAB54C]" />}
              label="Top Player"
              value={loading ? "—" : topPlayer}
              small
            />
          </div>
        </section>

        {/* How it works */}
        <section className="space-y-4">
          <SectionTitle icon={<ArrowDown className="h-4 w-4 text-pump-green" />} title="How it works" />
          <div className="rounded-2xl border border-pump-border bg-pump-gray p-5">
            <div className="mx-auto flex max-w-md flex-col items-center gap-2">
              <FlowStep label="Trading Volume" />
              <FlowArrow />
              <FlowStep label="Platform Revenue" />
              <FlowArrow />
              <FlowStep label="Championship Treasury" highlight />
              <FlowArrow />
              <FlowStep label="Prize Pool" />
              <FlowArrow />
              <FlowStep label="Community Rewards" />
            </div>
          </div>
        </section>

        {/* Transparency */}
        <section className="relative overflow-hidden rounded-2xl border border-pump-green/30 bg-gradient-to-br from-pump-gray to-black p-6">
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-pump-green/10 blur-3xl" />
          <div className="relative flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10">
              <ShieldCheck className="h-5 w-5 text-pump-green" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-pump-green">
                Transparency
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">
                FunMarket may allocate a portion of platform revenue to the Championship Treasury,
                prize pools, community rewards, ecosystem growth and future campaigns.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">
                This page reflects the public progress of the Championship.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-white">
      {icon}
      {title}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent = false,
  small = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-pump-border bg-pump-gray p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1.5 font-extrabold ${
          small ? "truncate text-base md:text-lg" : "text-lg tabular-nums md:text-xl"
        } ${accent ? "text-pump-green" : "text-white"}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">{sub}</div>}
    </div>
  );
}

function FlowStep({ label, highlight = false }: { label: string; highlight?: boolean }) {
  return (
    <div
      className={`w-full rounded-xl border px-4 py-3 text-center text-sm font-semibold ${
        highlight
          ? "border-pump-green/50 bg-pump-green/10 text-pump-green"
          : "border-white/10 bg-black/40 text-white"
      }`}
    >
      {label}
    </div>
  );
}

function FlowArrow() {
  return <ArrowDown className="h-4 w-4 text-gray-600" aria-hidden="true" />;
}
