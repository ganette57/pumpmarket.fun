// src/app/live/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef, type UIEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  listLiveSessions,
  subscribeLiveSessionsList,
  type LiveSession,
} from "@/lib/liveSessions";
import { useProgram } from "@/hooks/useProgram";
import {
  getMarketByAddress,
  recordTransaction,
  applyTradeToMarketInSupabase,
} from "@/lib/markets";
import {
  getUserPositionPDA,
  PLATFORM_WALLET,
  lamportsToSol,
  solToLamports,
} from "@/utils/solana";
import { sendSignedTx } from "@/lib/solanaSend";

type DesktopTab = "live" | "feed";
type MobileTab = "live" | "explore";

type MobileMarketSnapshot = {
  sessionId: string;
  dbId?: string;
  publicKey: string;
  creator: string;
  question: string;
  totalVolume: number;
  resolved: boolean;
  isBlocked: boolean;
  bLamports?: number;
  marketType: 0 | 1;
  outcomeNames: string[];
  outcomeSupplies: number[];
  yesSupply: number;
  noSupply: number;
};

function useIsMobile(bp = 1024) {
  const [m, setM] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${bp - 1}px)`);
    const onChange = () => setM(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [bp]);

  return m;
}

function shortWallet(value: string) {
  const safe = String(value || "");
  if (safe.length <= 10) return safe;
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, v));
}

function toStringArray(x: any): string[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  if (typeof x === "string") {
    try {
      const p = JSON.parse(x);
      if (Array.isArray(p)) return p.map((v) => String(v)).filter(Boolean);
    } catch {}
  }
  return undefined;
}

function toNumberArray(x: any): number[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => Number(v) || 0);
  if (typeof x === "string") {
    try {
      const p = JSON.parse(x);
      if (Array.isArray(p)) return p.map((v) => Number(v) || 0);
    } catch {}
  }
  return undefined;
}

function parseBLamports(m: any): number | null {
  const direct =
    m?.b_lamports ??
    m?.bLamports ??
    m?.liquidity_lamports ??
    m?.liquidity_param_lamports;
  if (direct != null && Number(direct) > 0) return Math.floor(Number(direct));

  const sol = m?.b_sol ?? m?.bSol ?? m?.liquidity_sol ?? m?.liquidity_param_sol;
  if (sol != null && Number(sol) > 0) return solToLamports(Number(sol));

  return solToLamports(0.01);
}

function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
}

function deriveOutcomeDisplay(
  snapshot: MobileMarketSnapshot | null | undefined
) {
  if (!snapshot) {
    return {
      names: ["YES", "NO"],
      supplies: [0, 0],
      percentages: [50, 50],
    };
  }

  let names = (snapshot.outcomeNames || []).map(String).filter(Boolean);
  if (snapshot.marketType === 0 && names.length !== 2) names = ["YES", "NO"];
  if (names.length === 0) names = ["YES", "NO"];

  let supplies = Array.isArray(snapshot.outcomeSupplies)
    ? snapshot.outcomeSupplies.map((x) => Number(x || 0))
    : [];

  if (supplies.length < names.length) {
    if (snapshot.marketType === 0 && names.length === 2) {
      supplies = [
        Number(snapshot.yesSupply || 0),
        Number(snapshot.noSupply || 0),
      ];
    } else {
      supplies = [
        ...supplies,
        ...Array(Math.max(0, names.length - supplies.length)).fill(0),
      ];
    }
  }

  const total = supplies.reduce((sum, x) => sum + x, 0);
  const percentages = supplies.map((s) =>
    total > 0 ? (s / total) * 100 : 100 / (supplies.length || 1)
  );

  return { names, supplies, percentages };
}

function streamEmbedUrl(url: string, autoplay = false) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  const ytMatch = raw.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([\w-]+)/
  );
  if (ytMatch?.[1]) {
    const auto = autoplay ? "1" : "0";
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=${auto}&mute=1&playsinline=1&rel=0&modestbranding=1`;
  }

  const twitchMatch = raw.match(/twitch\.tv\/(\w+)/);
  if (twitchMatch?.[1]) {
    const auto = autoplay ? "true" : "false";
    const parent =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${parent}&autoplay=${auto}&muted=true`;
  }

  const kickMatch = raw.match(/kick\.com\/(\w+)/);
  if (kickMatch?.[1]) return `https://player.kick.com/${kickMatch[1]}`;

  return raw;
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      Live
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "live") return <LiveBadge />;

  const map: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: {
      bg: "bg-yellow-600/80",
      text: "text-white",
      label: "Scheduled",
    },
    locked: { bg: "bg-orange-600/80", text: "text-white", label: "Locked" },
    ended: { bg: "bg-gray-600/80", text: "text-gray-200", label: "Ended" },
    resolved: { bg: "bg-pump-green/80", text: "text-black", label: "Resolved" },
    cancelled: {
      bg: "bg-gray-700/80",
      text: "text-gray-300",
      label: "Cancelled",
    },
  };
  const s = map[status] || map.ended!;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function SessionCard({ session }: { session: LiveSession }) {
  return (
    <Link href={`/live/${session.id}`} className="block group">
      <article className="relative rounded-xl overflow-hidden border border-gray-800 bg-[#05070b] hover:border-pump-green hover:shadow-xl transition-all h-full">
        <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          {session.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.thumbnail_url}
              alt={session.title}
              className="object-cover w-full h-full opacity-75 group-hover:opacity-90 transition"
            />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-gray-900 via-pump-dark to-black">
              <div className="relative mb-1">
                {session.status === "live" && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="w-10 h-10 text-gray-600"
                >
                  <circle cx="12" cy="12" r="2" />
                  <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
                  <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
                </svg>
              </div>
              <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wider">
                Stream
              </span>
            </div>
          )}

          <div className="absolute top-2 left-2">
            <StatusBadge status={session.status} />
          </div>

          <div className="absolute inset-0 bg-gradient-to-t from-[#05070b] via-transparent pointer-events-none" />
        </div>

        <div className="p-3">
          <h3 className="font-semibold text-white text-sm leading-tight line-clamp-2 group-hover:text-pump-green transition">
            {session.title}
          </h3>
          <p className="text-[11px] text-gray-500 mt-1 truncate">
            {shortWallet(session.host_wallet)}
          </p>
        </div>
      </article>
    </Link>
  );
}

