"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { useProgram } from "@/hooks/useProgram";

import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import MarketActions from "@/components/MarketActions";
import CreatorSocialLinks from "@/components/CreatorSocialLinks";
import CommentsSection from "@/components/CommentsSection";
import TradingPanel from "@/components/TradingPanel";
import OddsHistoryChart from "@/components/OddsHistoryChart";
import MarketActivityTab from "@/components/MarketActivity";
import ResolutionPanel from "@/components/ResolutionPanel";
import MarketCard from "@/components/MarketCard";
import BlockedMarketBanner from "@/components/BlockedMarketBanner";

import { supabase } from "@/lib/supabaseClient";
import { buildOddsSeries, downsample } from "@/lib/marketHistory";
import { getMarketByAddress, recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";

import { lamportsToSol, solToLamports, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";
import { getActiveLiveSessionForMarket, type LiveSessionStatus } from "@/lib/liveSessions";
import { getSportEvent, refreshSportEvent, type SportEvent } from "@/lib/sportEvents";

import type { SocialLinks } from "@/components/SocialLinksForm";
import { useCallback } from "react";
import { sendSignedTx } from "@/lib/solanaSend";
import Link from "next/link";

type SupabaseMarket = any;

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
  creatorResolveDeadline?: string | null;
  resolved: boolean;

  winningOutcome?: number | null;
  resolvedAt?: string | null;
  resolutionProofUrl?: string | null;
  resolutionProofImage?: string | null;
  resolutionProofNote?: string | null;

  resolutionStatus?: "open" | "proposed" | "finalized" | "cancelled";
  proposedOutcome?: number | null;
  proposedAt?: string | null;
  contestDeadline?: string | null;
  contested?: boolean;
  contestCount?: number;

  proposedProofUrl?: string | null;
  proposedProofImage?: string | null;
  proposedProofNote?: string | null;

  socialLinks?: SocialLinks;

  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];

  yesSupply?: number;
  noSupply?: number;

  // ✅ Block fields
  isBlocked?: boolean;
  blockedReason?: string | null;
  blockedAt?: string | null;

  // Sport fields
  marketMode?: string | null;
  sportEventId?: string | null;
  sportMeta?: Record<string, unknown> | null;
  sportTradingState?: string | null;
};

type Derived = {
  marketType: 0 | 1;
  names: string[];
  supplies: number[];
  percentages: number[];
  totalSupply: number;
  isBinaryStyle: boolean;
  missingOutcomes: boolean;
};

type OddsRange = "24h" | "7d" | "30d" | "all";
type BottomTab = "discussion" | "activity";

type RelatedTab = "related" | "trending" | "popular";

/* ══════════════════════════════════════════════════════════════
   TRADE MODAL TYPES
   ══════════════════════════════════════════════════════════════ */
type TradeStep = "idle" | "signing" | "confirming" | "updating" | "done" | "error";

type TradeResult = {
  success: boolean;
  side: "buy" | "sell";
  shares: number;
  outcomeName: string;
  costSol: number | null;
  txSig: string | null;
  error?: string;
} | null;

type DisplayStatus = "scheduled" | "live" | "finished" | "unknown";

function useIsMobile(breakpointPx = 1024) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpointPx - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [breakpointPx]);
  return isMobile;
}

function safeParamId(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function toNumberArray(x: any): number[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => Number(v) || 0);
  if (typeof x === "string") {
    try {
      const parsed = JSON.parse(x);
      if (Array.isArray(parsed)) return parsed.map((v) => Number(v) || 0);
    } catch {}
  }
  return undefined;
}

function toStringArray(x: any): string[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  if (typeof x === "string") {
    try {
      const parsed = JSON.parse(x);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {}
  }
  return undefined;
}

function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, v));
}

function toFiniteNumber(v: any): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function marketTopPct(m: any): number {
  const supplies =
    Array.isArray(m.outcome_supplies) && m.outcome_supplies.length
      ? m.outcome_supplies.map((x: any) => Number(x) || 0)
      : [Number(m.yes_supply) || 0, Number(m.no_supply) || 0];

      const total = supplies.reduce((a: number, b: number) => a + b, 0);
  if (!total) return 0;

  const top = Math.max(...supplies);
  return Math.round((top / total) * 100);
}

function toResolutionStatus(x: any): "open" | "proposed" | "finalized" | "cancelled" {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled") return s;
  return "open";
}

