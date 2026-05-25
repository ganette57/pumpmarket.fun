// Shared mobile rendering extracted from the stable /live/[id] view.
// Used in both /live/[id] (detail) and /live (feed) to guarantee identical rendering.
"use client";

import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import { lamportsToSol } from "@/utils/solana";
import type { LiveSession } from "@/lib/liveSessions";
import { supabase } from "@/lib/supabaseClient";
import { getMarketByAddress } from "@/lib/markets";
import { buildOddsSeries, downsample } from "@/lib/marketHistory";

// Reuse the trade page's odds chart, lazy-loaded so recharts is only fetched
// when a chart drawer actually opens (keeps it out of the swipe-critical
// live bundle). No new dependency — recharts already ships via /trade/[id].
const LiveOddsChart = dynamic(() => import("@/components/OddsHistoryChart"), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] flex items-center justify-center">
      <span className="w-6 h-6 rounded-full border-2 border-pump-green/40 border-t-pump-green animate-spin" />
    </div>
  ),
});

/* ── Helpers ─────────────────────────────────────────────────────── */

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

export function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
}

/* ── StreamPlayer ────────────────────────────────────────────────── */

export function StreamPlayer({ url, className }: { url: string; className?: string }) {
  const embedUrl = useMemo(() => {
    const ytMatch = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([\w-]+)/
    );
    if (ytMatch)
      return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`;

    const twitchMatch = url.match(/twitch\.tv\/(\w+)/);
    if (twitchMatch)
      return `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${
        typeof window !== "undefined" ? window.location.hostname : "localhost"
      }`;

    const kickMatch = url.match(/kick\.com\/(\w+)/);
    if (kickMatch) return `https://player.kick.com/${kickMatch[1]}`;

    return url;
  }, [url]);

  return (
    <div className={className ?? "relative w-full aspect-video bg-black rounded-xl overflow-hidden"}>
      <iframe
        src={embedUrl}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      />
    </div>
  );
}

/* ── StatusBanner ────────────────────────────────────────────────── */

export function StatusBanner({ status }: { status: string }) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 border border-red-600/40">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-semibold text-red-400">LIVE</span>
      </div>
    );
  }

  const map: Record<
    string,
    { border: string; bg: string; text: string; label: string }
  > = {
    scheduled: {
      border: "border-yellow-600/40",
      bg: "bg-yellow-600/20",
      text: "text-yellow-400",
      label: "Scheduled",
    },
    locked: {
      border: "border-orange-500/40",
      bg: "bg-orange-500/20",
      text: "text-orange-400",
      label: "Trading Locked",
    },
    ended: {
      border: "border-gray-600/40",
      bg: "bg-gray-600/20",
      text: "text-gray-400",
      label: "Stream Ended",
    },
    resolved: {
      border: "border-pump-green/40",
      bg: "bg-pump-green/20",
      text: "text-pump-green",
      label: "Resolved",
    },
    cancelled: {
      border: "border-gray-700/40",
      bg: "bg-gray-700/20",
      text: "text-gray-400",
      label: "Cancelled",
    },
  };
  const s = map[status] || map.ended!;

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 rounded-xl ${s.bg} border ${s.border}`}
    >
      <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
    </div>
  );
}

/* ── MobileBuySheet ──────────────────────────────────────────────── */

export function MobileBuySheet({
  open,
  onClose,
  derived,
  connected,
  submitting,
  onTrade,
  sessionLocked,
  defaultOutcomeIndex,
  keepNavbar,
}: {
  open: boolean;
  onClose: () => void;
  derived: { names: string[] };
  connected: boolean;
  submitting: boolean;
  onTrade: (
    s: number,
    idx: number,
    side: "buy" | "sell",
    cost?: number
  ) => void;
  sessionLocked: boolean;
  defaultOutcomeIndex?: number;
  keepNavbar?: boolean;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const presets = [0.01, 0.1, 1];

  // Reset on open when defaultOutcomeIndex is provided (feed context)
  useEffect(() => {
    if (!open) return;
    if (defaultOutcomeIndex != null) {
      setSelectedOutcome(
        clampInt(
          defaultOutcomeIndex,
          0,
          Math.max(derived.names.length - 1, 0)
        )
      );
      setAmount(0);
    }
  }, [open, defaultOutcomeIndex, derived.names.length]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const bottomClass = keepNavbar ? "bottom-14" : "bottom-0";

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <button
        className={`absolute inset-x-0 top-0 ${bottomClass} bg-black/60`}
        onClick={onClose}
        aria-label="Close"
      />

      {/* Sheet */}
      <div
        className={`absolute ${bottomClass} inset-x-0 bg-pump-dark border-t border-gray-800 rounded-t-2xl p-5 pb-8 animate-slideUp`}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-4" />

        {sessionLocked ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm">
              Trading is currently locked for this session.
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full py-3 rounded-xl bg-gray-700 text-white font-semibold"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Amount presets */}
            <p className="text-sm text-gray-400 mb-2">Amount</p>
            <div className="flex gap-2 mb-4">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    amount === p
                      ? "border-pump-green bg-pump-green/10 text-pump-green"
                      : "border-gray-700 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  {p} SOL
                </button>
              ))}
            </div>

            {amount === 0 && (
              <div className="mb-4 rounded-lg bg-pump-dark/80 border border-gray-800 p-3 text-center">
                <p className="text-xs text-gray-400">
                  Select an amount to trade.
                </p>
              </div>
            )}

            {/* Outcome selector */}
            {derived.names.length > 0 && (
              <>
                <p className="text-sm text-gray-400 mb-2">Outcome</p>
                <div className="flex gap-2 mb-4">
                  {derived.names.slice(0, 4).map((name, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedOutcome(idx)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition text-center ${
                        selectedOutcome === idx
                          ? idx === 0
                            ? "border-pump-green bg-pump-green/10 text-pump-green"
                            : "border-[#ff5c73] bg-[#ff5c73]/10 text-[#ff5c73]"
                          : "border-gray-700 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Buy button */}
            <button
              disabled={!connected || amount === 0 || submitting}
              onClick={() => {
                const approxShares = Math.max(1, Math.floor(amount / 0.01));
                onTrade(approxShares, selectedOutcome, "buy", amount);
                onClose();
              }}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                !connected || amount === 0 || submitting
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-pump-green text-black hover:bg-[#74ffb8]"
              }`}
            >
              {!connected
                ? "Connect wallet"
                : submitting
                ? "Submitting..."
                : "Buy"}
            </button>

            <button
              onClick={onClose}
              className="w-full mt-2 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── LiveMobileContent ───────────────────────────────────────────── */