function MobileTabs({
  tab,
  onTabChange,
  onGoLive,
  connected,
}: {
  tab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onGoLive: () => void;
  connected: boolean;
}) {
  return (
    <div className="absolute top-4 inset-x-0 z-40 px-3 pointer-events-none">
      <div className="mx-auto max-w-md flex items-center justify-between gap-2 pointer-events-auto">
        <div className="flex items-center gap-1 bg-black/65 rounded-full p-1 border border-white/10 backdrop-blur-md">
          <button
            type="button"
            onClick={() => onTabChange("live")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              tab === "live" ? "bg-white text-black" : "text-gray-300"
            }`}
          >
            Live
          </button>
          <button
            type="button"
            onClick={() => onTabChange("explore")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              tab === "explore" ? "bg-white text-black" : "text-gray-300"
            }`}
          >
            Explore
          </button>
        </div>

        <button
          type="button"
          onClick={onGoLive}
          className="h-9 px-3 rounded-full bg-pump-green text-black text-xs font-bold shadow-[0_12px_30px_rgba(109,255,164,0.35)]"
        >
          {connected ? "Go Live" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function StatusBanner({ status }: { status: string }) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 border border-red-600/40 w-fit">
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
      className={`flex items-center gap-2 px-4 py-2 rounded-xl ${s.bg} border ${s.border} w-fit`}
    >
      <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
    </div>
  );
}

