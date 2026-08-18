// src/app/live/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { useProgram } from "@/hooks/useProgram";
import TradingPanel from "@/components/TradingPanel";
import PlayTradingPanel from "@/components/PlayTradingPanel";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { useLiveMarketEconomics } from "@/components/play/useLiveMarketEconomics";
import PlayLiveBuySheet from "@/components/play/PlayLiveBuySheet";
import PlayActivity from "@/components/play/PlayActivity";
import CommentsSection from "@/components/CommentsSection";
import HostControls from "@/components/LiveHostControls";
import LiveDesktopHostPanel, {
  CreateNextLauncher,
} from "@/components/LiveDesktopHostPanel";
import LiveDesktopPastMarkets from "@/components/LiveDesktopPastMarkets";
import FlashMarketResultModal, {
  type FlashMarketResultState,
} from "@/components/FlashMarketResultModal";
import { buildRealResultValues } from "@/lib/resultPayload";
import type { PayoutQualifier, ResultMode } from "@/lib/resultCard";
import { hasSeenResult, markResultSeen, resultSeenKey } from "@/lib/resultSeen";
import { fetchPlayLiveResult, playLiveSeenKey } from "@/lib/playLiveResult";
import {
  StreamPlayer,
  StreamUnavailable,
  StatusBanner,
  MobileBuySheet,
  formatVol,
  LiveMobileContent,
  MobileImmersiveSlide,
  TradeWindowBar,
} from "@/components/LiveMobileContent";

import { supabase } from "@/lib/supabaseClient";
import { proposeLiveResolution } from "@/lib/liveResolve";
import { createLiveFlashMarket } from "@/lib/liveMarketCreate";
import {
  deriveTradeWindowState,
  parseTimestampMs,
} from "@/lib/liveFlashWindows";
import { getMarketByAddress, recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";
import {
  getLiveSession,
  subscribeLiveSession,
  fetchRecentTrades,
  subscribeRecentTrades,
  fetchQueuedNextMarketConfig,
  serializeQueuedNextMarketConfig,
  type LiveSession,
  type LiveSessionStatus,
  type RecentTrade,
  type QueuedNextMarketConfig,
} from "@/lib/liveSessions";

import { lamportsToSol, solToLamports, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";
import { sendSignedTx } from "@/lib/solanaSend";
import bs58 from "bs58";

/* ── helpers ────────────────────────────────────────────────────────── */

function useIsMobile(bp = 1024) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${bp - 1}px)`);
    const h = () => setM(mq.matches);
    h();
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, [bp]);
  return m;
}

function parseEndDateMs(raw: any): number {
  if (!raw) return NaN;
  if (raw instanceof Date) return raw.getTime();
  const s = String(raw).trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59Z`).getTime();
  // Supabase timestamps often come back without a timezone suffix. Treat
  // them as UTC (append Z) instead of letting `new Date` assume local time —
  // otherwise short live markets shift hours off and read as 00:00.
  const normalized = s.includes(" ") ? s.replace(" ", "T") : s;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  return new Date(hasTz ? normalized : `${normalized}Z`).getTime();
}

function toNumberArray(x: any): number[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => Number(v) || 0);
  if (typeof x === "string") {
    try { const p = JSON.parse(x); if (Array.isArray(p)) return p.map((v) => Number(v) || 0); } catch {}
  }
  return undefined;
}

