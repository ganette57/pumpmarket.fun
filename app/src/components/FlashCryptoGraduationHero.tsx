"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  tokenMint: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenImageUri?: string | null;
  durationMinutes?: number | null;
  windowEnd?: string | null;
  progressStart?: number | null;
  finalProgress?: number | null;
  didGraduateFinal?: boolean | null;
  isEnded?: boolean;
};

function clampPct(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatCountdownMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function statusText(progressPct: number, didGraduate: boolean): string {
  if (didGraduate) return "Graduated";
  if (progressPct >= 85) return "Near graduation";
  if (progressPct >= 55) return "Building momentum";
  return "Falling behind";
}

type ProgressTier = "calm" | "engaging" | "strong" | "near" | "critical" | "graduated";

function progressTier(progressPct: number, didGraduate: boolean): ProgressTier {
  if (didGraduate) return "graduated";
  if (progressPct >= 95) return "critical";
  if (progressPct >= 80) return "near";
  if (progressPct >= 60) return "strong";
  if (progressPct >= 40) return "engaging";
  return "calm";
}

export default function FlashCryptoGraduationHero({
  tokenMint,
  tokenSymbol,
  tokenName,
  tokenImageUri,
  durationMinutes,
  windowEnd,
  progressStart,
  finalProgress,
  didGraduateFinal,
  isEnded,
}: Props) {
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [liveProgress, setLiveProgress] = useState<number | null>(progressStart ?? null);
  const [liveDidGraduate, setLiveDidGraduate] = useState<boolean>(false);

  const windowEndMs = useMemo(() => {
    const parsed = Date.parse(String(windowEnd || ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }, [windowEnd]);

  const effectiveDidGraduate = !!(isEnded ? didGraduateFinal : liveDidGraduate);
  const effectiveProgress = clampPct(
    isEnded ? (finalProgress ?? progressStart ?? liveProgress) : (liveProgress ?? progressStart ?? 0),
  );

  const countdownSec = Number.isFinite(windowEndMs)
    ? Math.max(0, Math.ceil((windowEndMs - countdownNow) / 1000))
    : 0;

  useEffect(() => {
    setLiveProgress(progressStart ?? null);
  }, [progressStart, tokenMint]);

  useEffect(() => {
    setLiveDidGraduate(false);
  }, [tokenMint]);

  useEffect(() => {
    if (isEnded) return;
    const iv = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isEnded]);

  useEffect(() => {
    if (isEnded || !tokenMint) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch(`/api/flash-crypto/graduation?mint=${encodeURIComponent(tokenMint)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        const nextProgress = Number(json?.progressPct);
        if (Number.isFinite(nextProgress)) {
          setLiveProgress(clampPct(nextProgress));
        }
        setLiveDidGraduate(json?.didGraduate === true);
      } catch {
        // silent polling failure
      }
    };

    void pull();
    const iv = setInterval(() => void pull(), 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [isEnded, tokenMint]);

  const status = statusText(effectiveProgress, effectiveDidGraduate);
  const tier = progressTier(effectiveProgress, effectiveDidGraduate);
  const toneClass =
    tier === "graduated"
      ? "text-pump-green"
      : tier === "critical"
      ? "text-emerald-200"
      : tier === "near"
      ? "text-cyan-200"
      : tier === "strong"
      ? "text-emerald-300"
      : tier === "engaging"
      ? "text-cyan-300"
      : "text-slate-300";
  const statusDotClass =
    tier === "graduated"
      ? "bg-pump-green shadow-[0_0_12px_rgba(0,255,136,0.8)]"
      : tier === "critical"
      ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.6)]"
      : tier === "near"
      ? "bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.55)]"
      : tier === "strong"
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]"
      : tier === "engaging"
      ? "bg-cyan-400 shadow-[0_0_8px_rgba(45,212,191,0.45)]"
      : "bg-slate-400/80";
  const barFillClass =
    tier === "graduated"
      ? "from-emerald-400 via-pump-green to-emerald-300"
      : tier === "critical"
      ? "from-emerald-400 via-cyan-300 to-emerald-200"
      : tier === "near"
      ? "from-emerald-500 via-teal-300 to-cyan-300"
      : tier === "strong"
      ? "from-emerald-600 via-teal-400 to-cyan-400"
      : tier === "engaging"
      ? "from-teal-700 via-teal-500 to-cyan-500"
      : "from-slate-700 via-teal-700 to-cyan-700";
  const barGlowClass =
    tier === "graduated"
      ? "shadow-[0_0_18px_rgba(0,255,136,0.55)]"
      : tier === "critical"
      ? "shadow-[0_0_16px_rgba(52,211,153,0.45)]"
      : tier === "near"
      ? "shadow-[0_0_14px_rgba(45,212,191,0.4)]"
      : tier === "strong"
      ? "shadow-[0_0_12px_rgba(20,184,166,0.35)]"
      : tier === "engaging"
      ? "shadow-[0_0_10px_rgba(6,182,212,0.3)]"
      : "shadow-[0_0_8px_rgba(15,23,42,0.25)]";

  return (
    <div className="rounded-2xl border border-cyan-400/30 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.18),transparent_45%),linear-gradient(145deg,#060b12,#090f18)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          {tokenImageUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tokenImageUri} alt="" className="h-12 w-12 rounded-lg border border-white/20 object-cover" />
          ) : (
            <div className="h-12 w-12 rounded-lg border border-white/20 bg-black/30 flex items-center justify-center text-xs font-black text-white">
              {(tokenSymbol || "TKN").slice(0, 4)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-lg sm:text-xl font-black text-white truncate">
              ${tokenSymbol || "TOKEN"}
            </div>
            <div className="text-xs text-gray-400 truncate">{tokenName || tokenMint}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-cyan-200">
            GRADUATION
          </span>
          <span className="rounded-full border border-white/20 bg-black/40 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-white/90">
            {durationMinutes === 60 ? "1H" : `${durationMinutes || "?"}M`}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-gray-500">Countdown</div>
          <div className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
            {formatCountdownMmSs(countdownSec)}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-gray-500">Status</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`} />
            <div className={`text-base font-semibold tracking-[0.01em] ${toneClass}`}>{status}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-gray-500">Bonding Curve Progress</div>
          <div className="text-sm font-semibold text-white">{effectiveProgress.toFixed(1)}%</div>
        </div>
        <div className="mt-2 relative h-3 rounded-full border border-white/10 bg-[#091117] overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.01)_24%,rgba(255,255,255,0.02)_100%)]" />
          <div
            className={`relative h-full bg-gradient-to-r ${barFillClass} ${barGlowClass} transition-[width] duration-700 ease-out`}
            style={{ width: `${effectiveProgress}%` }}
          >
            <div className="absolute inset-0 opacity-80 bg-[linear-gradient(90deg,rgba(255,255,255,0.0)_0%,rgba(255,255,255,0.28)_50%,rgba(255,255,255,0.0)_100%)] grad-energy-sweep" />
            <div className="absolute inset-y-[1px] right-[2px] w-[18px] rounded-full bg-white/50 blur-[1.5px] opacity-70 motion-reduce:opacity-45 grad-energy-pulse" />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_55%)]" />
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-gray-300">
            Start: <span className="text-white font-semibold">{clampPct(progressStart).toFixed(1)}%</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-gray-300">
            {isEnded ? "Current" : "Live"}: <span className="text-white font-semibold">{effectiveProgress.toFixed(1)}%</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-gray-300">
            Final: <span className={`font-semibold ${effectiveDidGraduate ? "text-pump-green" : "text-red-300"}`}>
              {isEnded ? (didGraduateFinal ? "Graduated" : "No graduation") : "Pending"}
            </span>
          </div>
        </div>
      </div>
      <style jsx>{`
        .grad-energy-sweep {
          animation: flash-grad-sweep 3.2s linear infinite;
          will-change: transform, opacity;
        }
        .grad-energy-pulse {
          animation: flash-grad-pulse 2.4s ease-in-out infinite;
          will-change: opacity, transform;
        }
        @keyframes flash-grad-sweep {
          0% {
            transform: translateX(-120%);
            opacity: 0;
          }
          16% {
            opacity: 0.18;
          }
          45% {
            opacity: 0.34;
          }
          100% {
            transform: translateX(120%);
            opacity: 0;
          }
        }
        @keyframes flash-grad-pulse {
          0%,
          100% {
            opacity: 0.45;
            transform: scale(0.96);
          }
          50% {
            opacity: 0.9;
            transform: scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .grad-energy-sweep,
          .grad-energy-pulse {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