function MobileLiveTradeSlide({
  session,
  market,
  active,
  index,
  total,
  onOutcomeTap,
}: {
  session: LiveSession;
  market: MobileMarketSnapshot | null;
  active: boolean;
  index: number;
  total: number;
  onOutcomeTap: (session: LiveSession, outcomeIndex: number) => void;
}) {
  const embedUrl = streamEmbedUrl(session.stream_url, active);
  const display = deriveOutcomeDisplay(market);
  const tradingLocked =
    session.status === "locked" || !!market?.resolved || !!market?.isBlocked;

  return (
    <section className="relative h-[100dvh] snap-start bg-[linear-gradient(180deg,#030507_0%,#060a12_100%)]">
      <div className="h-full px-4 pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <div className="space-y-4">
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
            {active && embedUrl ? (
              <iframe
                src={embedUrl}
                className="absolute inset-0 w-full h-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                frameBorder="0"
                title={`Live stream ${session.title}`}
              />
            ) : session.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.thumbnail_url}
                alt={session.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.2),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
            )}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-white leading-tight break-words">
                {session.title}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Host: {shortWallet(session.host_wallet)}
              </p>
            </div>
            <div className="shrink-0 text-[11px] text-gray-500 pt-1">
              {index + 1}/{total}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <StatusBanner status={session.status} />
            <Link
              href={`/live/${session.id}`}
              className="text-[11px] text-pump-green font-semibold"
            >
              Details
            </Link>
          </div>

          {market ? (
            <div className="card-pump p-4">
              <div className="flex items-center gap-3 mb-3">
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

              <div className="grid grid-cols-2 gap-2">
                {display.names.slice(0, 2).map((name, idx) => {
                  const pct = (display.percentages[idx] ?? 0).toFixed(1);
                  const isYes = idx === 0;
                  return (
                    <button
                      key={`${name}-${idx}`}
                      onClick={() => onOutcomeTap(session, idx)}
                      disabled={tradingLocked}
                      className={`text-left rounded-xl px-4 py-3 border bg-pump-dark/80 transition ${
                        isYes ? "border-pump-green/40" : "border-[#ff5c73]/40"
                      } ${
                        tradingLocked
                          ? "opacity-50 cursor-not-allowed"
                          : "active:scale-[0.98]"
                      }`}
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

              {tradingLocked && (
                <p className="text-[11px] text-gray-400 mt-2">
                  Trading is currently locked for this live.
                </p>
              )}
            </div>
          ) : (
            <div className="card-pump p-4">
              <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-xs text-gray-400">
                Loading live outcomes...
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MobileQuickBuySheet({
  open,
  onClose,
  market,
  connected,
  submitting,
  defaultOutcomeIndex,
  sessionLocked,
  onTrade,
}: {
  open: boolean;
  onClose: () => void;
  market: MobileMarketSnapshot;
  connected: boolean;
  submitting: boolean;
  defaultOutcomeIndex: number;
  sessionLocked: boolean;
  onTrade: (
    shares: number,
    outcomeIndex: number,
    side: "buy",
    costSol: number
  ) => void;
}) {
  const display = deriveOutcomeDisplay(market);
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const presets = [0.01, 0.1, 1];

  useEffect(() => {
    if (!open) return;
    setSelectedOutcome(
      clampInt(defaultOutcomeIndex, 0, Math.max(display.names.length - 1, 0))
    );
    setAmount(0);
  }, [defaultOutcomeIndex, display.names.length, open]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none">
      <button
        className="absolute inset-x-0 top-0 bottom-14 bg-black/60 pointer-events-auto"
        onClick={onClose}
        aria-label="Close quick buy"
      />

      <div className="absolute bottom-14 inset-x-0 bg-pump-dark border-t border-gray-800 rounded-t-2xl p-5 pb-8 pointer-events-auto">
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

            {display.names.length > 0 && (
              <>
                <p className="text-sm text-gray-400 mb-2">Outcome</p>
                <div className="flex gap-2 mb-4">
                  {display.names.slice(0, 4).map((name, idx) => (
                    <button
                      key={`${name}-${idx}`}
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

export default function LivePage() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const { setVisible } = useWalletModal();
  const router = useRouter();
  const isMobile = useIsMobile(1024);

  const [desktopTab, setDesktopTab] = useState<DesktopTab>("live");
  const [mobileTab, setMobileTab] = useState<MobileTab>("live");
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileLiveIndex, setMobileLiveIndex] = useState(0);

  const [mobileMarketBySession, setMobileMarketBySession] = useState<
    Record<string, MobileMarketSnapshot>
  >({});

  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [mobileTradeSessionId, setMobileTradeSessionId] = useState<
    string | null
  >(null);
  const [mobileTradeOutcomeIndex, setMobileTradeOutcomeIndex] = useState(0);
  const [submittingTrade, setSubmittingTrade] = useState(false);

  const liveScrollerRef = useRef<HTMLDivElement | null>(null);
  const inFlightTradeRef = useRef(false);

  const handleGoLive = useCallback(() => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    router.push("/live/new");
  }, [publicKey, router, setVisible]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLiveSessions();
      setSessions(data);
    } catch (e) {
      console.error("Failed to load live sessions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const unsubscribe = subscribeLiveSessionsList((session, eventType) => {
      setSessions((prev) => {
        if (eventType === "DELETE") {
          return prev.filter((s) => s.id !== session.id);
        }
        if (eventType === "INSERT") {
          return [session, ...prev];
        }
        return prev.map((s) => (s.id === session.id ? session : s));
      });
    });
    return unsubscribe;
  }, []);

  const desktopLiveSessions = sessions.filter(
    (s) => s.status === "live" || s.status === "scheduled"
  );
  const desktopDisplaySessions =
    desktopTab === "live" ? desktopLiveSessions : sessions;

  const mobileActiveSessions = sessions.filter(
    (s) => s.status === "live" || s.status === "locked"
  );

  const loadSessionMarketSnapshot = useCallback(
    async (session: LiveSession) => {
      if (!session.market_address) return null;
      try {
        const dbMarket = await getMarketByAddress(session.market_address);
        if (!dbMarket) return null;

        const marketType = Number(dbMarket.market_type) === 1 ? 1 : 0;
        let outcomeNames = toStringArray(dbMarket.outcome_names) ?? [];
        if (marketType === 0 && outcomeNames.length !== 2)
          outcomeNames = ["YES", "NO"];
        if (outcomeNames.length === 0) outcomeNames = ["YES", "NO"];

        let outcomeSupplies = toNumberArray(dbMarket.outcome_supplies) ?? [];
        if (outcomeSupplies.length < outcomeNames.length) {
          if (marketType === 0 && outcomeNames.length === 2) {
            outcomeSupplies = [
              Number(dbMarket.yes_supply) || 0,
              Number(dbMarket.no_supply) || 0,
            ];
          } else {
            outcomeSupplies = [
              ...outcomeSupplies,
              ...Array(outcomeNames.length - outcomeSupplies.length).fill(0),
            ];
          }
        }

        const snapshot: MobileMarketSnapshot = {
          sessionId: session.id,
          dbId: dbMarket.id || undefined,
          publicKey: String(dbMarket.market_address || session.market_address),
          creator: String(dbMarket.creator || ""),
          question: String(dbMarket.question || session.title || "Live market"),
          totalVolume: Number(dbMarket.total_volume) || 0,
          resolved: !!dbMarket.resolved,
          isBlocked: !!dbMarket.is_blocked,
          bLamports: parseBLamports(dbMarket) || undefined,
          marketType,
          outcomeNames,
          outcomeSupplies,
          yesSupply: Number(dbMarket.yes_supply) || 0,
          noSupply: Number(dbMarket.no_supply) || 0,
        };

        setMobileMarketBySession((prev) => ({
          ...prev,
          [session.id]: snapshot,
        }));
        return snapshot;
      } catch (e) {
        console.error("Failed to load market for live session:", e);
        return null;
      }
    },
    []
  );

  useEffect(() => {
    setMobileLiveIndex((prev) => {
      if (mobileActiveSessions.length === 0) return 0;
      return Math.max(0, Math.min(prev, mobileActiveSessions.length - 1));
    });
  }, [mobileActiveSessions.length]);

  useEffect(() => {
    if (!isMobile) return;
    const nextValid = new Set(mobileActiveSessions.map((s) => s.id));
    setMobileMarketBySession((prev) => {
      const out: Record<string, MobileMarketSnapshot> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (nextValid.has(k)) out[k] = v;
      }
      return out;
    });
  }, [isMobile, mobileActiveSessions]);

  useEffect(() => {
    if (!isMobile) return;
    mobileActiveSessions.forEach((session) => {
      if (!mobileMarketBySession[session.id]) {
        void loadSessionMarketSnapshot(session);
      }
    });
  }, [
    isMobile,
    mobileActiveSessions,
    mobileMarketBySession,
    loadSessionMarketSnapshot,
  ]);

  useEffect(() => {
    if (!isMobile) return;
    const active = mobileActiveSessions[mobileLiveIndex];
    if (!active) return;

    void loadSessionMarketSnapshot(active);

    const timer = setInterval(() => {
      void loadSessionMarketSnapshot(active);
    }, 10000);

    return () => clearInterval(timer);
  }, [
    isMobile,
    mobileActiveSessions,
    mobileLiveIndex,
    loadSessionMarketSnapshot,
  ]);

  const handleSelectExploreSession = useCallback(
    (index: number) => {
      const safe = Math.max(
        0,
        Math.min(index, mobileActiveSessions.length - 1)
      );
      setMobileLiveIndex(safe);
      setMobileTab("live");

      requestAnimationFrame(() => {
        const node = liveScrollerRef.current;
        if (!node) return;
        const pageHeight = node.clientHeight || window.innerHeight;
        node.scrollTo({ top: safe * pageHeight, behavior: "smooth" });
      });
    },
    [mobileActiveSessions.length]
  );

  const handleLiveScroll = useCallback(
    (evt: UIEvent<HTMLDivElement>) => {
      if (mobileTradeOpen) return;
      const node = evt.currentTarget;
      if (!node.clientHeight) return;
      const next = Math.round(node.scrollTop / node.clientHeight);
      if (next !== mobileLiveIndex) setMobileLiveIndex(next);
    },
    [mobileLiveIndex, mobileTradeOpen]
  );

  const openQuickTrade = useCallback(
    async (session: LiveSession, outcomeIndex: number) => {
      const loaded =
        mobileMarketBySession[session.id] ||
        (await loadSessionMarketSnapshot(session));
      if (!loaded) return;
      if (session.status === "locked" || loaded.isBlocked || loaded.resolved)
        return;

      setMobileTradeSessionId(session.id);
      setMobileTradeOutcomeIndex(
        clampInt(outcomeIndex, 0, Math.max(loaded.outcomeNames.length - 1, 0))
      );
      setMobileTradeOpen(true);
    },
    [mobileMarketBySession, loadSessionMarketSnapshot]
  );

  const tradeSession = mobileTradeSessionId
    ? mobileActiveSessions.find((s) => s.id === mobileTradeSessionId) || null
    : null;

  const tradeMarket = tradeSession
    ? mobileMarketBySession[tradeSession.id] || null
    : null;

  const tradeClosed =
    !tradeSession ||
    !tradeMarket ||
    tradeSession.status === "locked" ||
    tradeMarket.isBlocked ||
    tradeMarket.resolved;

  const handleTrade = useCallback(
    async (
      shares: number,
      outcomeIndex: number,
      side: "buy" | "sell",
      costSol?: number
    ) => {
      if (inFlightTradeRef.current) return;
      if (!connected || !publicKey || !signTransaction || !program) return;
      if (!tradeSession || !tradeMarket || tradeClosed) return;

      inFlightTradeRef.current = true;
      setSubmittingTrade(true);

      const safeShares = Math.max(1, Math.floor(Number(shares) || 0));
      const safeOutcome = clampInt(
        outcomeIndex,
        0,
        Math.max(tradeMarket.outcomeNames.length - 1, 0)
      );
      const outcomeName =
        tradeMarket.outcomeNames[safeOutcome] || `Outcome #${safeOutcome + 1}`;

      try {
        const marketPubkey = new PublicKey(tradeMarket.publicKey);
        const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
        const creatorPubkey = new PublicKey(tradeMarket.creator);
        const amountBn = new BN(safeShares);

        let txSig = "";

        if (side === "buy") {
          const tx = await (program as any).methods
            .buyShares(amountBn, safeOutcome)
            .accounts({
              market: marketPubkey,
              userPosition: positionPDA,
              platformWallet: PLATFORM_WALLET,
              creator: creatorPubkey,
              trader: publicKey,
              systemProgram: SystemProgram.programId,
            })
            .transaction();

          txSig = await sendSignedTx({
            connection,
            tx,
            signTx: signTransaction,
            feePayer: publicKey,
          });
        } else {
          const tx = await (program as any).methods
            .sellShares(amountBn, safeOutcome)
            .accounts({
              market: marketPubkey,
              userPosition: positionPDA,
              platformWallet: PLATFORM_WALLET,
              creator: creatorPubkey,
              trader: publicKey,
              systemProgram: SystemProgram.programId,
            })
            .transaction();

          txSig = await sendSignedTx({
            connection,
            tx,
            signTx: signTransaction,
            feePayer: publicKey,
          });
        }

        const safeCostSol =
          typeof costSol === "number" && Number.isFinite(costSol)
            ? costSol
            : null;

        try {
          if (tradeMarket.dbId) {
            await recordTransaction({
              market_id: tradeMarket.dbId,
              market_address: tradeMarket.publicKey,
              user_address: publicKey.toBase58(),
              tx_signature: txSig,
              is_buy: side === "buy",
              is_yes:
                tradeMarket.outcomeNames.length === 2
                  ? safeOutcome === 0
                  : null,
              amount: safeShares,
              shares: safeShares,
              cost: safeCostSol,
              outcome_index: safeOutcome,
              outcome_name: outcomeName,
            } as any);
          }
        } catch (e) {
          console.error("recordTransaction error:", e);
        }

        const deltaVol =
          side === "buy" && safeCostSol != null
            ? solToLamports(safeCostSol)
            : 0;
        try {
          await applyTradeToMarketInSupabase({
            market_address: tradeMarket.publicKey,
            market_type: tradeMarket.marketType,
            outcome_index: safeOutcome,
            delta_shares: side === "buy" ? safeShares : -safeShares,
            delta_volume_lamports: deltaVol,
          });
        } catch (e) {
          console.error("applyTradeToMarketInSupabase error:", e);
        }

        await loadSessionMarketSnapshot(tradeSession);
        setMobileTradeOpen(false);
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (!msg.toLowerCase().includes("user rejected")) {
          console.error("Quick trade failed:", e);
          alert(`Trade failed: ${msg || "Unknown error"}`);
        }
      } finally {
        inFlightTradeRef.current = false;
        setSubmittingTrade(false);
      }
    },
    [
      connected,
      publicKey,
      signTransaction,
      program,
      tradeSession,
      tradeMarket,
      tradeClosed,
      connection,
      loadSessionMarketSnapshot,
    ]
  );

  if (isMobile) {
    if (loading) {
      return (
        <div className="h-[100dvh] bg-black flex items-center justify-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-pump-green" />
        </div>
      );
    }

    if (mobileActiveSessions.length === 0) {
      return (
        <div className="relative h-[100dvh] bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.24),transparent_45%),linear-gradient(180deg,#020304_0%,#05080f_58%,#030406_100%)] overflow-hidden">
          <MobileTabs
            tab={mobileTab}
            onTabChange={setMobileTab}
            onGoLive={handleGoLive}
            connected={!!publicKey}
          />
          <div className="h-full px-6 pt-28 pb-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full border border-pump-green/40 bg-pump-green/10 flex items-center justify-center mb-4">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            </div>
            <h2 className="text-white text-xl font-bold">
              No live streams right now
            </h2>
            <p className="text-sm text-gray-300 mt-2 max-w-xs">
              As soon as a host goes live, you can watch and quick-trade here.
            </p>
            <button
              type="button"
              onClick={handleGoLive}
              className="mt-5 h-11 px-5 rounded-xl bg-pump-green text-black text-sm font-semibold"
            >
              {publicKey ? "Start live" : "Connect wallet"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="relative h-[100dvh] bg-[linear-gradient(180deg,#030507_0%,#060a12_100%)] overflow-hidden z-0">
          <MobileTabs
            tab={mobileTab}
            onTabChange={setMobileTab}
            onGoLive={handleGoLive}
            connected={!!publicKey}
          />

          {mobileTab === "live" ? (
            <div
              ref={liveScrollerRef}
              onScroll={mobileTradeOpen ? undefined : handleLiveScroll}
              className={`h-full overscroll-y-contain ${
                mobileTradeOpen
                  ? "overflow-hidden snap-none touch-none"
                  : "overflow-y-auto snap-y snap-mandatory"
              }`}
            >
              {mobileActiveSessions.map((session, index) => (
                <MobileLiveTradeSlide
                  key={session.id}
                  session={session}
                  market={mobileMarketBySession[session.id] || null}
                  active={index === mobileLiveIndex && !mobileTradeOpen}
                  index={index}
                  total={mobileActiveSessions.length}
                  onOutcomeTap={openQuickTrade}
                />
              ))}
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-4 pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))] bg-[linear-gradient(180deg,#040607_0%,#05080f_100%)]">
              <div className="mb-4 px-1">
                <h2 className="text-white text-lg font-bold">
                  Explore live streams
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  Pick one stream, then jump back to Live to trade.
                </p>
              </div>

              <div className="space-y-3">
                {mobileActiveSessions.map((session, index) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectExploreSession(index)}
                    className={`w-full text-left rounded-2xl border overflow-hidden ${
                      index === mobileLiveIndex
                        ? "border-pump-green/45 bg-black/70"
                        : "border-white/10 bg-black/60"
                    }`}
                  >
                    <div className="relative h-36">
                      {session.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={session.thumbnail_url}
                          alt={session.title}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.24),transparent_42%),linear-gradient(140deg,#070d18_0%,#090f1d_100%)]" />
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-black/10" />
                      <div className="absolute top-3 left-3">
                        <LiveBadge />
                      </div>
                    </div>

                    <div className="p-3">
                      <h3 className="text-white font-semibold text-sm line-clamp-2">
                        {session.title}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                        Host {shortWallet(session.host_wallet)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {mobileTradeOpen && tradeSession && tradeMarket && (
          <MobileQuickBuySheet
            open={mobileTradeOpen}
            onClose={() => setMobileTradeOpen(false)}
            market={tradeMarket}
            connected={connected}
            submitting={submittingTrade}
            defaultOutcomeIndex={mobileTradeOutcomeIndex}
            sessionLocked={tradeClosed}
            onTrade={(shares, outcomeIndex, side, costSol) =>
              void handleTrade(shares, outcomeIndex, side, costSol)
            }
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-[70vh] px-4 py-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 bg-pump-dark/60 rounded-full p-1 border border-gray-800">
          <button
            onClick={() => setDesktopTab("live")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
              desktopTab === "live"
                ? "bg-white text-black"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setDesktopTab("feed")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
              desktopTab === "feed"
                ? "bg-white text-black"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Feed
          </button>
        </div>

        <button
          type="button"
          onClick={handleGoLive}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:bg-[#74ffb8] transition"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="w-4 h-4"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          {publicKey ? "Go Live" : "Connect to Go Live"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pump-green" />
        </div>
      ) : desktopDisplaySessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl border border-pump-green/30 bg-pump-green/10 flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-8 h-8 text-pump-green"
            >
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
              <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-1">
            {desktopTab === "live" ? "No live sessions" : "No sessions yet"}
          </h2>
          <p className="text-sm text-gray-400 max-w-xs">
            {desktopTab === "live"
              ? "No one is streaming right now. Be the first to go live!"
              : "Sessions will appear here once created."}
          </p>
          <button
            type="button"
            onClick={handleGoLive}
            className="mt-4 px-6 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:bg-[#74ffb8] transition"
          >
            {publicKey ? "Start a session" : "Connect wallet to start"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {desktopDisplaySessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