function formatMsToHhMm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / (60 * 1000)));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function addHoursIso(ms: number, hours: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const t = ms + hours * 60 * 60 * 1000;
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function parseIsoUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const parsed = new Date(hasTimezone ? raw : `${raw}Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

/**
 * Parse end_date safely:
 * - "YYYY-MM-DD" => end of day UTC
 * - ISO with timezone => parse as-is
 * - ISO without timezone => parse as local
 * - Postgres "YYYY-MM-DD HH:mm:ss" => local
 */
function parseEndDateMs(raw: any): number {
  if (!raw) return NaN;

  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const s = String(raw).trim();
  if (!s) return NaN;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (isDateOnly) {
    const t = new Date(`${s}T23:59:59Z`).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?/.test(s) ? s.replace(" ", "T") : s;
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function parseBLamports(m: any): number | null {
  const direct =
    m?.b_lamports ??
    m?.bLamports ??
    m?.liquidity_lamports ??
    m?.liquidity_param_lamports;

  if (direct != null && Number(direct) > 0) return Math.floor(Number(direct));

  const sol =
    m?.b_sol ??
    m?.bSol ??
    m?.liquidity_sol ??
    m?.liquidity_param_sol;

  if (sol != null && Number(sol) > 0) return solToLamports(Number(sol));

  // fallback: ton default 0.01 SOL
  return solToLamports(0.01);
}

function shortTxSig(sig: string | null): string {
  if (!sig) return "";
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getMultipleAccountsInfoBatched(
  connection: any,
  keys: PublicKey[],
  batchSize = 80
) {
  const res = new Map<string, any>();
  for (const part of chunk(keys, batchSize)) {
    const infos = await connection.getMultipleAccountsInfo(part);
    infos.forEach((info: any, idx: number) => {
      const k = part[idx]!.toBase58();
      res.set(k, info);
    });
  }
  return res;
}

/* ══════════════════════════════════════════════════════════════
   SPORT SCORE CARD
   ══════════════════════════════════════════════════════════════ */

function sportStatusColor(s: string) {
  if (s === "live") return "bg-red-500 text-white";
  if (s === "finished") return "bg-gray-600 text-gray-200";
  if (s === "cancelled" || s === "postponed") return "bg-yellow-600/80 text-yellow-100";
  if (s === "scheduled") return "bg-blue-600/80 text-blue-100";
  return "bg-gray-700 text-gray-200"; // unknown/neutral
}

function resolveDisplayStatus(event: any): DisplayStatus {
  const raw = String(event?.status || "").toLowerCase();
  const hasFinalScore = event?.score?.home != null && event?.score?.away != null;

  if (["finished", "final", "ended", "ft"].includes(raw)) return "finished";
  if (["live", "in_play", "inplay"].includes(raw)) return "live";
  if (["scheduled", "not_started", "notstarted", "ns"].includes(raw)) {
    // Some providers lag status updates; final score should still render as terminal.
    return hasFinalScore ? "finished" : "scheduled";
  }

  // Keep unknown statuses neutral instead of forcing scheduled/live.
  if (hasFinalScore) return "finished";
  return "unknown";
}

function statusBadgeLabel(status: DisplayStatus, minute: string): string {
  if (status === "live") return minute ? `LIVE • ${minute}` : "LIVE";
  if (status === "finished") return "FINAL";
  if (status === "scheduled") return "SCHEDULED";
  return "—";
}

function formatScore(score: Record<string, unknown>, sport: string): string {
  if (!score || !Object.keys(score).length) return "—";
  if (sport === "tennis" && Array.isArray(score.sets)) {
    return (score.sets as number[][]).map(s => s.join("-")).join(", ");
  }
  if (sport === "mma") {
    const parts: string[] = [];
    if (score.round != null) parts.push(`R${score.round}`);
    if (score.method) parts.push(String(score.method));
    return parts.join(" · ") || "—";
  }
  if (score.home != null && score.away != null) {
    return `${score.home} – ${score.away}`;
  }
  return JSON.stringify(score);
}

function pickEventBanner(event: any, meta?: any): string | null {
  const keys = ["strBanner", "strFanart1", "strThumb", "strPoster"];
  const sources = [event?.raw, event?.meta?.raw, meta?.raw, meta?.images, meta];
  for (const key of keys) {
    for (const src of sources) {
      const v = src?.[key];
      if (typeof v === "string" && v.startsWith("http")) return v;
    }
  }
  return null;
}

function pickBadge(event: any, meta: any, side: "home" | "away"): string | null {
  const keys = side === "home"
    ? ["strHomeTeamBadge", "home_badge", "strHomeTeamLogo"]
    : ["strAwayTeamBadge", "away_badge", "strAwayTeamLogo"];
  const sources = [event, event?.raw, event?.meta?.raw, meta, meta?.raw, meta?.images];
  for (const key of keys) {
    for (const src of sources) {
      const v = src?.[key];
      if (typeof v === "string" && v.startsWith("http")) return v;
    }
  }
  return null;
}

function liveLabel(event: any): string {
  const m =
    event?.score?.minute ??
    event?.score?.elapsed ??
    event?.raw?.intProgress ??
    event?.raw?.minute ??
    event?.minute;
  if (m != null && String(m).trim() !== "" && m !== 0 && m !== "0") return `${m}'`;
  return "";
}

function isLiveProviderStatus(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "live" || s === "in_play" || s === "inplay";
}

function nextScorePollDelayMs(status: string, consecutiveFailures: number): number {
  if (!isLiveProviderStatus(status)) return 90_000;
  if (consecutiveFailures <= 0) return 15_000;
  if (consecutiveFailures === 1) return 30_000;
  return 60_000;
}

function predefinedSportDurationMs(sport: string): number {
  const s = String(sport || "").toLowerCase();
  if (s === "soccer" || s === "football") return 110 * 60_000;
  if (s === "basketball" || s === "nba") return 150 * 60_000;
  return NaN;
}

function SportScoreCard({
  event,
  meta,
  displayStatus,
  minute,
  polling,
  stale,
  lastPolledAt,
}: {
  event: SportEvent;
  meta?: any;
  displayStatus: DisplayStatus;
  minute: string;
  polling: boolean;
  stale: boolean;
  lastPolledAt: number | null;
}) {
  const isLive = displayStatus === "live";
  const banner = pickEventBanner(event, meta);
  const homeBadge = pickBadge(event, meta, "home");
  const awayBadge = pickBadge(event, meta, "away");
  const hasScore = event.score && (event.score.home != null || event.score.away != null);
  const fallbackUpdatedAt = parseIsoUtc(event.last_update)?.getTime() ?? NaN;
  const updatedAt = typeof lastPolledAt === "number" && Number.isFinite(lastPolledAt) ? lastPolledAt : fallbackUpdatedAt;
  const kickoffDate = parseIsoUtc(event.start_time);

  return (
    <div className={`rounded-xl border overflow-hidden bg-black ${
      isLive ? "border-red-500/50 shadow-[0_0_24px_rgba(239,68,68,0.15)]" : "border-gray-800"
    }`}>
      {/* Banner image (edge-to-edge) */}
      {banner && (
        <div className="relative h-28 sm:h-36">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={banner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/30" />
        </div>
      )}

      <div className={`px-4 ${banner ? "pt-2 pb-4" : "py-4"}`}>
        {/* Status + league */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${sportStatusColor(displayStatus)}`}>
              {isLive && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1.5 animate-pulse" />
              )}
              {statusBadgeLabel(displayStatus, minute)}
            </span>
            {event.league && (
              <span className="text-xs text-gray-500 truncate max-w-[140px]">{event.league}</span>
            )}
          </div>
          {polling && <span className="inline-block w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />}
        </div>

        {/* Teams + Score */}
        <div className="flex items-center justify-between gap-2">
          {/* Home */}
          <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            {homeBadge ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={homeBadge} alt="" className="w-12 h-12 sm:w-14 sm:h-14 object-contain drop-shadow-lg" />
            ) : (
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/5 flex items-center justify-center text-lg font-bold text-gray-600">
                {(event.home_team || "H")[0]}
              </div>
            )}
            <span className="text-xs sm:text-sm font-semibold text-white text-center leading-tight line-clamp-2">
              {event.home_team || "Home"}
            </span>
          </div>

          {/* Score / VS */}
          <div className="text-center px-2 shrink-0">
            {hasScore ? (
              <div className={`text-2xl sm:text-3xl font-black tabular-nums ${isLive ? "text-pump-green" : "text-white"}`}>
                {formatScore(event.score, event.sport)}
              </div>
            ) : (
              <div className="text-lg font-bold text-gray-600">VS</div>
            )}
          </div>

          {/* Away */}
          <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            {awayBadge ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={awayBadge} alt="" className="w-12 h-12 sm:w-14 sm:h-14 object-contain drop-shadow-lg" />
            ) : (
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/5 flex items-center justify-center text-lg font-bold text-gray-600">
                {(event.away_team || "A")[0]}
              </div>
            )}
            <span className="text-xs sm:text-sm font-semibold text-white text-center leading-tight line-clamp-2">
              {event.away_team || "Away"}
            </span>
          </div>
        </div>

        {/* Kickoff time */}
        {kickoffDate && (
          <div className="text-center mt-3 text-xs text-gray-500">
            {kickoffDate.toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        )}

        {/* Last updated */}
        {Number.isFinite(updatedAt) && (
          <div className="text-center mt-1 text-[10px] text-gray-600">
            Updated {new Date(updatedAt).toLocaleTimeString()}
            {stale && <span className="ml-1 text-gray-500">(stale)</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TRADE PROGRESS MODAL COMPONENT
   ══════════════════════════════════════════════════════════════ */
function TradeProgressModal({
  step,
  result,
  onClose,
}: {
  step: TradeStep;
  result: TradeResult;
  onClose: () => void;
}) {
  if (step === "idle" && !result) return null;

  const isProcessing = step !== "idle" && step !== "done" && step !== "error";

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-pump-dark border border-white/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        
        {/* Processing steps */}
        {isProcessing && (
          <>
            <h3 className="text-xl font-bold text-white mb-4 text-center">Processing trade...</h3>
            
            <div className="space-y-3">
              {/* Step 1: Signing */}
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                step === "signing" 
                  ? "border-pump-green/40 bg-pump-green/10" 
                  : step === "confirming" || step === "updating"
                    ? "border-pump-green/40 bg-pump-green/5"
                    : "border-white/10 bg-white/5"
              }`}>
                <div className="w-6 h-6 flex items-center justify-center">
                  {step === "signing" ? (
                    <div className="w-5 h-5 border-2 border-pump-green border-t-transparent rounded-full animate-spin" />
                  ) : step === "confirming" || step === "updating" ? (
                    <span className="text-pump-green">✓</span>
                  ) : (
                    <span className="text-gray-500">○</span>
                  )}
                </div>
                <span className={step === "signing" ? "text-white font-medium" : "text-gray-400"}>
                  Sign transaction
                </span>
              </div>

              {/* Step 2: Confirming */}
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                step === "confirming" 
                  ? "border-pump-green/40 bg-pump-green/10" 
                  : step === "updating"
                    ? "border-pump-green/40 bg-pump-green/5"
                    : "border-white/10 bg-white/5"
              }`}>
                <div className="w-6 h-6 flex items-center justify-center">
                  {step === "confirming" ? (
                    <div className="w-5 h-5 border-2 border-pump-green border-t-transparent rounded-full animate-spin" />
                  ) : step === "updating" ? (
                    <span className="text-pump-green">✓</span>
                  ) : (
                    <span className="text-gray-500">○</span>
                  )}
                </div>
                <span className={step === "confirming" ? "text-white font-medium" : "text-gray-400"}>
                  Confirming on Solana
                </span>
              </div>

              {/* Step 3: Updating */}
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                step === "updating" 
                  ? "border-pump-green/40 bg-pump-green/10" 
                  : "border-white/10 bg-white/5"
              }`}>
                <div className="w-6 h-6 flex items-center justify-center">
                  {step === "updating" ? (
                    <div className="w-5 h-5 border-2 border-pump-green border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-gray-500">○</span>
                  )}
                </div>
                <span className={step === "updating" ? "text-white font-medium" : "text-gray-400"}>
                  Updating position
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500 text-center mt-4">
              Please don't close this window...
            </p>
          </>
        )}

        {/* Success */}
        {step === "done" && result?.success && (
          <>
            <div className="text-center mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pump-green/20 flex items-center justify-center">
                <span className="text-4xl">✓</span>
              </div>
              <h3 className="text-xl font-bold text-white">Trade successful!</h3>
            </div>

            <div className="bg-black/30 rounded-xl p-4 space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Action</span>
                <span className="text-white font-semibold uppercase">{result.side}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Shares</span>
                <span className="text-white font-semibold">{result.shares}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Outcome</span>
                <span className="text-white font-semibold">{result.outcomeName}</span>
              </div>
              {result.costSol != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">{result.side === "buy" ? "Cost" : "Received"}</span>
                  <span className="text-pump-green font-semibold">{result.costSol.toFixed(4)} SOL</span>
                </div>
              )}
              {result.txSig && (
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-400">Tx</span>
                  <a
                    href={`https://explorer.solana.com/tx/${result.txSig}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-pump-green hover:underline font-mono text-xs"
                  >
                    {shortTxSig(result.txSig)} ↗
                  </a>
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-pump-green text-black font-semibold hover:bg-pump-green/90 transition"
            >
              Close
            </button>
          </>
        )}

        {/* Error */}
        {step === "error" && (
          <>
            <div className="text-center mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-4xl">✕</span>
              </div>
              <h3 className="text-xl font-bold text-white">Trade failed</h3>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
              <p className="text-sm text-red-200">{result?.error || "Unknown error"}</p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function TradePage() {
  const params = useParams();
  const id = safeParamId((params as any)?.id);

  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const isMobile = useIsMobile(1024);

  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Tx guard: prevent double-submit
  const inFlightRef = useRef<Record<string, boolean>>({});

  const [positionShares, setPositionShares] = useState<number[] | null>(null);
  const [marketBalanceLamports, setMarketBalanceLamports] = useState<number | null>(null);

  const [oddsRange, setOddsRange] = useState<OddsRange>("24h");
  const [oddsPoints, setOddsPoints] = useState<{ t: number; pct: number[] }[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>("discussion");

  // Trade modal state
  const [tradeStep, setTradeStep] = useState<TradeStep>("idle");
  const [tradeResult, setTradeResult] = useState<TradeResult>(null);
  const loadOnchainSnapshot = useCallback(async (marketAddress: string) => {
    console.log("[SNAPSHOT] rpc endpoint =", (connection as any)?._rpcEndpoint);
console.log("[SNAPSHOT] marketAddress =", marketAddress);
    try {
      const marketPk = new PublicKey(marketAddress);
  
      // ✅ does not require program
      const mi = await connection.getAccountInfo(marketPk, "confirmed");
      const marketLamports = mi?.lamports != null ? Number(mi.lamports) : null;
  
      const posPda =
        publicKey && connected ? getUserPositionPDA(marketPk, publicKey)[0] : null;
  
      if (!program) {
        return { marketAcc: null as any, posAcc: null as any, marketLamports };
      }
  
      // decode only when program ready
      const keys = posPda ? [marketPk, posPda] : [marketPk];
      const infos = await getMultipleAccountsInfoBatched(connection, keys, 80);
      const coder = (program as any).coder;
  
      const mi2 = infos.get(marketPk.toBase58());
      const marketAcc = mi2?.data ? coder.accounts.decode("market", mi2.data) : null;
  
      let posAcc: any = null;
      if (posPda) {
        const pi = infos.get(posPda.toBase58());
        posAcc = pi?.data ? coder.accounts.decode("userPosition", pi.data) : null;
      }
  
      return { marketAcc, posAcc, marketLamports };
    } catch (e) {
      console.warn("loadOnchainSnapshot failed:", e);
      return { marketAcc: null, posAcc: null, marketLamports: null };
    }
  }, [program, connection, publicKey, connected]);

  useEffect(() => {
    if (!id) return;
  
    (async () => {
      const snap = await loadOnchainSnapshot(id);
      if (snap?.marketLamports != null) {
        setMarketBalanceLamports(snap.marketLamports);
      }
    })();
  }, [id]);

// Live session for this market (for banner CTA)
const [activeLiveSession, setActiveLiveSession] = useState<{ id: string; title: string; status: LiveSessionStatus } | null>(null);
const [sportEvent, setSportEvent] = useState<SportEvent | null>(null);
const [liveScore, setLiveScore] = useState<{
  home_score: number | null; away_score: number | null;
  minute: number | null; status: string;
} | null>(null);
const [liveScorePolling, setLiveScorePolling] = useState(false);
const [liveScoreFailures, setLiveScoreFailures] = useState(0);
const [liveScoreLastSuccessAt, setLiveScoreLastSuccessAt] = useState<number | null>(null);

// Related block (RIGHT column under TradingPanel)
const [relatedTab, setRelatedTab] = useState<RelatedTab>("related");
const [relatedLoading, setRelatedLoading] = useState(false);
const [relatedMarkets, setRelatedMarkets] = useState<any[]>([]);

  // Mobile drawer state
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [mobileOutcomeIndex, setMobileOutcomeIndex] = useState(0);
  const [mobileDefaultSide, setMobileDefaultSide] = useState<"buy" | "sell">("buy");

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const loadMarket = useCallback(
    async (marketAddress: string) => {
      setLoading(true);
      try {
        const [supabaseMarket, snap] = await Promise.all([
          getMarketByAddress(marketAddress),
          loadOnchainSnapshot(marketAddress),
        ]);
        if (!supabaseMarket) {
          setMarket(null);
          return;
        }

        // ✅ fallback DB
const endMs = parseEndDateMs(supabaseMarket?.end_date);
let resolutionTime = Number.isFinite(endMs) ? Math.floor(endMs / 1000) : 0;

  
        const mt = (typeof supabaseMarket.market_type === "number" ? supabaseMarket.market_type : 0) as 0 | 1;
  
        const names = toStringArray(supabaseMarket.outcome_names) ?? [];
        const supplies = toNumberArray(supabaseMarket.outcome_supplies) ?? [];

        const creatorResolveDeadline = addHoursIso(endMs, 24);
  
        const transformed: UiMarket = {
          dbId: supabaseMarket.id,
          publicKey: supabaseMarket.market_address,
          question: supabaseMarket.question || "",
          description: supabaseMarket.description || "",
          category: supabaseMarket.category || "other",
          imageUrl: supabaseMarket.image_url || undefined,
          creator: String(supabaseMarket.creator || ""),
          bLamports: parseBLamports(supabaseMarket) || undefined,
          creatorResolveDeadline,
          totalVolume: Number(supabaseMarket.total_volume) || 0,
          resolutionTime,
          resolved: !!supabaseMarket.resolved || !!snap?.marketAcc?.resolved,
  
          winningOutcome:
            supabaseMarket.winning_outcome === null || supabaseMarket.winning_outcome === undefined
              ? null
              : Number(supabaseMarket.winning_outcome),
          resolvedAt: supabaseMarket.resolved_at ?? null,
  
          resolutionProofUrl: supabaseMarket.resolution_proof_url ?? null,
          resolutionProofImage: supabaseMarket.resolution_proof_image ?? null,
          resolutionProofNote: supabaseMarket.resolution_proof_note ?? null,
  
          resolutionStatus: toResolutionStatus(supabaseMarket.resolution_status),
          proposedOutcome:
            supabaseMarket.proposed_winning_outcome === null || supabaseMarket.proposed_winning_outcome === undefined
              ? null
              : Number(supabaseMarket.proposed_winning_outcome),
          proposedAt: supabaseMarket.resolution_proposed_at ?? null,
          contestDeadline: supabaseMarket.contest_deadline ?? null,
          contested: !!supabaseMarket.contested,
          contestCount:
            supabaseMarket.contest_count === null || supabaseMarket.contest_count === undefined
              ? 0
              : Number(supabaseMarket.contest_count) || 0,
  
          proposedProofUrl: supabaseMarket.proposed_proof_url ?? null,
          proposedProofImage: supabaseMarket.proposed_proof_image ?? null,
          proposedProofNote: supabaseMarket.proposed_proof_note ?? null,
  
          socialLinks: supabaseMarket.social_links || undefined,
  
          marketType: mt,
          outcomeNames: names.slice(0, 10),
          outcomeSupplies: supplies.slice(0, 10),
  
          yesSupply: Number(supabaseMarket.yes_supply) || 0,
          noSupply: Number(supabaseMarket.no_supply) || 0,

          // ✅ Block fields
          isBlocked: !!supabaseMarket.is_blocked,
          blockedReason: supabaseMarket.blocked_reason ?? null,
          blockedAt: supabaseMarket.blocked_at ?? null,

          // Sport fields
          marketMode: (supabaseMarket as any).market_mode ?? null,
          sportEventId: (supabaseMarket as any).sport_event_id ?? null,
          sportMeta: (supabaseMarket as any).sport_meta ?? null,
          sportTradingState: (supabaseMarket as any).sport_trading_state ?? null,
        };
  
// --- On-chain snapshot merge (fast)
if (snap?.marketLamports != null) setMarketBalanceLamports(snap.marketLamports);

if (snap?.posAcc?.shares) {
  const sharesArr = Array.isArray(snap.posAcc.shares)
    ? snap.posAcc.shares.map((x: any) => Number(x) || 0)
    : [];
  setPositionShares(sharesArr);
} else {
  // if no position account yet
  setPositionShares(null);
}

        setMarket(transformed);
      } finally {
        setLoading(false);
      }
    }, [program]);

    useEffect(() => {
      if (!id) return;
      void loadMarket(id);
    }, [id, program, loadMarket]);

    useEffect(() => {
      if (!id) return;
      setMarket(null);
      setLoading(true);
      setPositionShares(null);
      setOddsPoints([]);
      setMobileTradeOpen(false);
      setActiveLiveSession(null);
    }, [id]);

    // Fetch active live session for this market
    useEffect(() => {
      if (!id) return;
      getActiveLiveSessionForMarket(id).then(setActiveLiveSession).catch(() => {});
    }, [id]);

    // Fetch sport event if market is sport-linked
    useEffect(() => {
      if (!market?.sportEventId) { setSportEvent(null); return; }
      getSportEvent(market.sportEventId).then(setSportEvent).catch(() => {});
    }, [market?.sportEventId]);

    // Auto-refresh sport event every 30s while live
    useEffect(() => {
      if (!sportEvent || sportEvent.status !== "live" || !market?.sportEventId) return;
      const iv = setInterval(async () => {
        const updated = await refreshSportEvent(market.sportEventId!).catch(() => null);
        if (updated) setSportEvent(updated);
      }, 30_000);
      return () => clearInterval(iv);
    }, [sportEvent?.status, market?.sportEventId]);

    // Poll /api/sports/live for thesportsdb-linked markets with adaptive interval + stale handling.
    useEffect(() => {
      const meta = market?.sportMeta as any;
      const provider = String(meta?.provider || "");
      const providerEventId = String(meta?.provider_event_id || "");
      if (provider !== "thesportsdb" || !providerEventId || market?.marketMode !== "sport") {
        setLiveScore(null);
        setLiveScorePolling(false);
        setLiveScoreFailures(0);
        setLiveScoreLastSuccessAt(null);
        return;
      }

      let cancelled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let consecutiveFailures = 0;
      let latestKnownStatus = String(sportEvent?.status || "scheduled").toLowerCase();

      setLiveScoreFailures(0);

      const poll = async () => {
        if (cancelled) return;
        setLiveScorePolling(true);

        try {
          const res = await fetch(
            `/api/sports/live?provider=thesportsdb&event_id=${encodeURIComponent(providerEventId)}`,
            { cache: "no-store" },
          );
          if (!res.ok) throw new Error(`live score fetch failed: ${res.status}`);

          const data = await res.json();
          if (cancelled) return;

          const nextStatus = String(data?.status || latestKnownStatus || "unknown").toLowerCase();
          latestKnownStatus = nextStatus;
          consecutiveFailures = 0;
          setLiveScoreFailures(0);
          setLiveScoreLastSuccessAt(Date.now());

          setLiveScore((prev) => ({
            home_score: data?.home_score ?? prev?.home_score ?? null,
            away_score: data?.away_score ?? prev?.away_score ?? null,
            minute: data?.minute ?? prev?.minute ?? null,
            status: nextStatus || prev?.status || "unknown",
          }));
        } catch {
          if (cancelled) return;
          consecutiveFailures += 1;
          setLiveScoreFailures(consecutiveFailures);
        } finally {
          if (!cancelled) setLiveScorePolling(false);
        }

        if (cancelled) return;
        timeoutId = setTimeout(
          poll,
          nextScorePollDelayMs(latestKnownStatus, consecutiveFailures),
        );
      };

      void poll();
      return () => {
        cancelled = true;
        setLiveScorePolling(false);
        if (timeoutId) clearTimeout(timeoutId);
      };
    }, [market?.marketMode, market?.sportMeta, sportEvent?.status]);

    // Realtime market updates: websocket subscription on this trade page only.
    useEffect(() => {
      if (!id || !connection) return;

      let cancelled = false;
      let subId: number | null = null;
      let pollId: ReturnType<typeof setInterval> | null = null;
      const marketPk = new PublicKey(id);
      const coder = (program as any)?.coder;

      const applyFromInfo = (info: any) => {
        if (!info || cancelled) return;
        if (info.lamports != null) setMarketBalanceLamports(Number(info.lamports));
        if (!coder?.accounts?.decode) return;

        try {
          const marketAcc = coder.accounts.decode("market", info.data);
          const rawSupplies = Array.isArray(marketAcc?.q)
            ? marketAcc.q
            : Array.isArray(marketAcc?.outcomeSupplies)
            ? marketAcc.outcomeSupplies
            : [];

          const decodedSupplies = rawSupplies.map((x: any) => toFiniteNumber(x));
          if (!decodedSupplies.length) return;

          setMarket((prev) => {
            if (!prev) return prev;
            const targetLen = prev.outcomeNames?.length || decodedSupplies.length;
            const nextSupplies = decodedSupplies.slice(0, targetLen);
            while (nextSupplies.length < targetLen) nextSupplies.push(0);
            return {
              ...prev,
              outcomeSupplies: nextSupplies.slice(0, 10),
              yesSupply: targetLen >= 1 ? nextSupplies[0] || 0 : prev.yesSupply,
              noSupply: targetLen >= 2 ? nextSupplies[1] || 0 : prev.noSupply,
              resolved: prev.resolved || !!marketAcc?.resolved,
            };
          });
        } catch {
          // Keep fallback polling for environments where decode shape differs.
        }
      };

      const refreshFromRpc = async () => {
        try {
          const info = await connection.getAccountInfo(marketPk, "confirmed");
          if (!cancelled) applyFromInfo(info);
        } catch {
          // ignore rpc errors; fallback loop continues
        }
      };

      void refreshFromRpc();

      try {
        subId = connection.onAccountChange(marketPk, applyFromInfo, "confirmed");
      } catch {
        subId = null;
      }

      if (subId == null || !coder?.accounts?.decode) {
        pollId = setInterval(() => {
          if (document.visibilityState !== "visible") return;
          if (program && coder?.accounts?.decode) {
            void refreshFromRpc();
            return;
          }
          if (!submitting) void loadMarket(id);
        }, 10_000);
      }

      return () => {
        cancelled = true;
        if (pollId) clearInterval(pollId);
        if (subId != null) {
          connection.removeAccountChangeListener(subId).catch(() => {});
        }
      };
    }, [id, connection, program, loadMarket, submitting]);

  // Merge liveScore into sportEvent for display while keeping last known values on fetch errors.
  const sportEventForUi = useMemo(() => {
    if (!sportEvent) return null;
    const ev: any = {
      ...sportEvent,
      score: { ...(sportEvent.score || {}) },
      raw: { ...(sportEvent.raw || {}) },
    };
    if (liveScore) {
      if (liveScore.home_score != null) ev.score.home = liveScore.home_score;
      if (liveScore.away_score != null) ev.score.away = liveScore.away_score;
      if (liveScore.minute != null) {
        ev.score.minute = liveScore.minute;
        ev.raw.intProgress = liveScore.minute;
      }
      if (liveScore.status) ev.status = liveScore.status;
      if (liveScoreLastSuccessAt) ev.last_update = new Date(liveScoreLastSuccessAt).toISOString();
    }
    return ev as SportEvent;
  }, [sportEvent, liveScore, liveScoreLastSuccessAt]);

  const sharedSportDisplayStatus: DisplayStatus = useMemo(
    () => (sportEventForUi ? resolveDisplayStatus(sportEventForUi) : "unknown"),
    [sportEventForUi],
  );
  const sharedSportMinute = useMemo(
    () => (sportEventForUi ? liveLabel(sportEventForUi) : ""),
    [sportEventForUi],
  );

  const derived: Derived | null = useMemo(() => {
    if (!market) return null;

    const marketType = (market.marketType ?? 0) as 0 | 1;

    let names = (market.outcomeNames || []).map(String).filter(Boolean);
    const missingOutcomes = marketType === 1 && names.length < 2;

    if (marketType === 0) {
      if (names.length !== 2) names = ["YES", "NO"];
    }

    const safeNames = missingOutcomes ? ["Loading…", "Loading…"] : names.slice(0, 10);

    let supplies = Array.isArray(market.outcomeSupplies) ? market.outcomeSupplies.map((x) => Number(x || 0)) : [];

    if (!supplies.length && safeNames.length === 2) {
      supplies = [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
    }

    const targetLen = safeNames.length || (marketType === 0 ? 2 : 0);

    if (targetLen > 0) {
      if (supplies.length < targetLen) supplies = [...supplies, ...Array(targetLen - supplies.length).fill(0)];
      else if (supplies.length > targetLen) supplies = supplies.slice(0, targetLen);
    }

    const totalSupply = supplies.reduce((sum, s) => sum + (Number(s) || 0), 0);

    const percentages =
      supplies.length > 0
        ? supplies.map((s) => (totalSupply > 0 ? ((Number(s) || 0) / totalSupply) * 100 : 100 / supplies.length))
        : [];

    return {
      marketType,
      names: safeNames,
      supplies,
      percentages,
      totalSupply,
      isBinaryStyle: safeNames.length === 2,
      missingOutcomes,
    };
  }, [market]);

  const userSharesForUi = useMemo(() => {
    const len = derived?.names?.length ?? 0;
    const out = Array(len).fill(0);
    for (let i = 0; i < len; i++) out[i] = Math.floor(Number(positionShares?.[i] || 0));
    return out;
  }, [positionShares, derived?.names?.length]);

  const filteredOddsPoints = useMemo(() => {
    if (!oddsPoints.length) return [];
    if (oddsRange === "all") return oddsPoints;

    const now = Date.now();
    const cutoff =
      oddsRange === "24h"
        ? now - 24 * 60 * 60 * 1000
        : oddsRange === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000;

    const arr = oddsPoints.filter((p) => p.t >= cutoff);
    if (!arr.length) return [oddsPoints[oddsPoints.length - 1]];
    return arr;
  }, [oddsPoints, oddsRange]);

// Poll ONLY when proposed (so countdown / dispute state updates)
useEffect(() => {
  if (!id) return;
  const status = market?.resolutionStatus ?? "open";
  if (status !== "proposed") return;

  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    if (document.visibilityState !== "visible") return;
    if (submitting) return;
    await loadMarket(id);
  };

  void tick();
  const t = window.setInterval(() => void tick(), 25000);

  return () => {
    cancelled = true;
    window.clearInterval(t);
  };
}, [id, market?.resolutionStatus, submitting, loadMarket]);

  // Related block
  useEffect(() => {
    if (!market?.publicKey) return;
  
    const marketPk = market.publicKey;
    const marketCat = String(market.category || "other");
  
    let cancelled = false;
  
    async function loadRelatedBlock() {
      setRelatedLoading(true);
      try {
        const baseSelect =
          "market_address,question,category,image_url,yes_supply,no_supply,outcome_names,outcome_supplies,end_date,total_volume,resolved";
  
        let q = supabase.from("markets").select(baseSelect).limit(3);
  
        if (relatedTab === "related") {
          q = q
            .eq("category", marketCat)
            .neq("market_address", marketPk)
            .order("total_volume", { ascending: false });
        }
  
        if (relatedTab === "trending") {
          q = q.order("total_volume", { ascending: false });
        }
  
        if (relatedTab === "popular") {
          q = q.order("end_date", { ascending: true });
        }
  
        const { data, error } = await q;
        if (error) throw error;
  
        if (!cancelled) setRelatedMarkets(data || []);
      } catch (e) {
        console.warn("related markets fetch failed:", e);
        if (!cancelled) setRelatedMarkets([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    }
  
    void loadRelatedBlock();
  
    return () => {
      cancelled = true;
    };
  }, [market?.publicKey, market?.category, relatedTab]);

  // Odds history
  useEffect(() => {
    if (!market?.dbId) {
      setOddsPoints([]);
      return;
    }
    const outcomesCount = derived?.names?.length ?? 0;
    if (!outcomesCount) {
      setOddsPoints([]);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("created_at,is_buy,amount,outcome_index,is_yes,shares")
          .eq("market_id", market.dbId)
          .order("created_at", { ascending: true })
.limit(2000);

        if (error) {
          console.error("transactions fetch error:", error);
          setOddsPoints([]);
          return;
        }

        const pts = buildOddsSeries((data as any[]) || [], outcomesCount);
        const lite = downsample(pts, 220).map((p) => ({ t: p.t, pct: p.pct }));
        setOddsPoints(lite);
      } catch (e) {
        console.error("odds history error:", e);
        setOddsPoints([]);
      }
    })();
  }, [market?.dbId, derived?.names?.length]);

  useEffect(() => {
    if (!isMobile) return;
  
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = (document.body.style as any).touchAction;
  
    if (mobileTradeOpen) {
      document.body.style.overflow = "hidden";
      (document.body.style as any).touchAction = "none";
    } else {
      document.body.style.overflow = prevOverflow || "";
      (document.body.style as any).touchAction = prevTouchAction || "";
    }
  
    return () => {
      document.body.style.overflow = prevOverflow || "";
      (document.body.style as any).touchAction = prevTouchAction || "";
    };
  }, [mobileTradeOpen, isMobile]);

  // Close trade modal
  function closeTradeModal() {
    setTradeStep("idle");
    setTradeResult(null);
  }

  async function handleTrade(shares: number, outcomeIndex: number, side: "buy" | "sell", costSol?: number) {
    if (!connected || !publicKey || !program) {
      if (!publicKey) alert("Please connect your wallet");
      if (!program) alert("Program not loaded");
      return;
    }
    if (!market || !id || !derived) return;

    // Tx guard: prevent double-submit (per side)
    const key = "trade";
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;

    const safeShares = Math.max(1, Math.floor(shares));
    const safeOutcome = clampInt(outcomeIndex, 0, derived.names.length - 1);
    const name = derived.names[safeOutcome] || `Outcome #${safeOutcome + 1}`;

    setSubmitting(true);
    setTradeStep("signing");
    setTradeResult(null);

    // optimistic UI
    setMarket((prev) => {
      if (!prev) return prev;
      const nextSupplies = Array.isArray(prev.outcomeSupplies) ? prev.outcomeSupplies.slice() : Array(derived.names.length).fill(0);
      while (nextSupplies.length < derived.names.length) nextSupplies.push(0);

      const delta = side === "buy" ? safeShares : -safeShares;
      nextSupplies[safeOutcome] = Math.max(0, Number(nextSupplies[safeOutcome] || 0) + delta);

      return {
        ...prev,
        outcomeSupplies: nextSupplies.slice(0, 10),
        yesSupply: derived.names.length === 2 ? nextSupplies[0] : prev.yesSupply || 0,
        noSupply: derived.names.length === 2 ? nextSupplies[1] : prev.noSupply || 0,
      };
    });

    if (!signTransaction) {
      setTradeStep("error");
      setTradeResult({
        success: false,
        side,
        shares: safeShares,
        outcomeName: name,
        costSol: costSol ?? null,
        txSig: null,
        error: "Wallet cannot sign transactions",
      });
      setSubmitting(false);
      inFlightRef.current[key] = false;
      return;
    }

    try {
      const marketPubkey = new PublicKey(id);
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
      
        setTradeStep("confirming");
      
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
      
        setTradeStep("confirming");
      
        txSig = await sendSignedTx({
          connection,
          tx,
          signTx: signTransaction,
          feePayer: publicKey,
        });
      }

      setTradeStep("updating");

      const safeCostSol = typeof costSol === "number" && Number.isFinite(costSol) ? costSol : null;

      // Record transaction in DB (non-blocking error)
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
      } catch (dbErr) {
        console.error("DB recordTransaction error (non-fatal):", dbErr);
      }

      const deltaVolLamports = side === "buy" && safeCostSol != null ? solToLamports(safeCostSol) : 0;

      // Update market supplies in DB (non-blocking error)
      try {
        await applyTradeToMarketInSupabase({
          market_address: market.publicKey,
          market_type: market.marketType,
          outcome_index: safeOutcome,
          delta_shares: side === "buy" ? safeShares : -safeShares,
          delta_volume_lamports: deltaVolLamports,
        });
      } catch (dbErr) {
        console.error("DB applyTradeToMarketInSupabase error (non-fatal):", dbErr);
      }

      // Always refresh UI state
      // Refresh fast on-chain first (instant UI), then DB (eventual consistency)
const snap = await loadOnchainSnapshot(id);
if (snap?.marketLamports != null) setMarketBalanceLamports(snap.marketLamports);
if (snap?.posAcc?.shares) {
  const sharesArr = Array.isArray(snap.posAcc.shares) ? snap.posAcc.shares.map((x: any) => Number(x) || 0) : [];
  setPositionShares(sharesArr);
}
await loadMarket(id); // keeps DB in sync (question, proofs, contest, etc.)

      // close drawer on success (mobile)
      if (isMobile) setMobileTradeOpen(false);

      // Show success modal
      setTradeStep("done");
      setTradeResult({
        success: true,
        side,
        shares: safeShares,
        outcomeName: name,
        costSol: safeCostSol,
        txSig,
      });

    } catch (error: any) {
      console.error(`${side.toUpperCase()} shares error:`, error);
      const errMsg = String(error?.message || "");

      // Handle "already been processed" gracefully
      if (errMsg.toLowerCase().includes("already been processed")) {
        // treat as success-ish
        if (isMobile) setMobileTradeOpen(false);
        await loadMarket(id);
        setTradeStep("idle");
        setTradeResult(null);
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        // Revert optimistic UI
        await loadMarket(id);
        setTradeStep("idle");
        setTradeResult(null);
        return;
      }

      // Revert optimistic UI on any error
      await loadMarket(id);
      
      setTradeStep("error");
      setTradeResult({
        success: false,
        side,
        shares: safeShares,
        outcomeName: name,
        costSol: costSol ?? null,
        txSig: null,
        error: errMsg || `Failed to ${side}`,
      });
    } finally {
      inFlightRef.current[key] = false;
      setSubmitting(false);
    }
  }

  // Client-side timer: update `now` every 15s so status badges auto-transition
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(iv);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green" />
          <p className="text-gray-400 mt-4">Loading market...</p>
        </div>
      </div>
    );
  }

  if (!market || !derived) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-xl">Market not found</p>
      </div>
    );
  }

  const { marketType, names, supplies, percentages, isBinaryStyle, missingOutcomes } = derived;


  const nowSec = Math.floor(nowMs / 1000);
  const hasValidEnd = Number.isFinite(market.resolutionTime) && market.resolutionTime > 0;
  const endedByTime = hasValidEnd ? nowSec >= market.resolutionTime : false;
  const sportIsLive = market.marketMode === "sport" && sharedSportDisplayStatus === "live";
  const sportIsFinished = market.marketMode === "sport" && sharedSportDisplayStatus === "finished";

  const status = market.resolutionStatus ?? "open";
  const isResolvedOnChain = !!market.resolved;

  const isProposed =
    status === "proposed" ||
    market.proposedOutcome != null ||
    !!market.contestDeadline ||
    !!market.proposedProofUrl ||
    !!market.proposedProofImage ||
    !!market.proposedProofNote;

  const showProposedBox = isProposed && !isResolvedOnChain;
  const showResolvedProofBox = isResolvedOnChain;

  // Sport status: scheduled → live → locked → finished
  // Read sportStartTime from sportMeta or sportEvent
  const sportStartMs = (() => {
    const raw = sportEventForUi?.start_time || sportEvent?.start_time || (market.sportMeta as any)?.start_time;
    const t = parseIsoUtc(raw)?.getTime() ?? NaN;
    return Number.isFinite(t) ? t : NaN;
  })();
  const sportKey = String(sportEventForUi?.sport || (market.sportMeta as any)?.sport || "").toLowerCase();
  const sportDurationMs = predefinedSportDurationMs(sportKey);
  const sportPredefinedEndMs = Number.isFinite(sportStartMs) && Number.isFinite(sportDurationMs)
    ? sportStartMs + sportDurationMs
    : NaN;
  const hardSportLockMs = Number.isFinite(sportPredefinedEndMs)
    ? sportPredefinedEndMs - 2 * 60_000
    : NaN;
  const hardSportLockReached = Number.isFinite(hardSportLockMs) && nowMs >= hardSportLockMs;

  const ended = market.marketMode === "sport"
    ? (!sportIsLive && endedByTime)
    : endedByTime;

  const sportFinished = sportIsFinished || market.sportTradingState === "ended_by_sport";
  const sportEndMs = parseIsoUtc(sportEventForUi?.end_time)?.getTime() ?? NaN;
  const sportLockMs = Number.isFinite(sportEndMs) ? sportEndMs - 2 * 60_000 : NaN;
  const sportLocked = !sportFinished && (
    hardSportLockReached ||
    (!sportIsLive && Number.isFinite(sportLockMs) && nowMs >= sportLockMs)
  );

  // Compute sport phase: scheduled | live | locked | finished.
  // Provider live status has priority over early time-based checks before predefined end.
  const sportPhase: "scheduled" | "live" | "locked" | "finished" | null = (() => {
    if (!market.marketMode || market.marketMode !== "sport") return null;
    if (sportFinished) return "finished";
    if (sportIsLive && !hardSportLockReached) return "live";
    // Hard guard: match hasn't started yet → always scheduled
    if (Number.isFinite(sportStartMs) && nowMs < sportStartMs) return "scheduled";
    if (sportLocked) return "locked";
    // Fallback: if we have end but no start, use ended check
    if (ended) return "finished";
    return "scheduled";
  })();

  // marketClosed also respects the start_time guard:
  // if match hasn't started, sport-related locks don't apply
  const sportBeforeStart = Number.isFinite(sportStartMs) && nowMs < sportStartMs;
  const marketClosed = isResolvedOnChain || isProposed || ended || !!market.isBlocked
    || sportFinished
    || (!sportBeforeStart && sportLocked);

  const endLabel = hasValidEnd
    ? new Date(market.resolutionTime * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No end date";

  const winningLabel =
    market.winningOutcome != null && Number.isFinite(Number(market.winningOutcome))
      ? names[Math.max(0, Math.min(Number(market.winningOutcome), names.length - 1))] || `Option ${Number(market.winningOutcome) + 1}`
      : null;

  const proposedLabel =
    market.proposedOutcome != null && Number.isFinite(Number(market.proposedOutcome))
      ? names[Math.max(0, Math.min(Number(market.proposedOutcome), names.length - 1))] || `Option ${Number(market.proposedOutcome) + 1}`
      : null;

  const deadlineMs = market.contestDeadline ? new Date(market.contestDeadline).getTime() : NaN;
  const contestRemainingMs = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : NaN;
  const contestOpen = Number.isFinite(contestRemainingMs) ? contestRemainingMs > 0 : false;
  const marketBadgeScore = sportEventForUi?.score &&
    (sportEventForUi.score as any).home != null &&
    (sportEventForUi.score as any).away != null
    ? `${(sportEventForUi.score as any).home}–${(sportEventForUi.score as any).away}`
    : null;

  const openMobileTrade = (idx: number) => {
    if (!isMobile) return;
    setMobileOutcomeIndex(Math.max(0, Math.min(idx, names.length - 1)));
    setMobileDefaultSide("buy"); // ✅ always open on BUY
    setMobileTradeOpen(true);
  };

  return (
    <>
      {/* Trade Progress Modal */}
      <TradeProgressModal
        step={tradeStep}
        result={tradeResult}
        onClose={closeTradeModal}
      />

      {/* 
        SCROLL CONTAINER - Un seul conteneur scrollable qui englobe tout.
        La colonne droite est sticky à l'intérieur.
      */}
      <div 
        ref={scrollContainerRef}
        className="h-full lg:overflow-y-auto"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* Grid 2 colonnes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative">
            
            {/* ════════════════════════════════════════════════════════════
                LEFT COLUMN - Contenu qui scroll avec la page
                ════════════════════════════════════════════════════════════ */}
            <div className="lg:col-span-2 space-y-6">
              {/* Live session banner CTA */}
              {activeLiveSession && (
                <Link
                  href={`/live/${activeLiveSession.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 transition group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                    </span>
                    <span className="text-sm text-white font-medium truncate">
                      This market is <span className="font-bold text-red-400">LIVE</span> — Watch &amp; trade
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-red-400 group-hover:text-white transition px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10">
                    Watch Live
                  </span>
                </Link>
              )}

              {/* Sport score card */}
              {sportEventForUi && market.marketMode === "sport" && (
                <SportScoreCard
                  event={sportEventForUi}
                  meta={market?.sportMeta}
                  displayStatus={sharedSportDisplayStatus}
                  minute={sharedSportMinute}
                  polling={liveScorePolling}
                  stale={liveScoreFailures >= 3}
                  lastPolledAt={liveScoreLastSuccessAt}
                />
              )}

              {/* Sport trading state banners */}
              {sportPhase === "locked" && (
                <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200 flex items-center gap-2">
                  Match ending soon, trading locked
                </div>
              )}
              {sportPhase === "finished" && (
                <div className="rounded-xl border border-gray-600 bg-gray-800/40 px-4 py-3 text-sm text-gray-300 flex items-center gap-2">
                  Match ended — trading closed
                </div>
              )}

              {/* Market card */}
              <div className="bg-black border border-gray-800 rounded-xl p-4 md:p-5 hover:border-pump-green/60 transition-all duration-200">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden bg-pump-dark">
                    {market.imageUrl ? (
                      <Image
                        src={market.imageUrl}
                        alt={market.question}
                        width={80}
                        height={80}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <CategoryImagePlaceholder
                        category={market.category || "crypto"}
                        className="w-full h-full scale-[0.4]"
                      />
                    )}
                  </div>
  
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-2 min-w-0">
                      <h1 className="text-xl md:text-2xl font-bold text-white leading-tight break-words min-w-0">
                        {market.question}
                      </h1>
  
                      <div className="flex justify-end md:justify-start">
                        <MarketActions
                          marketAddress={market.publicKey}
                          marketDbId={market.dbId ?? null}
                          question={market.question}
                        />
                      </div>
                    </div>
  
                    {market.socialLinks && (
                      <div className="mb-0">
                        <CreatorSocialLinks socialLinks={market.socialLinks} />
                      </div>
                    )}
                  </div>
                </div>
  
                <div className="flex items-center gap-4 text-sm text-gray-400 mt-3 pt-3 border-t border-gray-800">
                  <div>
                    <span className="text-xs text-gray-400">Vol</span>{" "}
                    <span className="text-base md:text-lg font-semibold text-white">
                      {formatVol(market.totalVolume)} SOL
                    </span>
                  </div>
  
                  <div>{endLabel}</div>
  
                  <div className="ml-auto text-xs text-gray-500 flex items-center gap-2">
                    {/* Blocked badge */}
                    {market.isBlocked && (
                      <span className="px-2 py-1 rounded-full border border-red-600/40 bg-red-600/20 text-red-400">
                        Blocked
                      </span>
                    )}

                    {/* Sport phase badges */}
                    {!market.isBlocked && sportPhase !== "locked" && sharedSportDisplayStatus === "scheduled" && !showProposedBox && !showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-400">
                        Scheduled
                      </span>
                    )}
                    {!market.isBlocked && sportPhase !== "locked" && sharedSportDisplayStatus === "live" && !showProposedBox && !showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        Live
                        {sharedSportMinute && <span className="text-red-300">• {sharedSportMinute}</span>}
                        {marketBadgeScore && (
                          <span className="ml-1 font-mono text-white">
                            {marketBadgeScore}
                          </span>
                        )}
                      </span>
                    )}
                    {!market.isBlocked && sportPhase !== "locked" && sharedSportDisplayStatus === "finished" && !showProposedBox && !showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-gray-500/40 bg-gray-700/30 text-gray-200 flex items-center gap-1">
                        Final
                        {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                      </span>
                    )}
                    {!market.isBlocked && sportPhase !== "locked" && sharedSportDisplayStatus === "unknown" && !showProposedBox && !showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-gray-600/40 bg-gray-700/20 text-gray-300">—</span>
                    )}

                    {showProposedBox && !market.isBlocked && (
                      <span className="px-2 py-1 rounded-full border border-pump-green/40 bg-pump-green/10 text-pump-green">
                        Proposed
                      </span>
                    )}

                    {showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-gray-600 bg-gray-800/40 text-green-400">
                        Resolved
                      </span>
                    )}
                  </div>
                </div>
  
                <p className="text-gray-400 text-sm mt-3 mb-3">{market.description}</p>
  
                {missingOutcomes && (
                  <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                    Outcomes are still indexing… (Supabase/outcomes not ready yet)
                  </div>
                )}
  
                {showProposedBox && !market.isBlocked && (
                  <div className="mb-4 rounded-xl border border-pump-green/30 bg-pump-green/10 p-4">
                    <div className="text-sm text-white font-semibold">
                      Resolution proposed — contest window open
                    </div>
                    <div className="text-xs text-gray-300 mt-1">
                      Trading is locked while the resolution is contestable.
                      <p className="mt-1 text-xs text-gray-300">
  Once the dispute window ends, an admin will validate the final outcome and trigger payouts. This may take some time.
</p>
                      {contestOpen && Number.isFinite(contestRemainingMs) ? (
                        <>
                          {" "}
                          <span className="text-pump-green font-semibold">
                            {formatMsToHhMm(contestRemainingMs)} remaining
                          </span>
                        </>
                      ) : (
                        <>
                          {" "}
                          <span className="text-yellow-300 font-semibold">
                            contest window may have ended
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}
  
                {/* Outcomes */}
                {isBinaryStyle ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {names.slice(0, 2).map((outcome, index) => {
                      const pct = (percentages[index] ?? 0).toFixed(1);
                      const isYes = index === 0;

                      return (
                        <button
                          key={index}
                          onClick={() => openMobileTrade(index)}
                          disabled={!isMobile || marketClosed}
                          className={`text-left rounded-xl px-4 py-3 md:px-5 md:py-4 border bg-black transition ${
                            isYes
                              ? "border-pump-green/60"
                              : "border-[#ff5c73]/60"
                          } ${isMobile && !marketClosed ? "active:scale-[0.99]" : ""}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`uppercase tracking-wide text-xs font-semibold ${
                              isYes ? "text-pump-green" : "text-[#ff5c73]"
                            }`}>
                              {outcome}
                            </span>
                            <span className="hidden md:block text-[11px] text-gray-500">Supply: {supplies[index] || 0}</span>
                          </div>

                          <div
                            className={`text-2xl md:text-3xl font-bold tabular-nums ${
                              isYes ? "text-pump-green" : "text-[#ff5c73]"
                            }`}
                          >
                            {pct}%
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {names.map((outcome, index) => (
                      <button
                        key={index}
                        onClick={() => openMobileTrade(index)}
                        disabled={!isMobile || marketClosed}
                        className={`text-left rounded-xl px-3 py-2.5 md:p-3 border border-gray-800 bg-black transition ${
                          isMobile && !marketClosed ? "active:scale-[0.99]" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-white truncate">
                            {outcome}
                          </div>
                          <div className="text-pump-green font-bold">
                            {(percentages[index] ?? 0).toFixed(1)}%
                          </div>
                        </div>
                        <div className="hidden md:block mt-1 text-[11px] text-gray-500">
                          Supply: {supplies[index] || 0}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
  
              </div>
  
              {/* Odds history */}
              <div className="bg-black border border-gray-800 rounded-xl p-4 md:p-5">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-white">Odds history</h2>
                </div>
  
                {filteredOddsPoints.length ? (
                  <>
                    <OddsHistoryChart
                      points={filteredOddsPoints}
                      outcomeNames={names}
                    />
  
                    <div className="mt-4 flex items-center justify-center gap-2">
                      {(["24h", "7d", "30d", "all"] as OddsRange[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setOddsRange(r)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                            oddsRange === r
                              ? "bg-pump-green text-black"
                              : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
                          }`}
                        >
                          {r.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500 border border-gray-800 rounded-lg p-4">
                    No history yet (need transactions for this market).
                  </div>
                )}
              </div>
  
              {/* Discussion / Activity */}
              <div className="mt-2 pb-8">
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setBottomTab("discussion")}
                    className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
                      bottomTab === "discussion"
                        ? "bg-pump-green/15 border-pump-green text-pump-green"
                        : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    Discussion
                  </button>
  
                  <button
                    onClick={() => setBottomTab("activity")}
                    className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
                      bottomTab === "activity"
                        ? "bg-pump-green/15 border-pump-green text-pump-green"
                        : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    Activity
                  </button>
                </div>
  
                {bottomTab === "discussion" ? (
                  <CommentsSection marketId={market.publicKey} />
                ) : (
                  <MarketActivityTab
                    marketDbId={market.dbId}
                    marketAddress={market.publicKey}
                    outcomeNames={names}
                  />
                )}
              </div>
            </div>
  
            {/* ════════════════════════════════════════════════════════════
                RIGHT COLUMN - STICKY (reste fixe pendant le scroll)
                ════════════════════════════════════════════════════════════ */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-6 space-y-4 pb-8">
                {/* ✅ Show BlockedMarketBanner instead of TradingPanel if blocked */}
                {market.isBlocked ? (
                  <BlockedMarketBanner 
                    reason={market.blockedReason} 
                    blockedAt={market.blockedAt} 
                  />
                ) : !isMobile ? (
                  <TradingPanel
                    mode="desktop"
                    market={{
                      resolved: market.resolved,
                      marketType: market.marketType,
                      outcomeNames: names,
                      outcomeSupplies: supplies,
                      bLamports: market.bLamports,
                      yesSupply:
                        names.length >= 2 ? supplies[0] || 0 : market.yesSupply || 0,
                      noSupply:
                        names.length >= 2 ? supplies[1] || 0 : market.noSupply || 0,
                    }}
                    connected={connected}
                    submitting={submitting}
                    onTrade={(s, outcomeIndex, side, costSol) =>
                      void handleTrade(s, outcomeIndex, side, costSol)
                    }
                    marketBalanceLamports={marketBalanceLamports}
                    userHoldings={userSharesForUi}
                    marketClosed={marketClosed}
                  />
                ) : null}
  
                <ResolutionPanel
                  marketAddress={market.publicKey}
                  resolutionStatus={market.resolutionStatus ?? "open"}
                  proposedOutcomeLabel={proposedLabel}
                  proposedAt={market.proposedAt}
                  contestDeadline={market.contestDeadline}
                  contestCount={market.contestCount ?? 0}
                  proposedProofUrl={market.proposedProofUrl}
                  proposedProofImage={market.proposedProofImage}
                  proposedProofNote={market.proposedProofNote}
                  resolved={!!market.resolved}
                  winningOutcomeLabel={winningLabel}
                  resolvedAt={market.resolvedAt}
                  resolutionProofUrl={market.resolutionProofUrl}
                  resolutionProofImage={market.resolutionProofImage}
                  resolutionProofNote={market.resolutionProofNote}
                  ended={ended}
                  creatorResolveDeadline={market.creatorResolveDeadline ?? null}
                />
  
                {/* Related block */}
                <div className="card-pump p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-white font-bold">Related</h3>
                    <span className="text-xs text-gray-500">
                      {(market.category || "other").toString()}
                    </span>
                  </div>
  
                  <div className="flex gap-2 mb-4">
                    {(["related", "trending", "popular"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setRelatedTab(t)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                          relatedTab === t
                            ? "bg-pump-green/15 border-pump-green text-pump-green"
                            : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
                        }`}
                      >
                        {t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
  
                  {relatedLoading ? (
                    <div className="text-sm text-gray-500">Loading…</div>
                  ) : relatedMarkets.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No related markets yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {relatedMarkets.map((m) => {
                        const pct = marketTopPct(m);
                        const vol = lamportsToSol(Number(m.total_volume) || 0).toFixed(2);
  
                        return (
                          <Link
                            key={m.market_address}
                            href={`/trade/${m.market_address}`}
                            className="flex items-center gap-3 rounded-xl border border-gray-800 bg-pump-dark/40 p-3 hover:border-pump-green/60 transition"
                          >
                            <div className="h-10 w-10 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
                              {m.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={m.image_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="opacity-70 scale-[0.55]">
                                  <CategoryImagePlaceholder
                                    category={(m.category || "other").toString()}
                                  />
                                </div>
                              )}
                            </div>
  
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-white truncate">
                                {m.question}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {(m.category || "other").toString()} • {vol} SOL
                              </div>
                            </div>
  
                            <div className="text-sm font-bold text-pump-green tabular-nums">
                              {pct}%
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  
      {/* Mobile drawer - FULLSCREEN from top to bottom nav (h-14 = 56px) */}
      {/* ✅ Don't open if blocked (marketClosed includes isBlocked) */}
      {isMobile && mobileTradeOpen && !marketClosed && (
        <div className="fixed inset-0 z-[200] pointer-events-none">
          {/* Backdrop: couvre tout l'écran sauf la bottom nav */}
          <button
            className="absolute inset-x-0 top-0 bottom-14 bg-black/60 pointer-events-auto"
            onClick={() => setMobileTradeOpen(false)}
            aria-label="Close overlay"
          />

          {/* Drawer: du haut de l'écran jusqu'à la bottom nav, sans coins arrondis */}
          <div className="absolute inset-x-0 top-0 bottom-14 pointer-events-auto">
            <div className="h-full border-b border-gray-800 bg-pump-dark shadow-2xl overflow-hidden">
              <TradingPanel
                mode="drawer"
                title="Trade"
                defaultSide={mobileDefaultSide}
                defaultOutcomeIndex={mobileOutcomeIndex}
                onClose={() => setMobileTradeOpen(false)}
                market={{
                  resolved: market.resolved,
                  marketType: market.marketType,
                  outcomeNames: names,
                  outcomeSupplies: supplies,
                  bLamports: market.bLamports,
                  yesSupply: names.length >= 2 ? supplies[0] || 0 : market.yesSupply || 0,
                  noSupply: names.length >= 2 ? supplies[1] || 0 : market.noSupply || 0,
                }}
                connected={connected}
                submitting={submitting}
                onTrade={(s, outcomeIndex, side, costSol) => void handleTrade(s, outcomeIndex, side, costSol)}
                marketBalanceLamports={marketBalanceLamports}
                userHoldings={userSharesForUi}
                marketClosed={marketClosed}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