// Renders the exact stable mobile view from /live/[id]:
// StreamPlayer + Title/Host + StatusBanner + Market card with outcomes.
// Truncated before Discussion / Comments / LiveActivity / HostControls.

export type LiveMobileContentMarket = {
  publicKey: string;
  question: string;
  imageUrl?: string;
  category?: string;
  totalVolume: number;
};

export type LiveMobileContentDerived = {
  names: string[];
  percentages: number[];
};

export function LiveMobileContent({
  streamUrl,
  title,
  hostWallet,
  status,
  market,
  derived,
  sessionLocked,
  onOutcomeTap,
  active = true,
  thumbnailUrl,
}: {
  streamUrl: string;
  title: string;
  hostWallet: string;
  status: string;
  market: LiveMobileContentMarket | null;
  derived: LiveMobileContentDerived | null;
  sessionLocked: boolean;
  onOutcomeTap?: (outcomeIndex: number) => void;
  /** When false, show thumbnail instead of stream (perf: only active slide streams) */
  active?: boolean;
  thumbnailUrl?: string;
}) {
  return (
    <>
      {/* Stream player — exact stable rendering */}
      {active && streamUrl ? (
        <StreamPlayer url={streamUrl} />
      ) : (
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.2),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
          )}
        </div>
      )}

      {/* Title + status — exact stable layout */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-white leading-tight break-words">
            {title}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Host: {hostWallet.slice(0, 6)}...{hostWallet.slice(-4)}
          </p>
        </div>
        <StatusBanner status={status} />
      </div>

      {/* Market info card — exact stable structure */}
      {market && derived ? (
        <div className="card-pump p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-pump-dark shrink-0">
              {market.imageUrl ? (
                <Image
                  src={market.imageUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <CategoryImagePlaceholder
                    category={market.category || "other"}
                    className="scale-[0.4]"
                  />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/trade/${market.publicKey}`}
                className="text-sm font-semibold text-white hover:text-pump-green transition line-clamp-1"
              >
                {market.question}
              </Link>
              <p className="text-[11px] text-gray-500">
                {formatVol(market.totalVolume)} SOL Vol
              </p>
            </div>
          </div>

          {/* Outcome bars */}
          <div className="grid grid-cols-2 gap-2">
            {derived.names.slice(0, 2).map((name, idx) => {
              const pct = (derived.percentages[idx] ?? 0).toFixed(1);
              const isYes = idx === 0;
              return (
                <button
                  key={idx}
                  onClick={() => onOutcomeTap?.(idx)}
                  disabled={sessionLocked}
                  className={`text-left rounded-xl px-4 py-3 border bg-pump-dark/80 transition ${
                    isYes ? "border-pump-green/40" : "border-[#ff5c73]/40"
                  } ${!sessionLocked ? "active:scale-[0.98]" : ""}`}
                >
                  <span
                    className={`text-xs font-semibold uppercase ${
                      isYes ? "text-pump-green" : "text-[#ff5c73]"
                    }`}
                  >
                    {name}
                  </span>
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      isYes ? "text-pump-green" : "text-[#ff5c73]"
                    }`}
                  >
                    {pct}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card-pump p-4">
          <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-xs text-gray-400">
            Loading live outcomes...
          </div>
        </div>
      )}
    </>
  );
}

/* ── Giant immersive countdown overlay ─────────────────────────────── */

type CountdownPhase = "normal" | "warning" | "panic";

function fmtMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    safe % 60
  ).padStart(2, "0")}`;
}

// Compact circular HUD — sports-broadcast style. Smaller diameter, thinner
// ring, dark glass disc behind the time label. Phase tints both the ring
// and the label; panic phase pulses; final 5 s scales up with intensified
// glow. Position is set by the parent so the parent can place it on the
// video region (not the whole slide).
function CircularCountdownHUD({
  label,
  phase,
  isFinal,
  progress,
}: {
  label: string;
  phase: CountdownPhase;
  isFinal: boolean;
  progress: number;
}) {
  const SIZE = 100;
  const STROKE = 3.5;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const safeProgress = Math.max(0, Math.min(1, progress));

  const ringStroke =
    phase === "panic"
      ? "#f87171"
      : phase === "warning"
      ? "#fcd34d"
      : "#6dffa4";

  const labelColor =
    phase === "panic"
      ? "text-red-400"
      : phase === "warning"
      ? "text-amber-300"
      : "text-white";

  const dropShadow =
    phase === "panic"
      ? isFinal
        ? "drop-shadow(0 0 18px rgba(248,113,113,0.85))"
        : "drop-shadow(0 0 12px rgba(248,113,113,0.7))"
      : phase === "warning"
      ? "drop-shadow(0 0 10px rgba(252,211,77,0.55))"
      : "drop-shadow(0 0 6px rgba(109,255,164,0.4))";

  const labelShadow =
    phase === "panic"
      ? "0 0 10px rgba(248,113,113,0.55)"
      : phase === "warning"
      ? "0 0 8px rgba(252,211,77,0.4)"
      : "0 1px 4px rgba(0,0,0,0.7)";

  return (
    <div
      className={`relative transition-all duration-500 ease-out ${
        phase === "panic" ? "animate-pulse" : ""
      }`}
      style={{
        width: "clamp(88px, 24vw, 116px)",
        aspectRatio: "1 / 1",
        filter: dropShadow,
        transform: isFinal ? "scale(1.06)" : "scale(1)",
      }}
    >
      {/* Glass disc — sits inside the ring for label readability */}
      <div className="absolute inset-[5px] rounded-full bg-black/60 backdrop-blur-md ring-1 ring-white/5" />
      <svg
        className="relative"
        width="100%"
        height="100%"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={ringStroke}
          strokeWidth={STROKE}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - safeProgress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            transition: "stroke-dashoffset 1s linear, stroke 0.5s ease-out",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[8px] text-white/55 uppercase tracking-[0.22em] font-semibold leading-none mb-0.5">
          Time
        </span>
        <span
          className={`font-black tabular-nums leading-none transition-colors duration-500 ${labelColor}`}
          style={{
            fontSize: "clamp(20px, 6.2vw, 28px)",
            letterSpacing: "-0.02em",
            textShadow: labelShadow,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── LiveChartDrawer ───────────────────────────────────────────────── */
// Mobile bottom sheet that reuses the trade page's OddsHistoryChart (lazy)
// fed with the live percentages already available in the slide. Rendered as
// a sibling overlay of the slide, so opening it never remounts StreamPlayer.

function LiveChartDrawer({
  open,
  onClose,
  marketAddress,
  names,
  percentages,
  question,
}: {
  open: boolean;
  onClose: () => void;
  marketAddress: string | null;
  names: string[] | null;
  percentages: number[] | null;
  question?: string | null;
}) {
  const chartNames = useMemo(() => names?.slice(0, 2) ?? [], [names]);
  const chartPct = percentages?.slice(0, 2);
  const outcomesCount = chartNames.length;

  // Historical odds series — same pipeline as /trade/[id]: replay the market's
  // transactions into an odds curve. Loaded only when the drawer opens
  // (one fetch per open — never polled).
  const [history, setHistory] = useState<{ t: number; pct: number[] }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Lock background scroll while open — mirrors MobileBuySheet behaviour.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Resolve the Supabase market id from the on-chain address, then build the
  // odds history exactly like the trade page does.
  useEffect(() => {
    if (!open || !marketAddress || outcomesCount <= 0) return;
    let cancelled = false;
    setLoadingHistory(true);
    (async () => {
      try {
        const db = await getMarketByAddress(marketAddress);
        const dbId = db?.id;
        if (!dbId) {
          if (!cancelled) setHistory([]);
          return;
        }
        const { data, error } = await supabase
          .from("transactions")
          .select("created_at,is_buy,amount,outcome_index,is_yes,shares")
          .eq("market_id", dbId)
          .order("created_at", { ascending: true })
          .limit(2000);
        if (error) {
          if (!cancelled) setHistory([]);
          return;
        }
        const pts = buildOddsSeries((data as any[]) || [], outcomesCount);
        const lite = downsample(pts, 220).map((p) => ({ t: p.t, pct: p.pct }));
        if (!cancelled) setHistory(lite);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, marketAddress, outcomesCount]);

  if (!open) return null;

  const hasData = outcomesCount > 0;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close chart"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-pump-dark border-t border-gray-800 rounded-t-2xl p-4 pb-6 animate-slideUp">
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-3" />

        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-white font-bold text-base leading-tight">
              Market Chart
            </h3>
            {question && (
              <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">
                {question}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/70 active:scale-95 active:text-white transition"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!hasData ? (
          <div className="h-[260px] flex flex-col items-center justify-center text-center gap-1">
            <p className="text-sm text-gray-400">No chart data yet</p>
            <p className="text-xs text-gray-600">
              Live odds will appear here once trading starts.
            </p>
          </div>
        ) : loadingHistory && history.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center">
            <span className="w-6 h-6 rounded-full border-2 border-pump-green/40 border-t-pump-green animate-spin" />
          </div>
        ) : (
          <div className="rounded-xl bg-black/40 border border-white/[0.06] p-2">
            <LiveOddsChart
              points={history}
              outcomeNames={chartNames}
              livePct={history.length ? chartPct : undefined}
              liveEnabled
              height={260}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── MobileImmersiveSlide ──────────────────────────────────────────── */
// Shared full-bleed mobile immersive experience: persistent stream,
// giant countdown overlay, title, YES/NO bottom action bar.
// Used by /live/[id] (variant="deeplink") and /live (variant="feed").

export type MobileImmersiveSlideMarket = {
  question?: string;
  resolutionTime?: number; // unix seconds
  totalVolume?: number;
  publicKey?: string;
};

export function MobileImmersiveSlide({
  session,
  market,
  derived,
  active,
  sessionLocked,
  onOutcomeTap,
  endIsoOverride = null,
  countText = null,
  variant = "deeplink",
  hostSlot,
}: {
  session: LiveSession;
  market: MobileImmersiveSlideMarket | null;
  derived: { names: string[]; percentages: number[] } | null;
  active: boolean;
  sessionLocked: boolean;
  onOutcomeTap: (outcomeIndex: number) => void;
  endIsoOverride?: string | null;
  countText?: string | null;
  variant?: "deeplink" | "feed";
  hostSlot?: ReactNode;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Market Chart drawer — local to the slide so toggling it never touches the
  // StreamPlayer subtree (which stays the first slide-root child).
  const [chartOpen, setChartOpen] = useState(false);
  // Tracks the largest remaining-seconds value we've seen for this slide;
  // used as the denominator for the circular HUD progress arc so it sweeps
  // from full at session entry down to empty at lockout.
  const peakRemSecRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [active]);

  const countdown = useMemo(() => {
    const endStr =
      endIsoOverride ??
      (market?.resolutionTime
        ? new Date(market.resolutionTime * 1000).toISOString()
        : null);
    if (!endStr) return null;
    const endMs = new Date(endStr).getTime();
    if (!Number.isFinite(endMs)) return null;
    const remSec = Math.max(0, Math.ceil((endMs - nowMs) / 1000));

    if (peakRemSecRef.current == null || remSec > peakRemSecRef.current) {
      peakRemSecRef.current = Math.max(remSec, 60);
    }
    const peak = peakRemSecRef.current || 60;
    const progress = peak > 0 ? remSec / peak : 0;

    const phase: CountdownPhase =
      remSec <= 10 ? "panic" : remSec <= 30 ? "warning" : "normal";
    return {
      remSec,
      label: fmtMmSs(remSec),
      phase,
      isFinal: remSec <= 5,
      progress,
    };
  }, [endIsoOverride, market?.resolutionTime, nowMs]);

  const isDeeplink = variant === "deeplink";

  const volLabel =
    market?.totalVolume && market.totalVolume > 0
      ? `${formatVol(market.totalVolume)} SOL`
      : null;

  // Approximate per-side volume from share-percentage × total volume.
  // Not a perfect mapping (volume is trade-flow, percentages are state)
  // but it carries the right visual weight per side.
  const perSideSol = (idx: number): string | null => {
    if (!market?.totalVolume || market.totalVolume <= 0) return null;
    const pct = derived?.percentages?.[idx] ?? 0;
    return `${formatVol((market.totalVolume * pct) / 100)} SOL`;
  };

  // Higher-percentage side — drives the Momentum strip placeholder label.
  // Pure render computation (no state / effect / timer).
  const momentumYes =
    (derived?.percentages?.[0] ?? 0) >= (derived?.percentages?.[1] ?? 0);

  // Top-traders widget — no trader list is exposed to this component, so the
  // avatar is derived from the real host wallet (the one identity we have)
  // and the count stays a soft placeholder. Pure render computation.
  const hostInitials = (session.host_wallet || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();

  // Pin layout heights so the stream wrapper (absolute) and the structured
  // stack's top spacer (in-flow) line up exactly — the stream sits flush
  // under the top controls, no dead black space.
  const TOP_BAR_H = isDeeplink ? "h-10" : "h-14"; // 40 / 56 px
  const STREAM_TOP = isDeeplink ? "top-10" : "top-14";

  return (
    <div className="relative h-full bg-black overflow-hidden">
      {/* STREAM — slide-root[0]. Same React tree position as before; only
          its bounding box shrinks from inset-0 to aspect-video. The 16:9
          iframe now fills a 16:9 container exactly → no letterbox bars. */}
      <div
        className={`absolute inset-x-0 ${STREAM_TOP} aspect-video bg-black`}
      >
        {active && session.stream_url ? (
          <StreamPlayer
            url={session.stream_url}
            className="absolute inset-0 w-full h-full bg-black"
          />
        ) : session.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.thumbnail_url}
            alt={session.title}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.12),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
        )}
      </div>

      {/* STRUCTURED STACK — slide-root[1]. Top bar (fixed height matching
          the stream's top offset) + aspect-video overlay region for HUD
          chips (transparent, the stream below shows through) + lower
          section that overlaps the video bottom and fades to black. */}
      <div className="relative h-full flex flex-col">
        {/* Top bar — fixed height. Deeplink shows back link; feed reserves
            space for the floating MobileTabs above. */}
        <div
          className={`shrink-0 ${TOP_BAR_H} ${
            isDeeplink ? "px-4 flex items-center" : ""
          }`}
        >
          {isDeeplink && (
            <Link
              href="/live"
              className="inline-flex items-center gap-1 text-sm text-white/75 active:text-white transition"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-4 h-4"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </Link>
          )}
        </div>

        {/* VIDEO OVERLAY REGION — transparent aspect-video band aligned
            with the stream wrapper. Anchors the floating HUD elements. */}
        <div className="shrink-0 relative w-full aspect-video">
          {/* LIVE / status pill (top-left, broadcast-style) */}
          <div className="absolute top-3 left-3 z-20 pointer-events-none">
            {session.status === "live" ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/40 border border-red-500/50 backdrop-blur-md">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-300 tracking-[0.15em]">
                  LIVE
                </span>
              </div>
            ) : (
              <StatusBanner status={session.status} />
            )}
          </div>

          {/* Count pill — for flash_traffic etc. Below LIVE pill. */}
          {countText && (
            <div className="absolute top-12 left-3 z-20 pointer-events-none">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-black/60 backdrop-blur-md text-white/85 border border-white/10">
                <span className="opacity-70">Count</span>
                <span className="tabular-nums">{countText}</span>
              </span>
            </div>
          )}

          {/* Compact circular timer — purely overlaid, never affects flow.
              Lifted above the video's top edge (center column is free of the
              feed's left toggle / right Go Live). */}
          {countdown && (
            <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 z-30">
              <CircularCountdownHUD
                label={countdown.label}
                phase={countdown.phase}
                isFinal={countdown.isFinal}
                progress={countdown.progress}
              />
            </div>
          )}

          {/* Host controls (top-right) — floating HUD chip */}
          {hostSlot && (
            <div className="absolute top-2 right-2 z-30 pointer-events-auto">
              {hostSlot}
            </div>
          )}

          {/* Top traders — floating placeholder pill. Rendered only when no
              host controls occupy the top-right, so it never blocks them or
              the feed's Go Live button. Purely visual. */}
          {!hostSlot && (
            <div className="absolute top-2 right-2 z-20 pointer-events-none">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/45 whitespace-nowrap">
                  Top traders
                </span>
                {hostInitials ? (
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-pump-green/80 to-emerald-700 border border-black text-[7px] font-black text-black leading-none">
                    {hostInitials}
                  </span>
                ) : (
                  <span className="w-4 h-4 rounded-full bg-gradient-to-br from-pump-green/80 to-emerald-700 border border-black" />
                )}
                <span className="text-[9px] font-bold tabular-nums text-white/85">
                  +32
                </span>
              </div>
            </div>
          )}
        </div>

        {/* LOWER SECTION — overlaps the video's last 24 px and fades to
            fully opaque black underneath. flex-1 lets the trailing empty
            zone host future Up Next / activity strip without layout work. */}
        <div className="relative -mt-6 z-20 flex-1 flex flex-col bg-gradient-to-b from-transparent via-black/85 to-black">
          {/* MARKET CARD — LIVE pill + total vol header, question,
              horizontal progress bar with VS bubble, per-side volume. */}
          <div className="mx-3 rounded-2xl border border-white/[0.08] bg-black/85 backdrop-blur-xl px-4 pt-3 pb-3 shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_18px_0_44px_-32px_rgba(109,255,164,0.6),inset_-18px_0_44px_-32px_rgba(255,92,115,0.6)]">
            <div className="flex items-center justify-between mb-2">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-pump-green/15 border border-pump-green/30">
                <span className="w-1 h-1 rounded-full bg-pump-green shadow-[0_0_6px_rgba(109,255,164,0.8)]" />
                <span className="text-[9px] text-pump-green uppercase tracking-[0.18em] font-bold">
                  Live Market
                </span>
              </div>
              <div className="flex items-center gap-2">
                {volLabel && (
                  <span className="text-[10px] text-gray-500 font-medium tabular-nums tracking-wider uppercase">
                    {volLabel} Vol
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  {/* Chart — opens the Market Chart drawer */}
                  <button
                    type="button"
                    aria-label="Open market chart"
                    onClick={() => setChartOpen(true)}
                    className="flex items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/[0.04] text-white/70 active:scale-95 active:text-white transition"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M3 3v18h18" />
                      <path d="M7 16v-4" />
                      <path d="M12 16V8" />
                      <path d="M17 16v-7" />
                    </svg>
                  </button>
                  {/* Activity — inactive placeholder (future drawer) */}
                  <button
                    type="button"
                    disabled
                    aria-label="Activity (coming soon)"
                    className="flex items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/[0.04] text-white/30 cursor-not-allowed"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M3 12h4l3 8 4-16 3 8h4" />
                    </svg>
                  </button>
                  {/* Messages — inactive placeholder (future drawer) */}
                  <button
                    type="button"
                    disabled
                    aria-label="Messages (coming soon)"
                    className="flex items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/[0.04] text-white/30 cursor-not-allowed"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  {/* Share — premium box-arrow glyph */}
                  <button
                    type="button"
                    aria-label="Share market"
                    onClick={() => {
                      const pk = market?.publicKey;
                      if (!pk || typeof window === "undefined") return;
                      const url = `${window.location.origin}/trade/${pk}`;
                      if (navigator.share) {
                        navigator
                          .share({ title: market?.question || session.title, url })
                          .catch(() => {});
                      } else {
                        navigator.clipboard?.writeText(url).catch(() => {});
                      }
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/[0.04] text-white/70 active:scale-95 active:text-white transition"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M12 15V3" />
                      <path d="M8 7l4-4 4 4" />
                      <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <h2 className="text-white font-bold text-[16px] leading-snug line-clamp-2 mb-2.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
              {market?.question || session.title}
            </h2>

            {derived ? (
              <>
                {/* Continuous horizontal progress bar. Wrapper is non-clipping
                    so the VS bubble can straddle the bar's lower edge. */}
                <div className="relative">
                <div className="relative flex rounded-xl overflow-hidden h-10 border border-white/[0.06]">
                  {derived.names.slice(0, 2).map((name, idx) => {
                    const pctNum = derived.percentages[idx] ?? 0;
                    const pct = pctNum.toFixed(1);
                    const isYes = idx === 0;
                    return (
                      <div
                        key={idx}
                        className={`relative flex items-center h-full overflow-hidden ${
                          isYes
                            ? "bg-pump-green pl-3 justify-start"
                            : "bg-[#ff5c73] pr-3 justify-end"
                        }`}
                        style={{
                          flexBasis: `${Math.max(0, Math.min(100, pctNum))}%`,
                          minWidth: 0,
                        }}
                      >
                        <span
                          className={`text-[13px] font-bold whitespace-nowrap ${
                            isYes ? "text-black" : "text-white"
                          }`}
                        >
                          {isYes ? (
                            <>
                              {name}{" "}
                              <span className="font-black tabular-nums">
                                {pct}%
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="font-black tabular-nums">
                                {pct}%
                              </span>{" "}
                              {name}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                  {/* VS bubble — sits at the real YES/NO junction (left =
                      YES%), clamped so it never leaves the bar, straddling the
                      lower edge with a clean premium glow. */}
                  <div
                    className="pointer-events-none absolute bottom-0 -translate-x-1/2 translate-y-1/2 z-10 w-7 h-7 rounded-full bg-gradient-to-b from-zinc-700 to-black border border-white/30 ring-2 ring-black flex items-center justify-center shadow-[0_2px_10px_rgba(0,0,0,0.7),0_0_14px_rgba(255,255,255,0.12)]"
                    style={{
                      left: `${Math.max(
                        8,
                        Math.min(92, derived.percentages[0] ?? 50)
                      )}%`,
                    }}
                  >
                    <span className="text-[9px] font-black text-white tracking-[0.12em]">
                      VS
                    </span>
                  </div>
                </div>

                {/* Per-side approximate volume row */}
                {volLabel && (
                  <div className="flex items-center justify-between mt-2 px-1">
                    <span className="text-[11px] text-pump-green/75 font-semibold tabular-nums">
                      {perSideSol(0)}
                    </span>
                    <span className="text-[11px] text-[#ff5c73]/75 font-semibold tabular-nums">
                      {perSideSol(1)}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="h-10 rounded-xl bg-white/5 border border-white/10 animate-pulse" />
            )}
          </div>

          {/* CSS-only shimmer used by the momentum strip (no JS loop). The
              <style> tag is display:none and never participates in layout. */}
          <style>{`
            .fm-mom-shimmer{background:linear-gradient(100deg,transparent 38%,rgba(255,255,255,0.10) 50%,transparent 62%);transform:translateX(-100%);animation:fm-mom-sweep 5s ease-in-out infinite;will-change:transform}
            @keyframes fm-mom-sweep{0%{transform:translateX(-100%)}55%,100%{transform:translateX(100%)}}
            @media (prefers-reduced-motion:reduce){.fm-mom-shimmer{animation:none}}
          `}</style>

          {/* HUD STRIPS — visual placeholders between the market card and the
              action panels. Reserve the eventual Momentum and Up Next rows.
              Pure presentational; no data or effects wired yet. */}
          <div className="px-3 mt-3 space-y-2">
            {/* Momentum / tension strip — gradient edge (green→amber→red),
                soft colored edge-glow, and a CSS-only shimmer sweep. */}
            <div className="relative rounded-lg p-px bg-[linear-gradient(90deg,rgba(109,255,164,0.65),rgba(252,211,77,0.6),rgba(255,92,115,0.65))] shadow-[-5px_0_18px_-9px_rgba(109,255,164,0.55),0_0_16px_-9px_rgba(252,211,77,0.45),5px_0_18px_-9px_rgba(255,92,115,0.55)]">
              <div className="relative overflow-hidden rounded-[7px] bg-black/85 px-3 py-1.5">
                <span
                  aria-hidden
                  className="fm-mom-shimmer pointer-events-none absolute inset-0"
                />
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        momentumYes
                          ? "bg-pump-green shadow-[0_0_6px_rgba(109,255,164,0.8)]"
                          : "bg-[#ff5c73] shadow-[0_0_6px_rgba(255,92,115,0.8)]"
                      }`}
                    />
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${
                        momentumYes ? "text-pump-green" : "text-[#ff5c73]"
                      }`}
                    >
                      Momentum: {momentumYes ? "YES" : "NO"}
                    </span>
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.6)] whitespace-nowrap">
                    High Tension
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 whitespace-nowrap">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-red-300">
                      Final
                    </span>
                    {countdown?.label && (
                      <span className="text-[9px] font-bold tabular-nums text-red-200">
                        {countdown.label}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Up Next market strip — reserved module: left status badge,
                eyebrow + question, and a 3-min-market pill. */}
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-3">
              <div className="shrink-0 w-10 h-10 rounded-full border-2 border-pump-green/35 flex items-center justify-center shadow-[0_0_14px_-4px_rgba(109,255,164,0.5)]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-pump-green/80"
                >
                  <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                  Up Next (Preparing…)
                </div>
                <div className="text-[13px] font-semibold text-white/70 leading-snug line-clamp-2">
                  Next flash market coming soon
                </div>
              </div>
              <span className="shrink-0 self-start inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pump-green/10 border border-pump-green/25 text-[9px] font-bold uppercase tracking-wider text-pump-green/80">
                3 Min Market
              </span>
            </div>
          </div>

          {/* Flexible gap — pushes the action panels lower without dead space. */}
          <div className="flex-[1.5] min-h-[10px]" aria-hidden />

          {/* ACTION CARDS — compact HUD action panels. Fixed h-[88px] and
              shrink-0, anchored lower in the slide (slightly shorter to make
              room for the taller Up Next module). */}
          <div className="px-3 pb-3 shrink-0">
            {derived && !sessionLocked ? (
              <div className="grid grid-cols-2 gap-3 h-[88px]">
                {derived.names.slice(0, 2).map((name, idx) => {
                  const pct = (derived.percentages[idx] ?? 0).toFixed(1);
                  const isYes = idx === 0;
                  return (
                    <button
                      key={idx}
                      onClick={() => onOutcomeTap(idx)}
                      className={`group relative h-full overflow-hidden rounded-2xl border backdrop-blur-xl px-3.5 py-2 active:scale-[0.97] transition-all duration-150 ${
                        isYes
                          ? "bg-gradient-to-br from-pump-green/25 via-pump-green/10 to-pump-green/5 border-pump-green/50 shadow-[0_0_36px_-8px_rgba(109,255,164,0.45)]"
                          : "bg-gradient-to-br from-[#ff5c73]/25 via-[#ff5c73]/10 to-[#ff5c73]/5 border-[#ff5c73]/50 shadow-[0_0_36px_-8px_rgba(255,92,115,0.45)]"
                      }`}
                    >
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: isYes
                            ? "radial-gradient(circle at 50% -20%, rgba(109,255,164,0.3), transparent 65%)"
                            : "radial-gradient(circle at 50% -20%, rgba(255,92,115,0.3), transparent 65%)",
                        }}
                      />
                      <div className="relative">
                        <div
                          className={`font-black tracking-tight leading-none ${
                            isYes ? "text-pump-green" : "text-[#ff5c73]"
                          }`}
                          style={{
                            fontSize: "clamp(28px, 8.5vw, 38px)",
                            textShadow: isYes
                              ? "0 0 18px rgba(109,255,164,0.55)"
                              : "0 0 18px rgba(255,92,115,0.55)",
                          }}
                        >
                          {name}
                        </div>
                        <div
                          className={`text-sm font-bold tabular-nums mt-0.5 ${
                            isYes ? "text-pump-green/85" : "text-[#ff5c73]/85"
                          }`}
                        >
                          {pct}%
                        </div>
                      </div>
                      {/* Arrow chip — absolutely placed so it doesn't push
                          the typography */}
                      <div
                        className={`absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center ${
                          isYes
                            ? "bg-pump-green shadow-[0_0_14px_rgba(109,255,164,0.55)]"
                            : "bg-[#ff5c73] shadow-[0_0_14px_rgba(255,92,115,0.55)]"
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          className={`w-3 h-3 ${
                            isYes ? "text-black" : "text-white"
                          }`}
                        >
                          <path d="M12 19V5" />
                          <path d="M5 12l7-7 7 7" />
                        </svg>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : sessionLocked ? (
              <div className="h-20 flex items-center justify-center rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md">
                <p className="text-sm text-gray-400">Trading is locked</p>
              </div>
            ) : (
              <div className="h-20 flex items-center justify-center rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md">
                <p className="text-sm text-gray-500 animate-pulse">
                  Loading market...
                </p>
              </div>
            )}
          </div>

          {/* Trailing spacer — keeps the action panels off the bottom nav. */}
          <div className="flex-1 min-h-[8px]" aria-hidden />
        </div>
      </div>

      {/* Market Chart drawer — last slide-root child so the StreamPlayer above
          is never reordered/remounted when it opens. */}
      <LiveChartDrawer
        open={chartOpen}
        onClose={() => setChartOpen(false)}
        marketAddress={market?.publicKey ?? null}
        names={derived?.names ?? null}
        percentages={derived?.percentages ?? null}
        question={market?.question ?? session.title}
      />
    </div>
  );
}