function toStringArray(x: any): string[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  if (typeof x === "string") {
    try { const p = JSON.parse(x); if (Array.isArray(p)) return p.map((v) => String(v)).filter(Boolean); } catch {}
  }
  return undefined;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

function parseBLamports(m: any): number | null {
  const d = m?.b_lamports ?? m?.bLamports ?? m?.liquidity_lamports ?? m?.liquidity_param_lamports;
  if (d != null && Number(d) > 0) return Math.floor(Number(d));
  const sol = m?.b_sol ?? m?.bSol ?? m?.liquidity_sol ?? m?.liquidity_param_sol;
  if (sol != null && Number(sol) > 0) return solToLamports(Number(sol));
  return solToLamports(0.01);
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function batchAccountInfo(conn: any, keys: PublicKey[], bs = 80) {
  const res = new Map<string, any>();
  for (const part of chunk(keys, bs)) {
    const infos = await conn.getMultipleAccountsInfo(part);
    infos.forEach((info: any, idx: number) => res.set(part[idx]!.toBase58(), info));
  }
  return res;
}

type UiMarket = {
  dbId?: string;
  publicKey: string;
  question: string;
  description: string;
  category?: string;
  imageUrl?: string;
  creator: string;
  bLamports?: number;
  totalVolume: number;
  resolutionTime: number;
  /** `markets.trading_lock_at` — when trading closes, before resolutionTime. */
  tradingLockAt?: string | null;
  /** `markets.created_at` — T0 of this flash market. */
  startedAt?: string | null;
  resolved: boolean;
  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  yesSupply?: number;
  noSupply?: number;
  isBlocked?: boolean;
  resolutionStatus?: string;
  proposedOutcome?: number | null;
  /** Set once resolution is final — may differ from the proposed outcome. */
  winningOutcome?: number | null;
};

/* ── Host controls ──────────────────────────────────────────────────── */
// HostControls now lives in @/components/LiveHostControls (shared with the
// /live swipe feed). Imported above as `HostControls`.

/* ── Live Activity feed ──────────────────────────────────────────────── */

function LiveActivity({ trades }: { trades: RecentTrade[] }) {
  return (
    <div className="card-pump p-4">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-pump-green animate-pulse" />
        Live Activity
      </h3>
      {trades.length === 0 ? (
        <p className="text-xs text-gray-500">No trades yet — be the first.</p>
      ) : (
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {trades.map((t) => {
          const wallet = t.user_address
            ? `${t.user_address.slice(0, 4)}...${t.user_address.slice(-4)}`
            : "anon";
          const name = t.outcome_name || (t.is_yes === true ? "YES" : t.is_yes === false ? "NO" : "—");
          const costLabel = typeof t.cost === "number" && t.cost > 0 ? `${t.cost.toFixed(3)} SOL` : "";
          const age = timeSince(t.created_at);

          return (
            <div key={t.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-gray-800/40 last:border-0">
              <span className={`font-semibold ${t.is_buy ? "text-pump-green" : "text-[#ff5c73]"}`}>
                {t.is_buy ? "BUY" : "SELL"}
              </span>
              <span className="text-gray-400 truncate">{wallet}</span>
              <span className="text-white font-medium">{name}</span>
              {costLabel && <span className="text-gray-500">{costLabel}</span>}
              <span className="ml-auto text-gray-600 whitespace-nowrap">{age}</span>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function timeSince(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/* ── BUY toasts (bottom-up) ─────────────────────────────────────────── */

function BuyToasts({ toasts }: { toasts: (RecentTrade & { _key: number })[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-4 z-[150] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map((t) => {
        const wallet = t.user_address
          ? `${t.user_address.slice(0, 4)}...${t.user_address.slice(-4)}`
          : "anon";
        const name = t.outcome_name || (t.is_yes === true ? "YES" : t.is_yes === false ? "NO" : "");
        const costLabel = typeof t.cost === "number" && t.cost > 0 ? `${t.cost.toFixed(3)} SOL` : "";

        return (
          <div
            key={t._key}
            className="bg-pump-green/15 border border-pump-green/40 rounded-xl px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm animate-slideUp"
          >
            <span className="font-semibold text-pump-green">BUY</span>{" "}
            <span className="text-gray-300">{wallet}</span>{" "}
            <span className="font-medium">{name}</span>
            {costLabel && <span className="text-gray-400 ml-1">{costLabel}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Giant immersive countdown overlay ──────────────────────────────── */

type CountdownPhase = "normal" | "warning" | "panic";

function GiantCountdown({
  label,
  phase,
  isFinal,
}: {
  label: string;
  phase: CountdownPhase;
  isFinal: boolean;
}) {
  const color =
    phase === "panic"
      ? "text-red-400"
      : phase === "warning"
      ? "text-amber-300"
      : "text-white";

  const glow =
    phase === "panic"
      ? isFinal
        ? "0 0 48px rgba(248,113,113,0.85), 0 0 14px rgba(248,113,113,0.7)"
        : "0 0 34px rgba(248,113,113,0.7), 0 0 10px rgba(248,113,113,0.55)"
      : phase === "warning"
      ? "0 0 28px rgba(252,211,77,0.55)"
      : "0 0 22px rgba(255,255,255,0.22)";

  const fontSize =
    phase === "panic"
      ? "clamp(72px, 18vw, 168px)"
      : phase === "warning"
      ? "clamp(64px, 16vw, 144px)"
      : "clamp(56px, 14vw, 128px)";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[8%] sm:top-[6%] flex justify-center z-20">
      <div
        className={`select-none font-black tabular-nums leading-none transition-all duration-500 ease-out ${color} ${
          phase === "panic" ? "animate-pulse" : ""
        }`}
        style={{
          fontSize,
          letterSpacing: "-0.04em",
          textShadow: glow,
          transform: isFinal ? "scale(1.08)" : "scale(1)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════════════ */

export default function LiveViewerPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const { publicKey, connected, signTransaction, signMessage } = useFunMarketWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const isMobile = useIsMobile(1024);
  const { isPlay } = useTradingMode();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [queuedNext, setQueuedNext] = useState<QueuedNextMarketConfig | null>(
    null,
  );
  const [resultModal, setResultModal] = useState<{
    result: FlashMarketResultState;
    /** Which ecosystem produced these numbers. Never inferred at render. */
    mode: ResultMode;
    provisional?: boolean;
    outcomeLabel?: string | null;
    /**
     * The outcome the user actually backed. Play knows it from the trade
     * ledger even on a loss; Real leaves it null and the render falls back to
     * the winning outcome on a win, exactly as before.
     */
    pickLabel?: string | null;
    winningShares?: number | null;
    marketTitle?: string | null;
    marketPath?: string | null;
    secondaryText?: string | null;
    seenKey?: string | null;
    stake?: string | null;
    payout?: string | null;
    profit?: string | null;
    payoutQualifier?: PayoutQualifier | null;
    claimAvailable?: boolean;
  } | null>(null);
  const prevSettledRef = useRef(false);
  const hostJustResolvedRef = useRef(false);
  /**
   * The Play result key already shown, or currently being fetched. The market
   * row is polled every 8s, so without this claim each poll would fire another
   * /api/play/history request for a result that is already on screen.
   */
  const playResultKeyRef = useRef<string | null>(null);

  const [positionShares, setPositionShares] = useState<number[] | null>(null);
  const [marketBalanceLamports, setMarketBalanceLamports] = useState<number | null>(null);
  // Kept for the result modal: net cost + claimed live on the position, the
  // winning supply lives on the market. Without them the modal omits the
  // money rows rather than estimating them.
  const [onchainAccounts, setOnchainAccounts] = useState<{
    posAcc: unknown;
    marketAcc: unknown;
  } | null>(null);

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showBuyHint, setShowBuyHint] = useState(false);
  const [defaultOutcomeIndex, setDefaultOutcomeIndex] = useState(0);

  // Immersive countdown clock
  const [nowMs, setNowMs] = useState(Date.now());

  // Live Activity + toasts
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [buyToasts, setBuyToasts] = useState<(RecentTrade & { _key: number })[]>([]);
  const toastCounter = useRef(0);

  const inFlightRef = useRef<Record<string, boolean>>({});

  // One-time "Tap to buy" hint on mobile
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "funmarket_live_buy_hint_v1";
    if (!localStorage.getItem(key)) {
      setShowBuyHint(true);
      const timer = setTimeout(() => {
        setShowBuyHint(false);
        localStorage.setItem(key, "1");
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, []);

  /* ── Load session ──────────────────────────────────────────────── */

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      setLoading(true);
      try {
        const s = await getLiveSession(sessionId);
        if (!s) { setLoading(false); return; }
        setSession(s);
      } catch (e) {
        console.error("Failed to load session:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Realtime session status
  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeLiveSession(sessionId, (updated) => {
      setSession(updated);
    });
    return unsub;
  }, [sessionId]);

  // Redirect to trade page when session enters a terminal state
  const TERMINAL_STATUSES: LiveSessionStatus[] = ["ended", "resolved", "cancelled"];
  useEffect(() => {
    if (!session) return;
    if (TERMINAL_STATUSES.includes(session.status) && session.market_address) {
      const timer = setTimeout(() => {
        router.replace(`/trade/${session.market_address}`);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [session?.status, session?.market_address, router]);

  /* ── Live Activity (recent trades) ─────────────────────────────── */

  useEffect(() => {
    if (!session?.market_address) return;
    fetchRecentTrades(session.market_address, 20).then(setRecentTrades);
  }, [session?.market_address]);

  useEffect(() => {
    if (!session?.market_address) return;
    const unsub = subscribeRecentTrades(session.market_address, (trade) => {
      // Prepend to activity list
      setRecentTrades((prev) => [trade, ...prev].slice(0, 20));
      // Add BUY toast (only for buy trades)
      if (trade.is_buy) {
        const key = ++toastCounter.current;
        setBuyToasts((prev) => [...prev, { ...trade, _key: key }].slice(-3));
        setTimeout(() => {
          setBuyToasts((prev) => prev.filter((t) => t._key !== key));
        }, 4000);
      }
    });
    return unsub;
  }, [session?.market_address]);

  /* ── Load market ───────────────────────────────────────────────── */

  const loadOnchainSnapshot = useCallback(async (addr: string) => {
    try {
      const mk = new PublicKey(addr);
      const mi = await connection.getAccountInfo(mk, "confirmed");
      const lam = mi?.lamports != null ? Number(mi.lamports) : null;
      const posPda = publicKey && connected ? getUserPositionPDA(mk, publicKey)[0] : null;

      if (!program) return { marketAcc: null as any, posAcc: null as any, marketLamports: lam };

      const keys = posPda ? [mk, posPda] : [mk];
      const infos = await batchAccountInfo(connection, keys, 80);
      const coder = (program as any).coder;

      const mi2 = infos.get(mk.toBase58());
      const marketAcc = mi2?.data ? coder.accounts.decode("market", mi2.data) : null;

      let posAcc: any = null;
      if (posPda) {
        const pi = infos.get(posPda.toBase58());
        posAcc = pi?.data ? coder.accounts.decode("userPosition", pi.data) : null;
      }
      return { marketAcc, posAcc, marketLamports: lam };
    } catch (e) {
      console.warn("loadOnchainSnapshot failed:", e);
      return { marketAcc: null, posAcc: null, marketLamports: null };
    }
  }, [program, connection, publicKey, connected]);

  const loadMarket = useCallback(async (addr: string) => {
    try {
      const [dbMarket, snap] = await Promise.all([
        getMarketByAddress(addr),
        loadOnchainSnapshot(addr),
      ]);
      if (!dbMarket) { setMarket(null); return; }

      const endMs = parseEndDateMs(dbMarket.end_date);
      const mt = (typeof dbMarket.market_type === "number" ? dbMarket.market_type : 0) as 0 | 1;
      const names = toStringArray(dbMarket.outcome_names) ?? [];
      const supplies = toNumberArray(dbMarket.outcome_supplies) ?? [];

      const transformed: UiMarket = {
        dbId: dbMarket.id,
        publicKey: dbMarket.market_address,
        question: dbMarket.question || "",
        description: dbMarket.description || "",
        category: dbMarket.category || "other",
        imageUrl: dbMarket.image_url || undefined,
        creator: String(dbMarket.creator || ""),
        bLamports: parseBLamports(dbMarket) || undefined,
        totalVolume: Number(dbMarket.total_volume) || 0,
        resolutionTime: Number.isFinite(endMs) ? Math.floor(endMs / 1000) : 0,
        tradingLockAt: (dbMarket as any).trading_lock_at ?? null,
        startedAt: (dbMarket as any).created_at ?? null,
        resolved: !!dbMarket.resolved || !!snap?.marketAcc?.resolved,
        marketType: mt,
        outcomeNames: names.slice(0, 10),
        outcomeSupplies: supplies.slice(0, 10),
        yesSupply: Number(dbMarket.yes_supply) || 0,
        noSupply: Number(dbMarket.no_supply) || 0,
        isBlocked: !!dbMarket.is_blocked,
        resolutionStatus: String(dbMarket.resolution_status || "open"),
        proposedOutcome: dbMarket.proposed_winning_outcome ?? null,
        winningOutcome:
          (dbMarket as any).winning_outcome != null
            ? Number((dbMarket as any).winning_outcome)
            : null,
      };

      if (snap?.marketLamports != null) setMarketBalanceLamports(snap.marketLamports);
      setOnchainAccounts({ posAcc: snap?.posAcc ?? null, marketAcc: snap?.marketAcc ?? null });
      if (snap?.posAcc?.shares) {
        setPositionShares(Array.isArray(snap.posAcc.shares) ? snap.posAcc.shares.map((x: any) => Number(x) || 0) : []);
      } else {
        setPositionShares(null);
      }

      setMarket(transformed);
    } catch (e) {
      console.error("loadMarket error:", e);
    }
  }, [loadOnchainSnapshot]);

  useEffect(() => {
    if (!session?.market_address) return;
    loadMarket(session.market_address);
  }, [session?.market_address, program, loadMarket]);

  // Resolve the queued next-market CONFIG (if any) for the Up Next strip and
  // the post-resolve auto-start. Tolerates a missing column gracefully.
  const refreshQueuedNext = useCallback(async (sessionId: string) => {
    const cfg = await fetchQueuedNextMarketConfig(sessionId);
    setQueuedNext(cfg);
  }, []);

  useEffect(() => {
    if (!session?.id) {
      setQueuedNext(null);
      return;
    }
    void refreshQueuedNext(session.id);
  }, [session?.id, session?.market_address, refreshQueuedNext]);

  // Reset settled-tracker each time the market changes (new market starts
  // fresh; suppression flag never carries across markets).
  useEffect(() => {
    prevSettledRef.current = false;
    hostJustResolvedRef.current = false;
  }, [market?.publicKey]);

  /**
   * Poll the market row while it is still open.
   *
   * THIS IS WHY THE MODAL WAS LATE. The realtime subscription on this page
   * watches `live_sessions`, not `markets`, and loadMarket() only ran on a
   * market swap or a host action. A viewer therefore never saw the host's
   * proposal land in `markets.resolution_status` — the modal could not fire
   * because the client still believed the market was open. Polling stops as
   * soon as a terminal status is read, so a settled market costs nothing.
   */
  useEffect(() => {
    const addr = session?.market_address;
    if (!addr) return;
    const status = String(market?.resolutionStatus || "open");
    if (status === "finalized" || status === "cancelled") return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      void loadMarket(addr);
    };
    const iv = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [session?.market_address, market?.resolutionStatus, loadMarket]);

  // Auto-fire the win/lose modal on the false→true settle transition.
  // Suppressed for the host (they just resolved); shown to viewers; falls
  // back to no modal when no user position exists (the result panel already
  // shows "Market resolved").
  useEffect(() => {
    // Play must never show the Real win/lose modal — it reads on-chain Real
    // shares. The shared "Market resolved" panel is the neutral fallback until
    // a Play-specific result modal ships (later phase).
    if (isPlay) return;

    const status = String(market?.resolutionStatus || "open");
    const refunded = status === "cancelled";
    // A PROPOSED outcome is enough to announce a provisional result — waiting
    // for "finalized" is what made this modal appear hours late.
    const nowSettled = !!market?.resolved || status === "proposed" || refunded;
    if (!nowSettled) {
      prevSettledRef.current = false;
      return;
    }
    if (prevSettledRef.current) return;

    if (hostJustResolvedRef.current) {
      hostJustResolvedRef.current = false;
      prevSettledRef.current = true;
      return;
    }

    const winningIdx = refunded
      ? null
      : market?.winningOutcome != null && status === "finalized"
        ? Number(market.winningOutcome)
        : market?.proposedOutcome != null
          ? Number(market.proposedOutcome)
          : null;

    if ((winningIdx === null && !refunded) || !positionShares) return;

    const totalShares = positionShares.reduce((a, b) => a + (Number(b) || 0), 0);
    if (totalShares <= 0) return;

    // Same outcome-keyed dedupe as every other surface, so a proposal already
    // seen here is not re-announced when the market finalizes.
    const account = publicKey?.toBase58();
    const marketKey = String(market?.publicKey || "");
    if (!account || !marketKey) return;
    const seenKey = resultSeenKey({
      mode: "real",
      account,
      market: marketKey,
      outcomeIndex: winningIdx,
      refunded,
    });
    if (hasSeenResult(seenKey)) {
      prevSettledRef.current = true;
      return;
    }

    const userShares = winningIdx === null ? 0 : Number(positionShares[winningIdx] || 0);
    const outcomeLabel =
      winningIdx === null ? null : (market?.outcomeNames || [])[winningIdx] || null;

    const values = buildRealResultValues({
      positionAccount: onchainAccounts?.posAcc ?? null,
      marketAccount: onchainAccounts?.marketAcc ?? null,
      marketLamports: marketBalanceLamports,
      winningIndex: winningIdx,
      finalized: status === "finalized" || !!market?.resolved,
      refunded,
    });

    const provisional = status === "proposed";

    setResultModal({
      result: values.state,
      mode: "real",
      provisional,
      outcomeLabel,
      winningShares: userShares > 0 ? userShares : null,
      marketTitle: market?.question || null,
      marketPath: market?.publicKey ? `/trade/${market.publicKey}` : null,
      secondaryText: refunded
        ? "Market cancelled."
        : provisional
          ? "Outcome proposed."
          : "Market finalized.",
      seenKey,
      stake: values.stake,
      payout: values.payout,
      profit: values.profit,
      payoutQualifier: values.payoutQualifier,
      claimAvailable: values.claimAvailable,
    });
    prevSettledRef.current = true;
  }, [
    isPlay,
    publicKey,
    market?.resolved,
    market?.resolutionStatus,
    market?.proposedOutcome,
    market?.winningOutcome,
    market?.outcomeNames,
    market?.question,
    market?.publicKey,
    positionShares,
    onchainAccounts,
    marketBalanceLamports,
  ]);

  /**
   * Play: the same announcement, from the Play ledger.
   *
   * Deliberately a SEPARATE effect from the Real one above rather than a
   * branch inside it. The two are mutually exclusive on `isPlay`, so Real
   * behaviour — including its host suppression and its prevSettledRef
   * transition tracking — is left exactly as it was.
   *
   * THE HOST IS NOT SUPPRESSED HERE. Real suppresses them because they just
   * used the resolve sheet and already know the outcome; but a host can also
   * have traded this market with Play money, and that position deserves its
   * result like anyone else's. The gate is "does this wallet hold a Play
   * position on this market", which is the honest condition — a host who did
   * not trade in Play still sees nothing, because the ledger has nothing.
   */
  useEffect(() => {
    if (!isPlay) return;

    // The session is winding down and this page redirects to /trade in 600ms.
    // Opening a modal into that would either be torn off screen mid-fetch or
    // be shown twice, so /trade owns the result from here — it runs the same
    // lookup and, because the seen-key below matches the one it builds, shows
    // it exactly once.
    const status = String(session?.status || "");
    if (status === "ended" || status === "resolved" || status === "cancelled") return;

    const resolution = String(market?.resolutionStatus || "open");
    const refunded = resolution === "cancelled";
    // A PROPOSED outcome is enough — that is the whole point of this fix.
    const settledNow = !!market?.resolved || resolution === "proposed" || refunded;
    if (!settledNow) return;

    const account = publicKey?.toBase58();
    const marketAddress = String(market?.publicKey || "");
    if (!account || !marketAddress) return;

    const winningIdx = refunded
      ? null
      : market?.winningOutcome != null && resolution === "finalized"
        ? Number(market.winningOutcome)
        : market?.proposedOutcome != null
          ? Number(market.proposedOutcome)
          : null;
    if (winningIdx === null && !refunded) return;

    // Same identifier /trade/[id] keys on, so a result seen on either surface
    // is never announced again on the other.
    const seenKey = playLiveSeenKey({
      account,
      marketId: String(market?.dbId || marketAddress),
      winningIndex: winningIdx,
      refunded,
    });
    if (playResultKeyRef.current === seenKey) return;
    if (hasSeenResult(seenKey)) {
      playResultKeyRef.current = seenKey;
      return;
    }
    // Claim before awaiting: another poll must not race in behind us.
    playResultKeyRef.current = seenKey;

    const finalized = resolution === "finalized" || !!market?.resolved;
    const outcomeLabel =
      winningIdx === null ? null : (market?.outcomeNames || [])[winningIdx] || null;
    const marketTitle = market?.question || null;

    let cancelled = false;
    let answered = false;

    void (async () => {
      const lookup = await fetchPlayLiveResult({
        marketAddress,
        winningIndex: winningIdx,
        refunded,
        finalized,
      });
      answered = lookup.status !== "unavailable";
      if (cancelled) return;

      if (lookup.status === "unavailable") {
        // No Play session or a failed request — that is not evidence the
        // wallet has no position, so release the claim and let a later poll
        // try again.
        if (playResultKeyRef.current === seenKey) playResultKeyRef.current = null;
        return;
      }
      // "none" keeps the claim: the ledger answered, this wallet has nothing
      // on this market, and re-asking every 8s would be pure noise.
      if (lookup.status === "none") return;

      const { values } = lookup;
      setResultModal({
        result: values.state,
        mode: "play",
        provisional: values.provisional,
        outcomeLabel,
        pickLabel: values.pickLabel,
        // A Real-only concept; Play sizes itself in stake, not share counts.
        winningShares: null,
        marketTitle,
        marketPath: `/trade/${marketAddress}`,
        secondaryText: refunded
          ? "Market cancelled."
          : values.provisional
            ? "Outcome proposed."
            : "Market finalized.",
        seenKey,
        stake: values.stake,
        payout: values.payout,
        profit: values.profit,
        // Play money is credited by settlement, never claimed.
        payoutQualifier: null,
        claimAvailable: false,
      });
    })();

    return () => {
      cancelled = true;
      // Torn down mid-flight: drop the claim so the next run can retry.
      if (!answered && playResultKeyRef.current === seenKey) {
        playResultKeyRef.current = null;
      }
    };
  }, [
    isPlay,
    publicKey,
    session?.status,
    market?.resolved,
    market?.resolutionStatus,
    market?.proposedOutcome,
    market?.winningOutcome,
    market?.outcomeNames,
    market?.question,
    market?.publicKey,
    market?.dbId,
  ]);

  /* ── Derived market data ───────────────────────────────────────── */

  const derived = useMemo(() => {
    if (!market) return null;
    let names = (market.outcomeNames || []).map(String).filter(Boolean);
    if (market.marketType === 0 && names.length !== 2) names = ["YES", "NO"];
    const supplies = Array.isArray(market.outcomeSupplies)
      ? market.outcomeSupplies.map((x) => Number(x || 0))
      : names.length === 2
        ? [Number(market.yesSupply || 0), Number(market.noSupply || 0)]
        : [];
    const totalSupply = supplies.reduce((s, x) => s + x, 0);
    const percentages = supplies.map((s) => (totalSupply > 0 ? (s / totalSupply) * 100 : 100 / (supplies.length || 1)));
    return { names, supplies, percentages, totalSupply };
  }, [market]);

  // Mode-aware economics for this Live market. Real path is untouched — the
  // page only consumes the Play branch (eco.percentages / eco.volumeLabel)
  // when eco.isPlay is true, and keeps its Real `derived`/formatVol otherwise.
  const eco = useLiveMarketEconomics({
    address: market?.publicKey ?? null,
    realPercentages: derived?.percentages ?? [],
    realVolumeLamports: market?.totalVolume ?? 0,
    realStatus: market?.resolved ? "resolved" : "open",
    outcomeCount: derived?.names.length ?? 0,
  });
  const displayPercentages =
    eco.isPlay && derived ? eco.percentages : derived?.percentages ?? [];

  const userSharesForUi = useMemo(() => {
    const len = derived?.names?.length ?? 0;
    const out = Array(len).fill(0);
    for (let i = 0; i < len; i++) out[i] = Math.floor(Number(positionShares?.[i] || 0));
    return out;
  }, [positionShares, derived?.names?.length]);

  /* ── Session lock logic ────────────────────────────────────────── */

  const sessionLocked = session
    ? ["locked", "ended", "resolved", "cancelled"].includes(session.status)
    : false;

  // Defensive: stable boolean. Guards against null wallet, missing
  // host_wallet, and whitespace/casing drift in the stored value.
  const isHost = useMemo(() => {
    if (!publicKey) return false;
    const hostWallet = (session?.host_wallet ?? "").trim();
    if (!hostWallet) return false;
    return hostWallet === publicKey.toBase58();
  }, [publicKey, session?.host_wallet]);

  const marketClosed = market?.resolved || market?.isBlocked || sessionLocked
    || market?.resolutionStatus === "proposed";

  /* ── Immersive mode (LIVE only) ───────────────────────────────── */

  const isLiveImmersive = session?.status === "live" || session?.status === "locked";

  // Clock tick for countdown (only during immersive)
  useEffect(() => {
    if (!isLiveImmersive) return;
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isLiveImmersive]);

  // Countdown — drives the giant immersive overlay
  const countdown = useMemo(() => {
    const endStr = market?.resolutionTime ? new Date(market.resolutionTime * 1000).toISOString() : null;
    if (!endStr) return null;
    const endMs = new Date(endStr).getTime();
    if (!Number.isFinite(endMs)) return null;
    const remSec = Math.max(0, Math.ceil((endMs - nowMs) / 1000));
    const phase: CountdownPhase =
      remSec <= 10 ? "panic" : remSec <= 30 ? "warning" : "normal";
    return { remSec, label: fmtMmSs(remSec), phase, isFinal: remSec <= 5 };
  }, [market?.resolutionTime, nowMs]);

  // Time-based lock: the market is expired once the countdown reaches 00:00.
  // session.status stays "live" at that point, so this is what actually blocks
  // trades when the timer runs out.
  const expiredByTime = !!countdown && countdown.remSec <= 0;

  // Trade-window lock: trading closes at markets.trading_lock_at, well before
  // the market ends. The market stays viewable and the result flow is
  // unchanged — only the buy path shuts. Recomputed from the timestamp on
  // every clock tick, so it is already correct for a viewer who joins after
  // the lock, and it needs no host action to fire.
  //
  // ENFORCEMENT LEVEL: Play is authoritative (play_assert_market_tradable
  // rejects against Postgres now()). Real is APPLICATION-LEVEL ONLY — a Real
  // buy goes straight from the client to `buy_shares`, and the on-chain
  // Market account has no trade-lock field, so the chain still allows trades
  // until resolution_time (= end_at). Accepted for MVP; closing it needs a
  // program upgrade adding a distinct trade_lock_time.
  //
  // Derived ONCE, here. It drives both the desktop TradeWindowBar and the
  // boolean gate below, so the strip a desktop viewer reads and the rule that
  // disables their trade controls can never disagree. Null when the market
  // carries no lock (legacy markets) — which means "no trade window", not
  // "locked".
  const tradeWindow = useMemo(
    () =>
      deriveTradeWindowState({
        lockAtMs: parseTimestampMs(market?.tradingLockAt),
        endAtMs: market?.resolutionTime ? market.resolutionTime * 1000 : null,
        startedAtMs: parseTimestampMs(market?.startedAt),
        nowMs,
      }),
    [market?.tradingLockAt, market?.startedAt, market?.resolutionTime, nowMs],
  );

  const tradeLockedByWindow = !!tradeWindow && !tradeWindow.open;

  /** Every reason the buy path must be shut, in one place. */
  const tradingClosed = sessionLocked || expiredByTime || tradeLockedByWindow;

  /* ── Host resolve (reuses the existing propose flow) ────────────── */
  async function handleResolveLive(outcomeIndex: number) {
    if (!connected || !publicKey || !program || !signTransaction || !market) {
      throw new Error("Wallet or market not ready");
    }
    if (!expiredByTime) throw new Error("Market has not ended yet");
    // Suppress the auto-result modal for the host (they just used the sheet).
    hostJustResolvedRef.current = true;
    await proposeLiveResolution({
      program,
      connection,
      publicKey,
      signTransaction,
      marketAddress: market.publicKey,
      outcomeIndex,
    });
    await loadMarket(market.publicKey);

    // Auto-promote the queued next market (if any) — no manual Start Next.
    // The propose has already succeeded; if the auto-start fails we surface a
    // clear error but the proposed state stays visible.
    if (queuedNext) {
      try {
        await handleStartNextMarket();
      } catch (e: any) {
        throw new Error(
          `Resolved, but failed to start next market: ${String(e?.message || e)}`,
        );
      }
    }
  }

  /* ── Host "Next Market" — same session, new linked market ────────── */
  // When the current market is still running we just PERSIST the config (no
  // on-chain creation yet — that happens at resolve time so the timer starts
  // fresh). When the current market has already settled we create and swap
  // immediately (existing post-resolve behaviour).
  async function handleCreateNextMarket(params: {
    title: string;
    outcomes: string[];
    durationMin: number;
  }) {
    if (!connected || !publicKey || !signMessage || !session) {
      throw new Error("Wallet or session not ready");
    }

    const currentSettled =
      !!market?.resolved || market?.resolutionStatus === "proposed";

    if (currentSettled) {
      // Immediate swap path — create on-chain + signed /market update.
      if (!program || !signTransaction) {
        throw new Error("Program not ready");
      }
      const { marketAddress: newAddr } = await createLiveFlashMarket({
        program,
        connection,
        publicKey,
        signTransaction,
        title: params.title,
        outcomes: params.outcomes,
        durationMin: params.durationMin,
      });
      const ts = Date.now();
      const message = `FUNMARKET_LIVE_MARKET|${session.id}|${newAddr}|${ts}`;
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const res = await fetch(`/api/live-sessions/${session.id}/market`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          signature: bs58.encode(sigBytes),
          market_address: newAddr,
          ts,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || `Failed to link market (${res.status})`);

      setSession(json.session as LiveSession);
      setQueuedNext(null);
      await loadMarket(newAddr);
    } else {
      // Queue path — persist CONFIG only. No on-chain creation; the market
      // is built at resolve time inside handleStartNextMarket.
      const config: QueuedNextMarketConfig = {
        title: params.title,
        outcomes: params.outcomes,
        durationMin: params.durationMin,
      };
      const canonical = serializeQueuedNextMarketConfig(config);
      const ts = Date.now();
      const message = `FUNMARKET_LIVE_QUEUE|${session.id}|set|${canonical}|${ts}`;
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const res = await fetch(`/api/live-sessions/${session.id}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          signature: bs58.encode(sigBytes),
          action: "set",
          config,
          ts,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || `Failed to queue market (${res.status})`);

      // Stream + current market stay mounted; only the Up Next strip updates.
      setSession(json.session as LiveSession);
      await refreshQueuedNext(session.id);
    }
  }

  /* ── Host auto-start — runs after resolve when a config is queued ── */
  async function handleStartNextMarket() {
    if (!connected || !publicKey || !program || !signTransaction || !signMessage || !session) {
      throw new Error("Wallet or session not ready");
    }
    const cfg = queuedNext;
    if (!cfg) throw new Error("No market is queued");

    // 1. Create the on-chain market NOW — timer starts fresh.
    const { marketAddress: newAddr } = await createLiveFlashMarket({
      program,
      connection,
      publicKey,
      signTransaction,
      title: cfg.title,
      outcomes: cfg.outcomes,
      durationMin: cfg.durationMin,
    });

    // 2. Swap it into the session via the signed /market route (server-side
    // the same call also clears queued_market_config / queued_market_address).
    const ts = Date.now();
    const message = `FUNMARKET_LIVE_MARKET|${session.id}|${newAddr}|${ts}`;
    const sigBytes = await signMessage(new TextEncoder().encode(message));
    const res = await fetch(`/api/live-sessions/${session.id}/market`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: publicKey.toBase58(),
        signature: bs58.encode(sigBytes),
        market_address: newAddr,
        ts,
      }),
    });
    const json = await res.json();
    if (!res.ok)
      throw new Error(json.error || `Failed to start next market (${res.status})`);

    const updated = json.session as LiveSession;
    setSession(updated);
    setQueuedNext(null);
    await loadMarket(updated.market_address);
  }

  /* ── Trade handler ─────────────────────────────────────────────── */

  async function handleTrade(shares: number, outcomeIndex: number, side: "buy" | "sell", costSol?: number) {
    if (!connected || !publicKey || !program || !market || !session || !derived) return;
    if (tradingClosed) return;
    // Re-check the deadline against the wall clock at submit time, not just
    // the rendered value: `tradingClosed` rides a 1s tick that a backgrounded
    // tab can stall, and an already-open sheet must never post through a
    // stale frame. Application-level Flash lock only — see
    // tradeLockedByWindow for what the chain does and does not enforce.
    const lockMs = parseTimestampMs(market.tradingLockAt);
    if (lockMs != null && Date.now() >= lockMs) return;

    const key = "trade";
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;

    const safeShares = Math.max(1, Math.floor(shares));
    const safeOutcome = clampInt(outcomeIndex, 0, derived.names.length - 1);
    const name = derived.names[safeOutcome] || `Outcome #${safeOutcome + 1}`;

    setSubmitting(true);

    if (!signTransaction) {
      alert("Wallet cannot sign transactions");
      setSubmitting(false);
      inFlightRef.current[key] = false;
      return;
    }

    try {
      const marketPubkey = new PublicKey(market.publicKey);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator);
      const amountBn = new BN(safeShares);

      let txSig: string;

      if (side === "buy") {
        const buyAccounts = {
          market: marketPubkey,
          userPosition: positionPDA,
          platformWallet: PLATFORM_WALLET,
          creator: creatorPubkey,
          trader: publicKey,
          systemProgram: SystemProgram.programId,
        };

        console.log("[live buy debug] PLATFORM_WALLET", PLATFORM_WALLET.toBase58());
        console.log("[live buy debug] market PDA", marketPubkey.toBase58());
        console.log("[live buy debug] user position PDA", positionPDA.toBase58());
        console.log("[live buy debug] trader public key", publicKey.toBase58());
        console.log("[live buy debug] accounts", buyAccounts);

        const tx = await (program as any).methods
          .buyShares(amountBn, safeOutcome)
          .accounts(buyAccounts)
          .transaction();

        txSig = await sendSignedTx({ connection, tx, signTx: signTransaction, feePayer: publicKey });
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

        txSig = await sendSignedTx({ connection, tx, signTx: signTransaction, feePayer: publicKey });
      }

      const safeCostSol = typeof costSol === "number" && Number.isFinite(costSol) ? costSol : null;

      try {
        if (market.dbId) {
          await recordTransaction({
            market_id: market.dbId,
            market_address: market.publicKey,
            user_address: publicKey.toBase58(),
            tx_signature: txSig,
            is_buy: side === "buy",
            is_yes: derived.names.length === 2 ? safeOutcome === 0 : null,
            amount: safeShares,
            shares: safeShares,
            cost: safeCostSol,
            outcome_index: safeOutcome,
            outcome_name: name,
          } as any);
        }
      } catch (e) { console.error("recordTransaction error:", e); }

      const deltaVol = side === "buy" && safeCostSol != null ? solToLamports(safeCostSol) : 0;
      try {
        await applyTradeToMarketInSupabase({
          market_address: market.publicKey,
          market_type: market.marketType,
          outcome_index: safeOutcome,
          delta_shares: side === "buy" ? safeShares : -safeShares,
          delta_volume_lamports: deltaVol,
        });
      } catch (e) { console.error("applyTrade error:", e); }

      await loadMarket(market.publicKey);
    } catch (error: any) {
      const msg = String(error?.message || "");
      if (!msg.toLowerCase().includes("user rejected")) {
        console.error("Trade error:", error);
        alert(`Trade failed: ${msg || "Unknown error"}`);
      }
      if (market?.publicKey) await loadMarket(market.publicKey);
    } finally {
      inFlightRef.current[key] = false;
      setSubmitting(false);
    }
  }

  /* ── Host status change ────────────────────────────────────────── */

  const [statusError, setStatusError] = useState<string | null>(null);

  async function handleStatusChange(newStatus: LiveSessionStatus) {
    if (!session || !publicKey) return;
    setStatusError(null);

    if (!signMessage) {
      setStatusError("Wallet does not support message signing");
      return;
    }

    const ts = Date.now();
    const message = `FUNMARKET_LIVE_STATUS|${session.id}|${newStatus}|${ts}`;
    const messageBytes = new TextEncoder().encode(message);

    let sigBytes: Uint8Array;
    try {
      sigBytes = await signMessage(messageBytes);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (!msg.toLowerCase().includes("user rejected")) {
        setStatusError("Failed to sign message");
      }
      return;
    }

    try {
      const res = await fetch(`/api/live-sessions/${session.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          signature: bs58.encode(sigBytes),
          newStatus,
          ts,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Server error ${res.status}`);
      }

      setSession(json.session as LiveSession);
    } catch (e: any) {
      console.error("Status change failed:", e);
      setStatusError(String(e?.message || "Failed to update status"));
    }
  }

  /* ── Immersive overlay data pill ─────────────────────────────── */
  // NOTE: must stay above any early return — keeps hook order stable.

  const overlayStats = useMemo(() => {
    const pills: { label: string; value: string; accent?: boolean }[] = [];
    return pills;
  }, []);

  /* ── Render ────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green" />
          <p className="text-gray-400 mt-4">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-xl mb-4">Session not found</p>
          <Link href="/live" className="text-pump-green hover:underline">
            Back to live
          </Link>
        </div>
      </div>
    );
  }

  // Terminal state: show brief message while redirect fires
  if (TERMINAL_STATUSES.includes(session.status)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-lg">Stream ended &mdash; redirecting&hellip;</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MOBILE
          ═══════════════════════════════════════════════════════════ */}
      {isMobile ? (
        isLiveImmersive ? (
          /* ── MOBILE LIVE IMMERSIVE ──────────────────────────────── */
          <div className="fixed inset-0 bottom-14 z-[40] bg-black">
            <MobileImmersiveSlide
              session={session}
              market={
                market
                  ? {
                      question: market.question,
                      resolutionTime: market.resolutionTime,
                      totalVolume: market.totalVolume,
                      publicKey: market.publicKey,
                      tradingLockAt: market.tradingLockAt ?? null,
                      startedAt: market.startedAt ?? null,
                    }
                  : null
              }
              derived={
                derived
                  ? { names: derived.names, percentages: displayPercentages }
                  : null
              }
              economics={
                eco.isPlay
                  ? { volumeLabel: eco.volumeLabel, perSide: eco.perSide }
                  : undefined
              }
              isPlay={isPlay}
              active={true}
              sessionLocked={tradingClosed}
              onOutcomeTap={(idx) => {
                if (tradingClosed) return;
                setDefaultOutcomeIndex(idx);
                setMobileSheetOpen(true);
              }}
              endIsoOverride={null}
              countText={null}
              variant="deeplink"
              hostSlot={
                isHost ? (
                  <HostControls
                    session={session}
                    onStatusChange={handleStatusChange}
                    error={statusError}
                  />
                ) : null
              }
              onResolve={isHost ? handleResolveLive : undefined}
              resolution={
                market
                  ? {
                      resolved: !!market.resolved,
                      proposed: market.resolutionStatus === "proposed",
                      outcomeIndex: market.proposedOutcome ?? null,
                    }
                  : undefined
              }
              onCreateNextMarket={isHost ? handleCreateNextMarket : undefined}
              queuedNext={queuedNext}
            />
          </div>
        ) : (
          /* ── MOBILE NORMAL (scheduled / non-live) ───────────────── */
          <div className="px-4 py-4 pb-20 space-y-4">
            <Link href="/live" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to live
            </Link>

            <LiveMobileContent
              streamUrl={session.stream_url}
              title={session.title}
              hostWallet={session.host_wallet}
              status={session.status}
              market={market ? {
                publicKey: market.publicKey,
                question: market.question,
                imageUrl: market.imageUrl,
                category: market.category,
                totalVolume: market.totalVolume,
              } : null}
              derived={derived ? {
                names: derived.names,
                percentages: displayPercentages,
              } : null}
              volumeLabel={eco.isPlay ? eco.volumeLabel : undefined}
              sessionLocked={sessionLocked}
              onOutcomeTap={(idx) => {
                if (!sessionLocked) {
                  setDefaultOutcomeIndex(idx);
                  setMobileSheetOpen(true);
                }
              }}
            />

            {isHost && (
              <HostControls session={session} onStatusChange={handleStatusChange} error={statusError} />
            )}
          </div>
        )
      ) : (
        /* ═══════════════════════════════════════════════════════════
           DESKTOP
           ═══════════════════════════════════════════════════════════ */
        isLiveImmersive ? (
          /* ── DESKTOP LIVE IMMERSIVE ─────────────────────────────── */
          <div className="max-w-[1440px] mx-auto px-6 lg:px-8 py-4">
            <Link
              href="/live"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-white mb-4 transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to live
            </Link>

            <div className="grid grid-cols-3 gap-5">
              {/* ── LEFT — immersive camera with overlay ────────── */}
              <div className="col-span-2 space-y-4">
                <div className="relative rounded-xl overflow-hidden bg-black">
                  {/* Stream */}
                  {session.status === "disabled" ? (
                    <StreamUnavailable />
                  ) : session.stream_url ? (
                    <StreamPlayer url={session.stream_url} />
                  ) : (
                    <div className="relative w-full aspect-video bg-black">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.2),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
                    </div>
                  )}

                  {/* ── Giant immersive countdown ─────────────── */}
                  {countdown && (
                    <GiantCountdown
                      label={countdown.label}
                      phase={countdown.phase}
                      isFinal={countdown.isFinal}
                    />
                  )}

                  {/* ── Camera overlay: top ────────────────────── */}
                  {/* pointer-events-none — purely decorative, never blocks
                       the YouTube/Twitch/Kick player controls underneath. */}
                  <div className="pointer-events-none absolute top-0 inset-x-0 z-10">
                    <div className="px-5 pt-4 pb-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {session.status === "live" && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/30 border border-red-500/40 mb-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                              <span className="text-[11px] font-bold text-red-400 tracking-wide">LIVE</span>
                            </div>
                          )}
                          <h1 className="text-white font-bold text-xl leading-tight line-clamp-2 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                            {market?.question || session.title}
                          </h1>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Camera overlay: bottom — stats ─────────── */}
                  {/* pointer-events-none — must not cover the player's
                       bottom control bar (volume, fullscreen, captions). */}
                  {overlayStats.length > 0 && (
                    <div className="pointer-events-none absolute bottom-0 inset-x-0 z-10">
                      <div className="px-5 pb-4 pt-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
                        <div className="flex items-center gap-2.5">
                          {overlayStats.map((s, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold backdrop-blur-sm ${
                                s.accent
                                  ? "bg-white/15 text-white border border-white/25"
                                  : "bg-white/10 text-white/80 border border-white/15"
                              }`}
                            >
                              <span className="opacity-60">{s.label}</span>
                              <span className="tabular-nums">{s.value}</span>
                            </span>
                          ))}
                          {market && (eco.isPlay ? !!eco.volumeLabel : true) && (
                            <span className="text-xs text-white/40 ml-auto">
                              {eco.isPlay
                                ? `${eco.volumeLabel} vol`
                                : `${formatVol(market.totalVolume)} SOL vol`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Host controls + Create Next Market (action beside the
                    Live / Locked / Ended buttons). */}
                {isHost && (
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <HostControls
                        session={session}
                        onStatusChange={handleStatusChange}
                        error={statusError}
                      />
                    </div>
                    {!queuedNext && handleCreateNextMarket && (
                      <CreateNextLauncher onCreate={handleCreateNextMarket} />
                    )}
                  </div>
                )}

                {/* Comments (compact in immersive) */}
                {market && (
                  <div className="pb-8">
                    <CommentsSection marketId={market.publicKey} />
                  </div>
                )}
              </div>

              {/* ── RIGHT — trading panel ─────────────────────── */}
              <div className="col-span-1">
                <div className="sticky top-6 space-y-4 pb-8">
                  {/* Trade-window strip — sits directly above the trade
                      controls so a desktop viewer sees WHY they just got
                      disabled. Same component and same derived state as the
                      mobile strip; there is no second countdown. */}
                  {tradeWindow && <TradeWindowBar state={tradeWindow} />}
                  {market && derived && !isPlay && (
                    <TradingPanel
                      mode="desktop"
                      market={{
                        resolved: market.resolved,
                        marketType: market.marketType,
                        outcomeNames: derived.names,
                        outcomeSupplies: derived.supplies,
                        bLamports: market.bLamports,
                        yesSupply: derived.names.length >= 2 ? derived.supplies[0] || 0 : market.yesSupply || 0,
                        noSupply: derived.names.length >= 2 ? derived.supplies[1] || 0 : market.noSupply || 0,
                      }}
                      connected={connected}
                      submitting={submitting}
                      onTrade={(s, idx, side, cost) => void handleTrade(s, idx, side, cost)}
                      marketBalanceLamports={marketBalanceLamports}
                      userHoldings={userSharesForUi}
                      marketClosed={!!marketClosed || tradingClosed}
                    />
                  )}
                  {market && derived && isPlay && (
                    <PlayTradingPanel
                      marketAddress={market.publicKey}
                      outcomeNames={derived.names}
                      layout="desktop"
                      playStatus={eco.status}
                      marketClosed={!!marketClosed || tradingClosed}
                    />
                  )}

                  {(sessionLocked || tradeLockedByWindow) && (
                    <div className="rounded-xl border border-gray-800/40 bg-pump-dark/30 p-4 text-center">
                      <p className="text-sm text-gray-400">
                        Trading is {sessionLocked && session.status !== "locked"
                          ? "disabled"
                          : "locked"}.
                      </p>
                      {tradeLockedByWindow && !sessionLocked && !expiredByTime && (
                        <p className="text-xs text-gray-500 mt-1">
                          The market runs until the timer ends.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Host actions: result / resolve form / queued Up Next.
                      "Create Next Market" lives beside the host status
                      controls in the left column. */}
                  <LiveDesktopHostPanel
                    isHost={isHost}
                    expired={expiredByTime}
                    settled={
                      !!market?.resolved || market?.resolutionStatus === "proposed"
                    }
                    resolved={!!market?.resolved}
                    proposed={market?.resolutionStatus === "proposed"}
                    outcomeNames={derived?.names ?? null}
                    outcomeIndex={market?.proposedOutcome ?? null}
                    queuedNext={queuedNext}
                    onResolve={isHost ? handleResolveLive : undefined}
                  />

                  {/* Past Markets — persisted history (same data as mobile).
                      Hidden when empty; refreshes whenever the session swaps
                      to a new market. */}
                  <LiveDesktopPastMarkets
                    sessionId={session?.id ?? null}
                    refreshKey={session?.market_address ?? null}
                  />

                  {isPlay ? (
                    <PlayActivity
                      marketAddress={market?.publicKey ?? null}
                      outcomeNames={derived?.names ?? null}
                      variant="panel"
                      limit={30}
                    />
                  ) : (
                    <LiveActivity trades={recentTrades} />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── DESKTOP NORMAL (scheduled / non-live) ──────────────── */
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6">
            <Link
              href="/live"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-white mb-5 transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back to live
            </Link>

            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 space-y-5">
                {session.status === "disabled" ? (
                  <StreamUnavailable />
                ) : session.stream_url ? (
                  <StreamPlayer url={session.stream_url} />
                ) : (
                  <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.2),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h1 className="text-2xl font-bold text-white leading-tight">{session.title}</h1>
                    <div className="flex items-center gap-3 mt-1.5">
                      <p className="text-xs text-gray-500">
                        Host: {session.host_wallet.slice(0, 6)}...{session.host_wallet.slice(-4)}
                      </p>
                      {market && (eco.isPlay ? !!eco.volumeLabel : true) && (
                        <p className="text-xs text-gray-500">
                          {eco.isPlay
                            ? `${eco.volumeLabel} vol`
                            : `${formatVol(market.totalVolume)} SOL vol`}
                        </p>
                      )}
                    </div>
                  </div>
                  <StatusBanner status={session.status} />
                </div>

                {market && market.question !== session.title && (
                  <div className="rounded-xl border border-gray-800/40 bg-pump-dark/30 px-5 py-4">
                    <p className="text-base text-white font-medium">{market.question}</p>
                  </div>
                )}

                {isHost && (
                  <HostControls session={session} onStatusChange={handleStatusChange} error={statusError} />
                )}

                {market && (
                  <div className="mt-2 pb-8">
                    <CommentsSection marketId={market.publicKey} />
                  </div>
                )}
              </div>

              <div className="col-span-1">
                <div className="sticky top-6 space-y-4 pb-8">
                  {/* Trade-window strip — sits directly above the trade
                      controls so a desktop viewer sees WHY they just got
                      disabled. Same component and same derived state as the
                      mobile strip; there is no second countdown. */}
                  {tradeWindow && <TradeWindowBar state={tradeWindow} />}
                  {market && derived && !isPlay && (
                    <TradingPanel
                      mode="desktop"
                      market={{
                        resolved: market.resolved,
                        marketType: market.marketType,
                        outcomeNames: derived.names,
                        outcomeSupplies: derived.supplies,
                        bLamports: market.bLamports,
                        yesSupply: derived.names.length >= 2 ? derived.supplies[0] || 0 : market.yesSupply || 0,
                        noSupply: derived.names.length >= 2 ? derived.supplies[1] || 0 : market.noSupply || 0,
                      }}
                      connected={connected}
                      submitting={submitting}
                      onTrade={(s, idx, side, cost) => void handleTrade(s, idx, side, cost)}
                      marketBalanceLamports={marketBalanceLamports}
                      userHoldings={userSharesForUi}
                      marketClosed={!!marketClosed || tradingClosed}
                    />
                  )}
                  {market && derived && isPlay && (
                    <PlayTradingPanel
                      marketAddress={market.publicKey}
                      outcomeNames={derived.names}
                      layout="desktop"
                      playStatus={eco.status}
                      marketClosed={!!marketClosed || tradingClosed}
                    />
                  )}

                  {(sessionLocked || tradeLockedByWindow) && (
                    <div className="rounded-xl border border-gray-800/40 bg-pump-dark/30 p-4 text-center">
                      <p className="text-sm text-gray-400">
                        {sessionLocked
                          ? `Trading is ${session.status === "locked" ? "locked" : "disabled"} for this session.`
                          : "Trading is locked — the market runs until the timer ends."}
                      </p>
                    </div>
                  )}

                  {isPlay ? (
                    <PlayActivity
                      marketAddress={market?.publicKey ?? null}
                      outcomeNames={derived?.names ?? null}
                      variant="panel"
                      limit={30}
                    />
                  ) : (
                    <LiveActivity trades={recentTrades} />
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* Mobile bottom sheet — mode-branched. Real keeps the exact validated
          MobileBuySheet + Solana handleTrade. Play uses the same visual shell
          (PlayLiveBuySheet) with USD and no Solana tx. Only one is mounted, so
          switching mode resets the sheet's amount/quote/error state. */}
      {isMobile && market && derived && !isPlay && (
        <MobileBuySheet
          open={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          derived={derived}
          connected={connected}
          submitting={submitting}
          onTrade={handleTrade}
          sessionLocked={tradingClosed}
          defaultOutcomeIndex={defaultOutcomeIndex}
          keepNavbar
        />
      )}
      {isMobile && market && derived && isPlay && (
        <PlayLiveBuySheet
          open={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          marketAddress={market.publicKey}
          outcomeNames={derived.names}
          defaultOutcomeIndex={defaultOutcomeIndex}
          sessionLocked={tradingClosed}
          playStatus={eco.status}
          keepNavbar
          onTraded={({ outcomeName, shares }) => {
            // Reuse the existing Live BUY toast (SOL cost omitted → no SOL
            // shown for Play). Play data only; never touches Real state.
            const key = Date.now();
            setBuyToasts((prev) =>
              [
                ...prev,
                {
                  id: `play-${key}`,
                  created_at: new Date().toISOString(),
                  user_address: publicKey?.toBase58() ?? "",
                  is_buy: true,
                  is_yes:
                    derived.names.length === 2
                      ? derived.names.indexOf(outcomeName) === 0
                      : null,
                  shares,
                  cost: 0,
                  outcome_index: derived.names.indexOf(outcomeName),
                  outcome_name: outcomeName,
                  _key: key,
                },
              ].slice(-3)
            );
            setTimeout(
              () => setBuyToasts((prev) => prev.filter((t) => t._key !== key)),
              2500
            );
          }}
        />
      )}

      {/* BUY toasts */}
      <BuyToasts toasts={buyToasts} />

      {/* Viewer win/lose modal — host suppressed via hostJustResolvedRef. */}
      {resultModal && (
        <FlashMarketResultModal
          open
          result={resultModal.result}
          mode={resultModal.mode}
          provisional={resultModal.provisional ?? false}
          marketTitle={resultModal.marketTitle}
          outcomeLabel={resultModal.outcomeLabel}
          pickLabel={
            resultModal.pickLabel ??
            (resultModal.result === "win" ? resultModal.outcomeLabel : null)
          }
          secondaryText={resultModal.secondaryText ?? null}
          winningShares={resultModal.winningShares}
          stake={resultModal.stake ?? null}
          payout={resultModal.payout ?? null}
          profit={resultModal.profit ?? null}
          payoutQualifier={resultModal.payoutQualifier ?? null}
          claimAvailable={resultModal.claimAvailable ?? false}
          marketPath={resultModal.marketPath ?? null}
          onClose={() => {
            if (resultModal.seenKey) markResultSeen(resultModal.seenKey);
            setResultModal(null);
          }}
        />
      )}
    </>
  );
}
