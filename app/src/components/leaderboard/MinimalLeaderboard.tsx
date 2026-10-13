"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";

export type MinimalLeaderboardPlayer = {
  rank: number;
  wallet: string;
  name: string;
  avatarUrl: string | null;
  score: string;
};

export type LeaderboardExplanation = {
  participation: string;
  calculation: string;
  context: { title: string; body: string };
  rewards: string | null;
};

export type LeaderboardSummary =
  | { kind: "loading" }
  | { kind: "countdown"; endsAt: string }
  | { kind: "empty"; message: string }
  | {
      kind: "progress";
      label: string;
      current: string;
      target: string;
      percent: number;
    };

type Props = {
  players: MinimalLeaderboardPlayer[];
  summary: LeaderboardSummary;
  pending: boolean;
  unavailable?: boolean;
  showPodium?: boolean;
  explanation: LeaderboardExplanation;
  onPeriodEnd?: () => void;
};

const PODIUM = [
  { rank: 1, medal: "🥇", placement: "col-start-2 row-start-1", featured: true },
  { rank: 2, medal: "🥈", placement: "col-start-1 row-start-2", featured: false },
  { rank: 3, medal: "🥉", placement: "col-start-3 row-start-2", featured: false },
] as const;

function remainingUntil(iso: string | null, now: number) {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  const totalSeconds = Math.max(0, Math.floor((end - now) / 1000));
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    expired: end <= now,
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function Countdown({ periodEnd, onPeriodEnd }: { periodEnd: string; onPeriodEnd?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const expiredFor = useRef<string | null>(null);
  const remaining = remainingUntil(periodEnd, now);

  useEffect(() => {
    setNow(Date.now());
    if (!periodEnd) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [periodEnd]);

  useEffect(() => {
    if (!periodEnd || !remaining?.expired || expiredFor.current === periodEnd) return;
    expiredFor.current = periodEnd;
    onPeriodEnd?.();
  }, [onPeriodEnd, periodEnd, remaining?.expired]);

  return (
    <div className="text-center" aria-live="off">
      <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-pump-green/80">Contest ends in</p>
      {remaining && !remaining.expired ? (
        <p
          className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-[0.08em] text-white tabular-nums sm:text-3xl"
          aria-label={`${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes`}
        >
          {pad(remaining.days)}d <span className="text-white/25">:</span> {pad(remaining.hours)}h{" "}
          <span className="text-white/25">:</span> {pad(remaining.minutes)}m
        </p>
      ) : (
        <p className="mt-2 text-sm font-medium text-white/45">No active contest</p>
      )}
    </div>
  );
}

function Summary({ summary, onPeriodEnd }: { summary: LeaderboardSummary; onPeriodEnd?: () => void }) {
  if (summary.kind === "loading") {
    return <div className="h-5 w-36 animate-pulse rounded bg-white/[0.06]" aria-label="Loading leaderboard summary" />;
  }

  if (summary.kind === "countdown") {
    return <Countdown periodEnd={summary.endsAt} onPeriodEnd={onPeriodEnd} />;
  }

  if (summary.kind === "empty") {
    return <p className="text-sm font-medium text-white/45">{summary.message}</p>;
  }

  const percent = Math.min(Math.max(summary.percent, 0), 100);
  return (
    <section className="w-full max-w-md text-center" aria-label="Real volume progress">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-pump-green/80">{summary.label}</p>
      <p className="mt-2 text-base font-semibold text-white tabular-nums sm:text-lg">
        {summary.current} <span className="text-white/30">/</span> {summary.target}
      </p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-pump-green transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs font-semibold text-white/50 tabular-nums">{percent.toFixed(1)}%</p>
    </section>
  );
}

function Avatar({ player, featured }: { player: MinimalLeaderboardPlayer; featured: boolean }) {
  const initials = (player.name || player.wallet).slice(0, 2).toUpperCase();
  return (
    <div className={`${featured ? "h-[4.5rem] w-[4.5rem]" : "h-14 w-14"} overflow-hidden rounded-full border bg-[#111713] ${featured ? "border-pump-green/70 shadow-[0_0_32px_rgba(0,255,136,0.16)]" : "border-white/15"}`}>
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={player.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white/70">{initials}</span>
      )}
    </div>
  );
}

function PodiumSpot({ rank, medal, featured, player, pending, unavailable }: {
  rank: 1 | 2 | 3;
  medal: string;
  featured: boolean;
  player: MinimalLeaderboardPlayer | undefined;
  pending: boolean;
  unavailable: boolean;
}) {
  if (pending) {
    return (
      <div className="flex flex-col items-center" aria-label={`Loading rank ${rank}`}>
        <div className={`${featured ? "h-[4.5rem] w-[4.5rem]" : "h-14 w-14"} animate-pulse rounded-full bg-white/[0.07]`} />
        <div className="mt-3 h-3 w-16 animate-pulse rounded bg-white/[0.06]" />
      </div>
    );
  }

  if (!player) {
    return (
      <div className="flex min-w-0 flex-col items-center text-center opacity-55">
        <span className={featured ? "text-4xl" : "text-3xl"} aria-hidden>{medal}</span>
        <span className="mt-1 text-xs font-bold text-white/70">#{rank}</span>
        <div className={`${featured ? "h-[4.5rem] w-[4.5rem]" : "h-14 w-14"} mt-2 rounded-full border border-dashed border-white/15`} />
        <span className="mt-3 text-xs text-white/40">{unavailable ? "Unavailable" : "Open spot"}</span>
      </div>
    );
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(player.wallet)}`}
      className="group flex min-w-0 flex-col items-center text-center transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70"
      aria-label={`Rank ${rank}: ${player.name}, ${player.score}`}
    >
      <span className={featured ? "text-4xl" : "text-3xl"} aria-hidden>{medal}</span>
      <span className={`mt-1 font-extrabold text-white ${featured ? "text-base" : "text-sm"}`}>#{rank}</span>
      <div className="mt-2"><Avatar player={player} featured={featured} /></div>
      <span className="mt-3 max-w-full truncate text-sm font-semibold text-white">{player.name}</span>
      <span className={`mt-1 text-xs font-bold tabular-nums ${featured ? "text-pump-green" : "text-white/55"}`}>{player.score}</span>
    </Link>
  );
}

function HowItWorksDrawer({ open, onClose, explanation }: { open: boolean; onClose: () => void; explanation: LeaderboardExplanation }) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;
  const sections = [
    ["How to participate", explanation.participation],
    ["How ranking works", explanation.calculation],
    [explanation.context.title, explanation.context.body],
    ...(explanation.rewards ? [["Rewards", explanation.rewards]] : []),
  ];

  return (
    <div className="fixed inset-0 z-[250] flex items-end" role="presentation">
      <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} aria-label="Close how it works" />
      <section role="dialog" aria-modal="true" aria-labelledby="leaderboard-how-title" className="relative max-h-[82dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-[#0b0d0c] px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl animate-fadeIn">
        <div className="mx-auto h-1 w-10 rounded-full bg-white/20" aria-hidden />
        <div className="mx-auto mt-5 flex w-full max-w-xl items-center justify-between">
          <h2 id="leaderboard-how-title" className="text-xl font-bold text-white">How it works</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:border-white/25 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-auto mt-6 w-full max-w-xl space-y-6">
          {sections.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-pump-green">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function MinimalLeaderboard({ players, summary, pending, unavailable = false, showPodium = true, explanation, onPeriodEnd }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="min-h-screen bg-black px-5 pb-32 pt-6 text-white md:pt-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
        <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">Leaderboard</h1>
        <div className="mt-7 flex w-full justify-center"><Summary summary={summary} onPeriodEnd={onPeriodEnd} /></div>
        {showPodium && (
          <section className="mt-7 grid w-full grid-cols-3 grid-rows-[auto_auto] items-end gap-x-2 gap-y-0 sm:mt-8 sm:gap-x-8" aria-label="Top three players">
            {PODIUM.map((spot) => (
              <div key={spot.rank} className={`${spot.placement} ${spot.rank === 1 ? "" : "-mt-14 sm:-mt-16"}`}>
                <PodiumSpot rank={spot.rank} medal={spot.medal} featured={spot.featured} player={players.find((player) => player.rank === spot.rank)} pending={pending} unavailable={unavailable} />
              </div>
            ))}
          </section>
        )}
        <button onClick={() => setDrawerOpen(true)} className="mt-6 inline-flex h-10 items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-5 text-sm font-medium text-white/65 transition hover:border-pump-green/40 hover:text-pump-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70">
          <Info className="h-4 w-4" /> How it works
        </button>
      </div>
      <HowItWorksDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} explanation={explanation} />
    </div>
  );
}
