// src/app/live/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { useProgram } from "@/hooks/useProgram";
import TradingPanel from "@/components/TradingPanel";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import CommentsSection from "@/components/CommentsSection";

import { supabase } from "@/lib/supabaseClient";
import { getMarketByAddress, recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";
import {
  getLiveSession,
  subscribeLiveSession,
  updateLiveSession,
  fetchRecentTrades,
  subscribeRecentTrades,
  type LiveSession,
  type LiveSessionStatus,
  type RecentTrade,
} from "@/lib/liveSessions";

import { lamportsToSol, solToLamports, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";
import { sendSignedTx } from "@/lib/solanaSend";

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59Z`).getTime();
  const n = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s) ? s.replace(" ", "T") : s;
  return new Date(n).getTime();
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

function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
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
  resolved: boolean;
  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  yesSupply?: number;
  noSupply?: number;
  isBlocked?: boolean;
  resolutionStatus?: string;
  proposedOutcome?: number | null;
};

/* ── Stream player ──────────────────────────────────────────────────── */

function StreamPlayer({ url }: { url: string }) {
  // Detect embed type from URL
  const embedUrl = useMemo(() => {
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([\w-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`;

    // Twitch
    const twitchMatch = url.match(/twitch\.tv\/(\w+)/);
    if (twitchMatch) return `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${typeof window !== "undefined" ? window.location.hostname : "localhost"}`;

    // Kick
    const kickMatch = url.match(/kick\.com\/(\w+)/);
    if (kickMatch) return `https://player.kick.com/${kickMatch[1]}`;

    // Direct embed URL (m3u8, etc.) — just use iframe
    return url;
  }, [url]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
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

/* ── Status banner ──────────────────────────────────────────────────── */

function StatusBanner({ status }: { status: LiveSessionStatus }) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 border border-red-600/40">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-semibold text-red-400">LIVE</span>
      </div>
    );
  }

  const map: Record<string, { border: string; bg: string; text: string; label: string }> = {
    scheduled: { border: "border-yellow-600/40", bg: "bg-yellow-600/20", text: "text-yellow-400", label: "Scheduled" },
    locked: { border: "border-orange-500/40", bg: "bg-orange-500/20", text: "text-orange-400", label: "Trading Locked" },
    ended: { border: "border-gray-600/40", bg: "bg-gray-600/20", text: "text-gray-400", label: "Stream Ended" },
    resolved: { border: "border-pump-green/40", bg: "bg-pump-green/20", text: "text-pump-green", label: "Resolved" },
    cancelled: { border: "border-gray-700/40", bg: "bg-gray-700/20", text: "text-gray-400", label: "Cancelled" },
  };
  const s = map[status] || map.ended!;

  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${s.bg} border ${s.border}`}>
      <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
    </div>
  );
}

/* ── Host controls ──────────────────────────────────────────────────── */

function HostControls({
  session,
  onStatusChange,
  error,
}: {
  session: LiveSession;
  onStatusChange: (s: LiveSessionStatus) => void;
  error?: string | null;
}) {
  const statusFlow: LiveSessionStatus[] = ["live", "locked", "ended", "resolved"];
  const [collapsed, setCollapsed] = useState(false);
  const isTerminal = ["resolved", "cancelled"].includes(session.status);

  return (
    <div className="rounded-xl border border-gray-800/60 bg-pump-dark/40 px-3 py-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-white transition"
      >
        <span className="font-semibold">Host</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`w-3.5 h-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-2 mt-2">
          {isTerminal ? (
            <p className="text-[11px] text-gray-500">
              Session is {session.status}. No further actions available.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {statusFlow.map((s) => (
                <button
                  key={s}
                  disabled={session.status === s}
                  onClick={() => onStatusChange(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition ${
                    session.status === s
                      ? "bg-pump-green/15 border-pump-green text-pump-green"
                      : "bg-pump-dark/40 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
              <button
                disabled={session.status === "cancelled"}
                onClick={() => onStatusChange("cancelled")}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-red-800/60 text-red-400/80 hover:bg-red-900/20 transition"
              >
                Cancel
              </button>
            </div>
          )}
          {error && (
            <p className="text-[11px] text-red-400 bg-red-900/20 rounded-md px-2 py-1">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Mobile bottom sheet for buy ────────────────────────────────────── */

function MobileBuySheet({
  open,
  onClose,
  market,
  derived,
  connected,
  submitting,
  onTrade,
  marketBalanceLamports,
  userHoldings,
  sessionLocked,
}: {
  open: boolean;
  onClose: () => void;
  market: UiMarket;
  derived: { names: string[]; supplies: number[] };
  connected: boolean;
  submitting: boolean;
  onTrade: (s: number, idx: number, side: "buy" | "sell", cost?: number) => void;
  marketBalanceLamports: number | null;
  userHoldings: number[];
  sessionLocked: boolean;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const presets = [0.01, 0.1, 1];

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />

      {/* Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-pump-dark border-t border-gray-800 rounded-t-2xl p-5 pb-8 animate-slideUp">
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-4" />

        {sessionLocked ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm">Trading is currently locked for this session.</p>
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

            {/* Outcome selector (emoji-style for mobile) */}
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
                // Convert SOL amount to approximate share count
                // (simplified: 1 share ~ 0.01 SOL base price)
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
              {!connected ? "Connect wallet" : submitting ? "Submitting..." : "Buy"}
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

/* ── Live Activity feed ──────────────────────────────────────────────── */

function LiveActivity({ trades }: { trades: RecentTrade[] }) {
  if (trades.length === 0) return null;

  return (
    <div className="card-pump p-4">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-pump-green animate-pulse" />
        Live Activity
      </h3>
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

/* ══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════════════ */

export default function LiveViewerPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const isMobile = useIsMobile(1024);

  const [session, setSession] = useState<LiveSession | null>(null);
  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [positionShares, setPositionShares] = useState<number[] | null>(null);
  const [marketBalanceLamports, setMarketBalanceLamports] = useState<number | null>(null);

  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showBuyHint, setShowBuyHint] = useState(false);

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
        resolved: !!dbMarket.resolved || !!snap?.marketAcc?.resolved,
        marketType: mt,
        outcomeNames: names.slice(0, 10),
        outcomeSupplies: supplies.slice(0, 10),
        yesSupply: Number(dbMarket.yes_supply) || 0,
        noSupply: Number(dbMarket.no_supply) || 0,
        isBlocked: !!dbMarket.is_blocked,
        resolutionStatus: String(dbMarket.resolution_status || "open"),
        proposedOutcome: dbMarket.proposed_winning_outcome ?? null,
      };

      if (snap?.marketLamports != null) setMarketBalanceLamports(snap.marketLamports);
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

  const isHost = publicKey && session?.host_wallet === publicKey.toBase58();

  const marketClosed = market?.resolved || market?.isBlocked || sessionLocked
    || market?.resolutionStatus === "proposed";

  /* ── Trade handler ─────────────────────────────────────────────── */

  async function handleTrade(shares: number, outcomeIndex: number, side: "buy" | "sell", costSol?: number) {
    if (!connected || !publicKey || !program || !market || !session || !derived) return;
    if (sessionLocked) return;

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
    if (!session) return;
    setStatusError(null);

    const now = new Date().toISOString();

    // Build status-specific patch with correct Supabase column names
    const patch: Record<string, unknown> = { status: newStatus };

    switch (newStatus) {
      case "live":
        patch.lock_at = null;
        patch.end_at = null;
        patch.ended_at = null;
        // Only set started_at if not already set
        if (!session.started_at) patch.started_at = now;
        break;
      case "locked":
        patch.lock_at = now;
        break;
      case "ended":
        patch.end_at = now;
        patch.ended_at = now;
        break;
      case "resolved":
        patch.end_at = session.end_at || now;
        patch.ended_at = session.ended_at || now;
        break;
      case "cancelled":
        patch.end_at = session.end_at || now;
        patch.ended_at = session.ended_at || now;
        break;
    }

    try {
      const updated = await updateLiveSession(session.id, patch as any);
      setSession(updated);
    } catch (e: any) {
      console.error("Status change failed:", e);
      const msg = String(e?.message || "Failed to update status");
      setStatusError(msg);
    }
  }

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
        {/* Back link */}
        <Link href="/live" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4 transition">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to live
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
          {/* ── LEFT COLUMN ────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* Stream player */}
            <StreamPlayer url={session.stream_url} />

            {/* Title + status */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl md:text-2xl font-bold text-white leading-tight break-words">
                  {session.title}
                </h1>
                <p className="text-xs text-gray-500 mt-1">
                  Host: {session.host_wallet.slice(0, 6)}...{session.host_wallet.slice(-4)}
                </p>
              </div>
              <StatusBanner status={session.status} />
            </div>

            {/* Market info card (compact) */}
            {market && derived && (
              <div className="card-pump p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-pump-dark shrink-0">
                    {market.imageUrl ? (
                      <Image src={market.imageUrl} alt="" width={40} height={40} className="object-cover w-full h-full" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <CategoryImagePlaceholder category={market.category || "other"} className="scale-[0.4]" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/trade/${market.publicKey}`} className="text-sm font-semibold text-white hover:text-pump-green transition line-clamp-1">
                      {market.question}
                    </Link>
                    <p className="text-[11px] text-gray-500">{formatVol(market.totalVolume)} SOL Vol</p>
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
                        onClick={() => {
                          if (isMobile && !sessionLocked) setMobileSheetOpen(true);
                        }}
                        disabled={sessionLocked}
                        className={`text-left rounded-xl px-4 py-3 border bg-pump-dark/80 transition ${
                          isYes ? "border-pump-green/40" : "border-[#ff5c73]/40"
                        } ${!sessionLocked && isMobile ? "active:scale-[0.98]" : ""}`}
                      >
                        <span className={`text-xs font-semibold uppercase ${isYes ? "text-pump-green" : "text-[#ff5c73]"}`}>
                          {name}
                        </span>
                        <div className={`text-2xl font-bold tabular-nums ${isYes ? "text-pump-green" : "text-[#ff5c73]"}`}>
                          {pct}%
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Host controls */}
            {isHost && (
              <HostControls session={session} onStatusChange={handleStatusChange} error={statusError} />
            )}

            {/* Comments */}
            {market && (
              <div className="mt-2 pb-8">
                <CommentsSection marketId={market.publicKey} />
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN (sticky trading panel) ────────────── */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-6 space-y-4 pb-8">
              {market && derived && !isMobile && (
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
                  marketClosed={!!marketClosed}
                />
              )}

              {/* Session locked info */}
              {sessionLocked && (
                <div className="card-pump p-4 text-center">
                  <p className="text-sm text-gray-400">
                    Trading is {session.status === "locked" ? "locked" : "disabled"} for this session.
                  </p>
                </div>
              )}

              {/* Live Activity */}
              <LiveActivity trades={recentTrades} />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && market && derived && (
        <MobileBuySheet
          open={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          market={market}
          derived={derived}
          connected={connected}
          submitting={submitting}
          onTrade={handleTrade}
          marketBalanceLamports={marketBalanceLamports}
          userHoldings={userSharesForUi}
          sessionLocked={sessionLocked}
        />
      )}

      {/* Mobile FAB to open buy sheet */}
      {isMobile && market && !sessionLocked && !mobileSheetOpen && (
        <div className="fixed bottom-16 right-4 z-[100] flex flex-col items-center gap-1.5">
          {/* One-time hint */}
          {showBuyHint && (
            <span className="px-2.5 py-1 rounded-lg bg-white text-black text-xs font-semibold shadow-lg animate-fadeIn whitespace-nowrap">
              Tap to buy
            </span>
          )}
          <button
            onClick={() => {
              setMobileSheetOpen(true);
              if (showBuyHint) {
                setShowBuyHint(false);
                try { localStorage.setItem("funmarket_live_buy_hint_v1", "1"); } catch {}
              }
            }}
            className="w-14 h-14 rounded-full bg-pump-green text-black shadow-lg flex items-center justify-center hover:bg-[#74ffb8] transition active:scale-95"
            aria-label="Trade"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {/* BUY toasts — slide up from bottom-left */}
      <BuyToasts toasts={buyToasts} />
    </>
  );
}
