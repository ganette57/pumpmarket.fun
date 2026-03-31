"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

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
import TradeBuyPopOverlay from "@/components/TradeBuyPopOverlay";
import NbaWidgetDrawer from "@/components/NbaWidgetDrawer";
import SoccerMatchDrawer from "@/components/SoccerMatchDrawer";
import FlashCryptoMiniChart from "@/components/FlashCryptoMiniChart";
import FlashCryptoGraduationHero from "@/components/FlashCryptoGraduationHero";

import { supabase } from "@/lib/supabaseClient";
import { buildOddsSeries, downsample } from "@/lib/marketHistory";
import {
  getMarketByAddress,
  recordTransaction,
  applyTradeToMarketInSupabase,
  parseSupabaseEndDateToResolutionTime,
} from "@/lib/markets";

import { lamportsToSol, solToLamports, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";
import { solanaExplorerTxUrl } from "@/utils/explorer";
import { getActiveLiveSessionForMarket, type LiveSessionStatus } from "@/lib/liveSessions";
import { getSportEvent, refreshSportEvent, type SportEvent } from "@/lib/sportEvents";
import { getFlashCryptoMajorConfigBySymbol } from "@/lib/flashCrypto/majors";

import type { SocialLinks } from "@/components/SocialLinksForm";
import { useCallback } from "react";
import { sendSignedTx } from "@/lib/solanaSend";
import Link from "next/link";
import { getProfile, type Profile } from "@/lib/profiles";

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
  startTime?: string | null;
  endTime?: string | null;
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
type BottomTab = "discussion" | "activity" | "rules";

type RelatedTab = "related" | "trending" | "popular";
type ScorePair = { home: number; away: number };
type ResolvedLiveScore = {
  home: number | null;
  away: number | null;
  source: string | null;
  ignoredSources: string[];
};

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

function applyMarketDbPatch(prev: UiMarket, row: any, allowSupplyPatch = false): UiMarket {
  if (!row || typeof row !== "object") return prev;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(row, k);
  const next: UiMarket = { ...prev };

  if (has("resolution_status")) next.resolutionStatus = toResolutionStatus(row.resolution_status);
  if (has("proposed_winning_outcome")) {
    next.proposedOutcome =
      row.proposed_winning_outcome == null ? null : Number(row.proposed_winning_outcome);
  }
  if (has("resolution_proposed_at")) next.proposedAt = row.resolution_proposed_at ?? null;
  if (has("contest_deadline")) next.contestDeadline = row.contest_deadline ?? null;
  if (has("contested")) next.contested = !!row.contested;
  if (has("contest_count")) next.contestCount = row.contest_count == null ? 0 : Number(row.contest_count) || 0;

  if (has("proposed_proof_url")) next.proposedProofUrl = row.proposed_proof_url ?? null;
  if (has("proposed_proof_image")) next.proposedProofImage = row.proposed_proof_image ?? null;
  if (has("proposed_proof_note")) next.proposedProofNote = row.proposed_proof_note ?? null;

  if (has("resolved")) next.resolved = !!row.resolved;
  if (has("resolved_at")) next.resolvedAt = row.resolved_at ?? null;
  if (has("winning_outcome")) next.winningOutcome = row.winning_outcome == null ? null : Number(row.winning_outcome);
  if (has("resolution_proof_url")) next.resolutionProofUrl = row.resolution_proof_url ?? null;
  if (has("resolution_proof_image")) next.resolutionProofImage = row.resolution_proof_image ?? null;
  if (has("resolution_proof_note")) next.resolutionProofNote = row.resolution_proof_note ?? null;

  if (has("is_blocked")) next.isBlocked = !!row.is_blocked;
  if (has("blocked_reason")) next.blockedReason = row.blocked_reason ?? null;
  if (has("blocked_at")) next.blockedAt = row.blocked_at ?? null;

  if (has("sport_trading_state")) next.sportTradingState = row.sport_trading_state ?? null;
  if (has("start_time")) next.startTime = row.start_time ?? null;
  if (has("end_time")) next.endTime = row.end_time ?? null;

  if (allowSupplyPatch) {
    const dbSupplies = toNumberArray(row.outcome_supplies);
    if (dbSupplies && dbSupplies.length > 0) {
      const clipped = dbSupplies.slice(0, 10);
      next.outcomeSupplies = clipped;
      if (next.marketType === 0) {
        if (clipped.length >= 2) {
          next.yesSupply = Number(clipped[0]) || 0;
          next.noSupply = Number(clipped[1]) || 0;
        } else {
          if (has("yes_supply")) next.yesSupply = Number(row.yes_supply) || 0;
          if (has("no_supply")) next.noSupply = Number(row.no_supply) || 0;
        }
      }
    } else if (next.marketType === 0) {
      if (has("yes_supply")) next.yesSupply = Number(row.yes_supply) || 0;
      if (has("no_supply")) next.noSupply = Number(row.no_supply) || 0;
    }
  }

  return next;
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
 * Parse end_date via shared UTC-safe parser from markets.ts:
 * - if timezone suffix is missing, parser appends "Z"
 */
function parseEndDateMs(raw: any): number {
  const sec = parseSupabaseEndDateToResolutionTime(raw);
  return sec > 0 ? sec * 1000 : NaN;
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
  if (["finished", "final", "ended", "ft", "completed"].includes(raw)) return "finished";
  if (["live", "in_play", "inplay"].includes(raw)) return "live";
  if (["scheduled", "not_started", "notstarted", "ns"].includes(raw)) return "scheduled";

  const minute = extractMinuteNumber(event);
  if (Number.isFinite(minute) && minute > 0) return "live";
  return "unknown";
}

function statusBadgeLabel(status: DisplayStatus, minute: string): string {
  if (status === "live") return minute ? `LIVE ${minute}` : "LIVE";
  if (status === "finished") return "FINAL";
  if (status === "scheduled") return "SCHEDULED";
  return "—";
}

function formatLiveScore(scoreLike: unknown): string | null {
  let score: any = scoreLike;
  if (typeof score === "string") {
    try {
      score = JSON.parse(score);
    } catch {
      return null;
    }
  }
  if (!score || typeof score !== "object") return null;

  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const status = String(score.status ?? score.state ?? "").toLowerCase();
  const statusText = typeof score?.raw?.status_text === "string" ? score.raw.status_text.trim() : "";
  const isLive = ["live", "in_play", "inplay"].includes(status);
  const suffix = isLive && statusText ? ` · ${statusText}` : "";

  const pairs: Array<{ home: unknown; away: unknown; allowPartial: boolean }> = [
    { home: score.home, away: score.away, allowPartial: true },
    { home: score.home_score, away: score.away_score, allowPartial: true },
    { home: score.local, away: score.visitor, allowPartial: true },
    { home: score.h, away: score.a, allowPartial: true },
  ];

  for (const pair of pairs) {
    const home = toNum(pair.home);
    const away = toNum(pair.away);
    if (home != null && away != null) return `${home} – ${away}${suffix}`;
    if (pair.allowPartial && (home != null || away != null)) {
      return `${home ?? 0} – ${away ?? 0}${suffix}`;
    }
  }

  return null;
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
  return formatLiveScore(score) || "—";
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function extractScorePair(event: any): { home: number; away: number } | null {
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const pairs: Array<{ home: unknown; away: unknown; allowPartial: boolean }> = [
    { home: event?.score?.home, away: event?.score?.away, allowPartial: true },
    { home: event?.score?.home_score, away: event?.score?.away_score, allowPartial: true },
    { home: event?.score?.local, away: event?.score?.visitor, allowPartial: true },
    { home: event?.score?.h, away: event?.score?.a, allowPartial: true },
  ];

  for (const pair of pairs) {
    const home = toNum(pair.home);
    const away = toNum(pair.away);
    if (home != null && away != null) return { home, away };
    if (pair.allowPartial && (home != null || away != null)) {
      return { home: home ?? 0, away: away ?? 0 };
    }
  }

  return null;
}

function toStrictScorePair(homeLike: unknown, awayLike: unknown): ScorePair | null {
  const home = Number(homeLike);
  const away = Number(awayLike);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function extractScorePairFromUnknown(value: unknown, depth = 0): ScorePair | null {
  if (depth > 4 || value == null) return null;

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;

    try {
      return extractScorePairFromUnknown(JSON.parse(raw), depth + 1);
    } catch {
      return parseScorePairFromText(raw);
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const pair = extractScorePairFromUnknown(entry, depth + 1);
      if (pair) return pair;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  const directPairs: Array<ScorePair | null> = [
    toStrictScorePair(obj.home, obj.away),
    toStrictScorePair(obj.home_score, obj.away_score),
    toStrictScorePair(obj.local, obj.visitor),
    toStrictScorePair(obj.h, obj.a),
    toStrictScorePair(obj.homeScore, obj.awayScore),
  ];
  for (const pair of directPairs) {
    if (pair) return pair;
  }

  const nestedCandidates = [
    obj.score,
    obj.current_score,
    obj.live_score,
    obj.result,
    obj.raw,
    obj.live,
    obj.payload,
    obj.data,
    obj.provider_payload_start,
    obj.provider_payload_end,
  ];

  for (const nested of nestedCandidates) {
    const pair = extractScorePairFromUnknown(nested, depth + 1);
    if (pair) return pair;
  }

  return null;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur == null) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cur) || key < 0 || key >= cur.length) return undefined;
      cur = cur[key];
      continue;
    }
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseJsonObjectFromText(input: string | null | undefined): Record<string, unknown> | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return null;
}

type FlashCryptoProofMetrics = {
  startPrice: number | null;
  finalPrice: number | null;
  percentChange: number | null;
};

type FlashCryptoGraduationMetrics = {
  progressStart: number | null;
  progressEnd: number | null;
  didGraduateStart: boolean | null;
  didGraduateEnd: boolean | null;
  remainingToGraduateStart: number | null;
  remainingToGraduateEnd: number | null;
};

function parseFlashCryptoProofMetrics(note: string | null | undefined): FlashCryptoProofMetrics {
  const parsed = parseJsonObjectFromText(note);
  if (!parsed) {
    return { startPrice: null, finalPrice: null, percentChange: null };
  }

  const startPrice = firstFiniteNumber([
    parsed.start_price,
    parsed.price_start,
    parsed.priceStart,
  ]);
  const finalPrice = firstFiniteNumber([
    parsed.end_price,
    parsed.price_end,
    parsed.priceEnd,
    parsed.final_price,
    parsed.finalPrice,
  ]);
  const percentChange = firstFiniteNumber([
    parsed.percent_change,
    parsed.pct_change,
    parsed.change_pct,
    parsed.percentChange,
  ]);

  return { startPrice, finalPrice, percentChange };
}

function parseTruthyFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["true", "1", "yes", "y", "graduated", "complete"].includes(raw)) return true;
  if (["false", "0", "no", "n"].includes(raw)) return false;
  return null;
}

function parseFlashCryptoGraduationMetrics(note: string | null | undefined): FlashCryptoGraduationMetrics {
  const parsed = parseJsonObjectFromText(note);
  if (!parsed) {
    return {
      progressStart: null,
      progressEnd: null,
      didGraduateStart: null,
      didGraduateEnd: null,
      remainingToGraduateStart: null,
      remainingToGraduateEnd: null,
    };
  }

  const progressStart = firstFiniteNumber([
    parsed.progress_start,
    parsed.progressStart,
    parsed.bonding_progress_start,
  ]);
  const progressEnd = firstFiniteNumber([
    parsed.progress_end,
    parsed.progressEnd,
    parsed.bonding_progress_end,
  ]);
  const didGraduateStart = parseTruthyFlag(parsed.did_graduate_start);
  const didGraduateEnd = parseTruthyFlag(parsed.did_graduate_end ?? parsed.graduate_status_final);
  const remainingToGraduateStart = firstFiniteNumber([
    parsed.remaining_to_graduate_start,
    parsed.remainingToGraduateStart,
  ]);
  const remainingToGraduateEnd = firstFiniteNumber([
    parsed.remaining_to_graduate_end,
    parsed.remainingToGraduateEnd,
  ]);

  return {
    progressStart,
    progressEnd,
    didGraduateStart,
    didGraduateEnd,
    remainingToGraduateStart,
    remainingToGraduateEnd,
  };
}

function formatFlashCryptoPrice(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.000001) return value.toExponential(4);
  if (Math.abs(value) < 0.01) return value.toFixed(8);
  if (Math.abs(value) < 1) return value.toFixed(6);
  return value.toFixed(4);
}

function formatFlashProgress(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const safe = Math.max(0, Math.min(100, value));
  return `${safe.toFixed(1)}%`;
}

function scoreFromLiveMicroPayload(payload: Record<string, unknown> | null | undefined): ScorePair | null {
  const home = firstFiniteNumber([
    readPath(payload, ["current_score", "home"]),
    readPath(payload, ["score", "home"]),
    readPath(payload, ["event", "score", "home"]),
    readPath(payload, ["live", "home_score"]),
    readPath(payload, ["fixture", "goals", "home"]),
    readPath(payload, ["event", "raw", "full", "goals", "home"]),
    readPath(payload, ["event", "raw", "goals", "home"]),
  ]);
  const away = firstFiniteNumber([
    readPath(payload, ["current_score", "away"]),
    readPath(payload, ["score", "away"]),
    readPath(payload, ["event", "score", "away"]),
    readPath(payload, ["live", "away_score"]),
    readPath(payload, ["fixture", "goals", "away"]),
    readPath(payload, ["event", "raw", "full", "goals", "away"]),
    readPath(payload, ["event", "raw", "goals", "away"]),
  ]);
  if (home == null || away == null) return null;
  return { home: Math.max(0, Math.floor(home)), away: Math.max(0, Math.floor(away)) };
}

function scoreFromLiveMicroRow(liveMicroPayload: {
  start_home_score?: number | null;
  start_away_score?: number | null;
  end_home_score?: number | null;
  end_away_score?: number | null;
} | null): ScorePair | null {
  if (!liveMicroPayload) return null;
  const home = firstFiniteNumber([liveMicroPayload.end_home_score, liveMicroPayload.start_home_score]);
  const away = firstFiniteNumber([liveMicroPayload.end_away_score, liveMicroPayload.start_away_score]);
  if (home == null || away == null) return null;
  return { home: Math.max(0, Math.floor(home)), away: Math.max(0, Math.floor(away)) };
}

function resolveBestLiveScore({
  liveScore,
  sportEventForUi,
  liveMicroPayload,
  market,
  lastKnownScore,
}: {
  liveScore: {
    home_score: number | null;
    away_score: number | null;
    raw?: Record<string, unknown> | null;
  } | null;
  sportEventForUi: SportEvent | null;
  liveMicroPayload: {
    provider_payload_start?: Record<string, unknown> | null;
    provider_payload_end?: Record<string, unknown> | null;
    start_home_score?: number | null;
    start_away_score?: number | null;
    end_home_score?: number | null;
    end_away_score?: number | null;
  } | null;
  market: UiMarket | null;
  lastKnownScore: ScorePair | null;
}): ResolvedLiveScore {
  const ignoredSources: string[] = [];
  const pick = (source: string, value: unknown): ScorePair | null => {
    const pair = extractScorePairFromUnknown(value);
    if (!pair) ignoredSources.push(source);
    return pair;
  };

  const homePayloadPair =
    scoreFromLiveMicroPayload(liveMicroPayload?.provider_payload_end) ||
    scoreFromLiveMicroPayload(liveMicroPayload?.provider_payload_start);
  if (homePayloadPair) {
    return {
      home: homePayloadPair.home,
      away: homePayloadPair.away,
      source: "home-live-micro:payload",
      ignoredSources,
    };
  }
  ignoredSources.push("home-live-micro:payload");

  const homeRowPair = scoreFromLiveMicroRow(liveMicroPayload);
  if (homeRowPair) {
    return {
      home: homeRowPair.home,
      away: homeRowPair.away,
      source: "home-live-micro:row",
      ignoredSources,
    };
  }
  ignoredSources.push("home-live-micro:row");

  const providerCandidates: Array<{ source: string; value: unknown }> = [
    { source: "live-provider:direct", value: { home: liveScore?.home_score ?? null, away: liveScore?.away_score ?? null } },
    { source: "live-provider:raw", value: liveScore?.raw ?? null },
  ];
  for (const candidate of providerCandidates) {
    const pair = pick(candidate.source, candidate.value);
    if (pair) {
      return { home: pair.home, away: pair.away, source: candidate.source, ignoredSources };
    }
  }

  const sportCandidates: Array<{ source: string; value: unknown }> = [
    { source: "sport-event:score", value: sportEventForUi?.score ?? null },
    { source: "sport-event:raw", value: (sportEventForUi as any)?.raw ?? null },
    { source: "sport-event:event", value: sportEventForUi ?? null },
  ];
  for (const candidate of sportCandidates) {
    const pair = pick(candidate.source, candidate.value);
    if (pair) {
      return { home: pair.home, away: pair.away, source: candidate.source, ignoredSources };
    }
  }

  const isPostLive =
    !!market?.resolved ||
    market?.resolutionStatus === "proposed" ||
    market?.resolutionStatus === "finalized" ||
    market?.resolutionStatus === "cancelled" ||
    market?.proposedOutcome != null ||
    !!market?.contestDeadline;
  if (isPostLive) {
    const proofCandidates: Array<{ source: string; value: unknown }> = [
      { source: "proof:proposed_note", value: market?.proposedProofNote ?? null },
      { source: "proof:resolved_note", value: market?.resolutionProofNote ?? null },
    ];
    for (const candidate of proofCandidates) {
      const pair = pick(candidate.source, candidate.value);
      if (pair) {
        return { home: pair.home, away: pair.away, source: candidate.source, ignoredSources };
      }
    }
  }

  if (lastKnownScore) {
    return {
      home: lastKnownScore.home,
      away: lastKnownScore.away,
      source: "last-known",
      ignoredSources,
    };
  }

  return { home: null, away: null, source: null, ignoredSources };
}

function formatCountdownMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function liveMicroStatusText({
  isLive,
  remainingSec,
  goalObserved,
  tradingLocked,
}: {
  isLive: boolean;
  remainingSec: number | null;
  goalObserved: boolean;
  tradingLocked: boolean;
}): string {
  if (goalObserved || tradingLocked) return "Trading locked";
  if (!isLive) return "Resolving window";
  if (remainingSec == null) return "Trading open";
  if (remainingSec <= 0) return "Resolving window";
  return "Trading open";
}

function readDescriptionField(description: string | null | undefined, fieldLabel: string): string | null {
  const raw = String(description || "");
  if (!raw) return null;
  const escaped = fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const out = Math.floor(n);
  return out >= 1 ? out : null;
}

function extractLoopSequence(description: string | null | undefined, sportMetaValue: unknown): number | null {
  const fromDescription = toPositiveInt(readDescriptionField(description, "Loop Sequence"));
  if (fromDescription != null) return fromDescription;
  const meta = asObject(sportMetaValue);
  const liveMicro = asObject(meta.live_micro);
  return (
    toPositiveInt(liveMicro.loop_sequence) ??
    toPositiveInt(liveMicro.loopSequence) ??
    toPositiveInt(meta.loop_sequence) ??
    toPositiveInt(meta.loopSequence) ??
    null
  );
}

function extractLoopPhase(description: string | null | undefined, sportMetaValue: unknown): string | null {
  const fromDescription = readDescriptionField(description, "Loop Phase");
  if (fromDescription) return fromDescription;
  const meta = asObject(sportMetaValue);
  const liveMicro = asObject(meta.live_micro);
  const raw = String(liveMicro.loop_phase ?? liveMicro.loopPhase ?? "").trim();
  return raw || null;
}

function formatLoopPhaseLabel(loopPhase: string | null | undefined): string | null {
  const raw = String(loopPhase ?? "").trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "first half" || normalized === "1st half" || normalized === "h1") return "1st half";
  if (normalized === "second half" || normalized === "2nd half" || normalized === "h2") return "2nd half";
  return raw;
}

function parseMatchupFromQuestion(question: string | null | undefined): { home: string; away: string } | null {
  const q = String(question || "").trim();
  if (!q) return null;
  const cleaned = q.replace(/^next\s+goal\s+in\s+\d+\s+minutes\?\s*/i, "");
  const m = cleaned.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (!m) return null;
  const home = m[1]?.trim();
  const away = m[2]?.trim();
  if (!home || !away) return null;
  return { home, away };
}

function parseScorePairFromText(raw: string | null | undefined): { home: number; away: number } | null {
  if (!raw) return null;
  const m = String(raw).match(/(-?\d+)\s*[-:]\s*(-?\d+)/);
  if (!m) return null;
  const home = Number(m[1]);
  const away = Number(m[2]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function isSoccerNextGoalMicroMarket(
  sportMetaValue: unknown,
  question: string | null | undefined,
  description: string | null | undefined,
): boolean {
  const meta = asObject(sportMetaValue);
  const liveMicro = asObject(meta.live_micro);
  const liveMicroCamel = asObject(meta.liveMicro);
  const liveMicroMarket = asObject(meta.live_micro_market);
  const nestedMicro = asObject(liveMicro.micro_market);

  const normalize = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const typeCandidates = [
    meta.micro_market_type,
    meta.microMarketType,
    liveMicro.micro_market_type,
    liveMicro.microMarketType,
    liveMicroMarket.micro_market_type,
    liveMicroCamel.micro_market_type,
    nestedMicro.micro_market_type,
    nestedMicro.type,
  ].map(normalize).filter(Boolean);

  const hasTypeMatch = typeCandidates.some((t) => t === "soccer_next_goal_5m" || t.includes("next_goal"));

  const q = String(question || "").toLowerCase();
  const d = String(description || "").toLowerCase();
  const looksLikeQuestion = /next\s+goal\s+in\s+\d+\s+minutes\?/i.test(q) || q.includes("next goal");
  const looksLikeDescription =
    d.includes("type: soccer_next_goal_5m") ||
    (d.includes("window start:") && d.includes("window end:") && d.includes("start score:"));

  return hasTypeMatch || (looksLikeQuestion && looksLikeDescription);
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

function normalizeVisualUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "null" || raw === "undefined" || raw.startsWith("data:")) return null;
  if (raw.startsWith("/")) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/^http:\/\//i, "https://");
}

function pickMarketCardVisual(event: any, meta: any, fallbackImage: string | null | undefined): string | null {
  const candidates: unknown[] = [
    pickEventBanner(event, meta),
    event?.event_image,
    event?.raw?.event_image,
    event?.raw?.strThumb,
    event?.raw?.strPoster,
    event?.raw?.strFanart1,
    meta?.live_micro?.event_image,
    meta?.live_micro?.event_thumb,
    meta?.images?.event_image,
    meta?.images?.event_thumb,
    meta?.images?.strThumb,
    meta?.raw?.event_image,
    meta?.raw?.event_thumb,
    fallbackImage,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVisualUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function pickProviderVisual(event: any, meta: any): string | null {
  const candidates: unknown[] = [
    event?.provider_image,
    event?.provider_thumb,
    event?.raw?.provider_image,
    event?.raw?.provider_thumb,
    event?.raw?.event_thumb,
    event?.raw?.strThumb,
    event?.raw?.strSquare,
    event?.raw?.strPoster,
    event?.meta?.raw?.provider_image,
    event?.meta?.raw?.provider_thumb,
    event?.meta?.raw?.event_thumb,
    event?.meta?.raw?.strThumb,
    meta?.live_micro?.provider_image,
    meta?.live_micro?.provider_thumb,
    meta?.live_micro?.event_thumb,
    meta?.live_micro?.strThumb,
    meta?.images?.provider_image,
    meta?.images?.provider_thumb,
    meta?.images?.event_thumb,
    meta?.images?.strThumb,
    meta?.raw?.provider_image,
    meta?.raw?.provider_thumb,
    meta?.raw?.event_thumb,
    meta?.raw?.strThumb,
    meta?.provider_image,
    meta?.provider_thumb,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVisualUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

/** Parse TheSportsDB goal details string like "Player:45';Player2:67'" into entries */
function parseGoalDetailsStr(raw: unknown): { player: string; minute: string }[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.lastIndexOf(":");
      if (colonIdx > 0) {
        return { player: entry.slice(0, colonIdx).trim(), minute: entry.slice(colonIdx + 1).trim() };
      }
      return { player: entry, minute: "" };
    });
}

/** Extract goal details from event/meta raw data */
function pickGoalDetails(event: any, meta: any, side: "home" | "away") {
  const key = side === "home" ? "home_goal_details" : "away_goal_details";
  const strKey = side === "home" ? "strHomeGoalDetails" : "strAwayGoalDetails";
  const raw =
    event?.raw?.[key] ?? event?.raw?.[strKey] ??
    event?.[strKey] ?? event?.[key] ??
    meta?.raw?.[key] ?? meta?.raw?.[strKey] ??
    meta?.[key] ?? meta?.[strKey] ??
    null;
  return parseGoalDetailsStr(raw);
}

function pickBadge(event: any, meta: any, side: "home" | "away"): string | null {
  const badgeKey = side === "home" ? "home_badge" : "away_badge";
  const strBadgeKey = side === "home" ? "strHomeTeamBadge" : "strAwayTeamBadge";
  const logoKey = side === "home" ? "strHomeTeamLogo" : "strAwayTeamLogo";

  const candidates: unknown[] = [
    // Existing sources (normal sport matches)
    event?.[strBadgeKey],
    event?.[badgeKey],
    event?.[logoKey],
    event?.raw?.[strBadgeKey],
    event?.raw?.[badgeKey],
    event?.raw?.[logoKey],
    event?.meta?.raw?.[strBadgeKey],
    event?.meta?.raw?.[badgeKey],
    event?.meta?.raw?.[logoKey],
    meta?.[strBadgeKey],
    meta?.[badgeKey],
    meta?.[logoKey],
    meta?.raw?.[strBadgeKey],
    meta?.raw?.[badgeKey],
    meta?.raw?.[logoKey],
    meta?.images?.[strBadgeKey],
    meta?.images?.[badgeKey],
    meta?.images?.[logoKey],

    // Micro/flash-specific payload shapes observed in dev rows
    event?.live?.raw?.[badgeKey],
    event?.live?.raw?.[strBadgeKey],
    event?.live?.[badgeKey],
    meta?.live_micro?.raw?.[badgeKey],
    meta?.live_micro?.raw?.[strBadgeKey],
    meta?.live_micro?.[badgeKey],
    meta?.raw?.[badgeKey],
    meta?.raw?.[strBadgeKey],
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVisualUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function liveLabel(event: any): string {
  const m = extractMinuteNumber(event);
  if (Number.isFinite(m) && m > 0) return `${m}'`;
  return "";
}

function extractMinuteNumber(event: any): number {
  const m =
    event?.score?.minute ??
    event?.score?.elapsed ??
    event?.raw?.intProgress ??
    event?.raw?.minute ??
    event?.minute;
  const n = Number(m);
  return Number.isFinite(n) ? n : NaN;
}

function hasMeaningfulScore(event: any): boolean {
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const home = toNum(
    event?.score?.home ??
      event?.score?.home_score ??
      event?.score?.local ??
      event?.score?.h,
  );
  const away = toNum(
    event?.score?.away ??
      event?.score?.away_score ??
      event?.score?.visitor ??
      event?.score?.a,
  );
  if (home == null || away == null) return false;

  const minute = extractMinuteNumber(event);
  return (
    home !== 0 ||
    away !== 0 ||
    (Number.isFinite(minute) && minute > 0) ||
    isLiveProviderStatus(event?.status)
  );
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

const SOCCER_BASE_DURATION_MS = 120 * 60_000;
const SOCCER_GRACE_MS = 10 * 60_000;

function predefinedSportDurationMs(sport: string): number {
  const s = String(sport || "").toLowerCase();
  if (s === "soccer" || s === "football") return SOCCER_BASE_DURATION_MS;
  if (s === "basketball" || s === "nba") return 175 * 60_000;
  if (s === "baseball" || s === "mlb") return 180 * 60_000;
  return NaN;
}

/** Per-sport UI trading lock offset (before estimated end_time).
 *  This is UI-only for user comfort; the real lock is on-chain end_ts.
 *  Football: lock at kickoff+112min (end_time-8min)
 *  NBA:      lock at kickoff+135min (end_time-40min)
 *  MLB:      lock at kickoff+125min (end_time-55min) */
function getTradingLockOffsetMs(sport: string): number {
  const s = String(sport || "").toLowerCase();
  switch (s) {
    case "baseball":
    case "mlb":
      return 55 * 60_000; // 55 min before end_time → lock at kickoff + 125min
    case "basketball":
    case "nba":
    case "ncaamb":
    case "ncaawb":
    case "wnba":
      return 40 * 60_000; // 40 min before end_time → lock at kickoff + 135min
    case "football":
    case "soccer":
    case "epl":
    case "la_liga":
    case "serie_a":
    case "bundesliga":
    case "ligue_1":
    case "mls":
    case "champions_league":
      return 8 * 60_000; // 8 min before end_time → lock at kickoff + 112min
    default:
      return 2 * 60_000; // 2 min default
  }
}

function SportScoreCard({
  event,
  meta,
  displayStatus,
  minute,
  polling,
  stale,
  lastPolledAt,
  isLiveMicro = false,
  microWindowEndMs = NaN,
  microGoalObserved = false,
  microTradingLocked = false,
  microState = null,
  resolvedScorePair = null,
  lockToResolvedScore = false,
}: {
  event: SportEvent;
  meta?: any;
  displayStatus: DisplayStatus;
  minute: string;
  polling: boolean;
  stale: boolean;
  lastPolledAt: number | null;
  isLiveMicro?: boolean;
  microWindowEndMs?: number;
  microGoalObserved?: boolean;
  microTradingLocked?: boolean;
  microState?: "active" | "locked" | "resolving" | "ended" | null;
  resolvedScorePair?: ScorePair | null;
  lockToResolvedScore?: boolean;
}) {
  const isLive = displayStatus === "live";
  const banner = pickEventBanner(event, meta);
  const homeBadge = pickBadge(event, meta, "home");
  const awayBadge = pickBadge(event, meta, "away");
  const homeGoals = pickGoalDetails(event, meta, "home");
  const awayGoals = pickGoalDetails(event, meta, "away");

  const scorePair = extractScorePair(event);
  const effectiveScorePair = lockToResolvedScore ? (resolvedScorePair ?? null) : (resolvedScorePair ?? scorePair);
  const hasScore = !!effectiveScorePair || hasMeaningfulScore(event);
  const fallbackUpdatedAt = parseIsoUtc(event.last_update)?.getTime() ?? NaN;
  const updatedAt = typeof lastPolledAt === "number" && Number.isFinite(lastPolledAt) ? lastPolledAt : fallbackUpdatedAt;
  const kickoffDate = parseIsoUtc(event.start_time);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isLiveMicro || !Number.isFinite(microWindowEndMs)) return;
    const timer = window.setInterval(() => setCountdownNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLiveMicro, microWindowEndMs]);

  useEffect(() => {
    if (isLiveMicro) setCountdownNowMs(Date.now());
  }, [isLiveMicro, microWindowEndMs]);

  const remainingSec = isLiveMicro && Number.isFinite(microWindowEndMs)
    ? Math.max(0, Math.ceil((microWindowEndMs - countdownNowMs) / 1000))
    : null;
  const timerColor = remainingSec == null
    ? "#7CFF6B"
    : remainingSec > 120
    ? "#7CFF6B"
    : remainingSec >= 60
    ? "#FFD166"
    : "#FF4D4D";
  const timerPulseClass = remainingSec != null && remainingSec < 30
    ? "micro-timer-hard-pulse"
    : remainingSec != null && remainingSec < 60
    ? "micro-timer-soft-pulse"
    : "";
  const microStatus = liveMicroStatusText({
    isLive,
    remainingSec,
    goalObserved: microGoalObserved,
    tradingLocked: microTradingLocked,
  });
  const effectiveMicroState = microState ?? (isLive ? "active" : "resolving");
  const microBadgeLabel = effectiveMicroState === "active"
    ? "Live"
    : effectiveMicroState === "locked"
    ? "Locked"
    : effectiveMicroState === "resolving"
    ? "Resolving"
    : "Final";
  const microBadgeClass = effectiveMicroState === "active"
    ? "border-red-500/35 bg-red-500/12 text-red-200"
    : effectiveMicroState === "locked"
    ? "border-yellow-500/35 bg-yellow-500/12 text-yellow-200"
    : effectiveMicroState === "resolving"
    ? "border-sky-500/35 bg-sky-500/12 text-sky-200"
    : "border-gray-500/35 bg-gray-500/12 text-gray-200";

  return (
    <div className={`rounded-xl border overflow-hidden ${
      isLiveMicro
        ? "border-[#7CFF6B]/35 bg-[radial-gradient(circle_at_28%_0%,rgba(124,255,107,0.15),transparent_45%),linear-gradient(145deg,rgba(7,15,11,0.98),rgba(3,6,9,0.98)_58%,rgba(8,13,10,0.96))] shadow-[0_24px_64px_rgba(0,0,0,0.58),0_0_20px_rgba(124,255,107,0.16)]"
        : `bg-black ${isLive ? "border-red-500/50 shadow-[0_0_24px_rgba(239,68,68,0.15)]" : "border-gray-800"}`
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
        {isLiveMicro ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-[0.14em] ${microBadgeClass}`}>
                {effectiveMicroState === "active" ? (
                  <span className="micro-live-dot w-2 h-2 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.45)]" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-current/70" />
                )}
                {microBadgeLabel}
              </div>
              <div className="flex items-center justify-end min-w-[12px]">
                {polling && (
                  <span className="inline-block w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>

            <div className="text-center">
              <div
                className={`mx-auto text-5xl sm:text-6xl font-black tabular-nums tracking-[0.08em] ${timerPulseClass}`}
                style={{ color: timerColor }}
              >
                {remainingSec == null ? "00:00" : formatCountdownMmSs(remainingSec)}
              </div>
              <div className="mt-1 text-[11px] sm:text-xs uppercase tracking-[0.22em] text-gray-300">
                Window Active
              </div>
              <div className="mt-2 text-xs text-gray-400">{microStatus}</div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/12 bg-white/[0.04] backdrop-blur-sm px-3 py-3 sm:px-5">
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                  {homeBadge ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={homeBadge}
                        alt=""
                        className="w-9 h-9 sm:w-11 sm:h-11 object-contain shrink-0 drop-shadow-[0_0_10px_rgba(124,255,107,0.2)]"
                      />
                    </>
                  ) : (
                    <span className="text-sm font-bold text-gray-200 shrink-0">
                      {(event.home_team || "H")[0]}
                    </span>
                  )}
                  <span className="text-xs sm:text-sm font-medium text-white truncate uppercase tracking-wide">
                    {event.home_team || "Home"}
                  </span>
                </div>

                <div className={`micro-score-pulse text-4xl sm:text-5xl font-black tabular-nums text-white shrink-0`}>
                  {effectiveScorePair ? `${effectiveScorePair.home} — ${effectiveScorePair.away}` : "—"}
                </div>

                <div className="flex items-center justify-end gap-2 sm:gap-3 flex-1 min-w-0">
                  <span className="text-xs sm:text-sm font-medium text-white truncate uppercase tracking-wide text-right">
                    {event.away_team || "Away"}
                  </span>
                  {awayBadge ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={awayBadge}
                        alt=""
                        className="w-9 h-9 sm:w-11 sm:h-11 object-contain shrink-0 drop-shadow-[0_0_10px_rgba(124,255,107,0.2)]"
                      />
                    </>
                  ) : (
                    <span className="text-sm font-bold text-gray-200 shrink-0">
                      {(event.away_team || "A")[0]}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
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
                {homeGoals.length > 0 && (
                  <div className="flex flex-col items-center gap-0.5 mt-0.5">
                    {homeGoals.map((g, i) => (
                      <span key={i} className="text-[10px] text-gray-400 leading-tight">
                        <span className="text-gray-500">⚽</span> {g.player}{g.minute ? ` (${g.minute})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Score / VS */}
              <div className="text-center px-2 shrink-0">
                {hasScore ? (
                  <div className={`text-2xl sm:text-3xl font-black tabular-nums ${isLive ? "text-pump-green" : "text-white"}`}>
                    {effectiveScorePair ? `${effectiveScorePair.home} — ${effectiveScorePair.away}` : formatScore(event.score, event.sport)}
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
                {awayGoals.length > 0 && (
                  <div className="flex flex-col items-center gap-0.5 mt-0.5">
                    {awayGoals.map((g, i) => (
                      <span key={i} className="text-[10px] text-gray-400 leading-tight">
                        <span className="text-gray-500">⚽</span> {g.player}{g.minute ? ` (${g.minute})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

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
      <style jsx>{`
        :global(.micro-timer-soft-pulse) {
          animation: microTimerSoftPulse 1s ease-in-out infinite;
          transform-origin: center;
        }
        :global(.micro-timer-hard-pulse) {
          animation: microTimerHardPulse 0.95s ease-in-out infinite;
          transform-origin: center;
        }
        :global(.micro-score-pulse) {
          animation: microScorePulse 9s ease-in-out infinite;
          transform-origin: center;
        }
        :global(.micro-live-dot) {
          animation: microLiveDotPulse 1.6s ease-in-out infinite;
        }
        @keyframes microTimerSoftPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.02);
            opacity: 0.92;
          }
        }
        @keyframes microTimerHardPulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 0 rgba(255, 77, 77, 0));
          }
          50% {
            transform: scale(1.06);
            filter: drop-shadow(0 0 16px rgba(255, 77, 77, 0.42));
          }
        }
        @keyframes microScorePulse {
          0%, 100% {
            transform: scale(1);
          }
          4.5% {
            transform: scale(1.04);
          }
          9% {
            transform: scale(1);
          }
        }
        @keyframes microLiveDotPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.85;
          }
          50% {
            transform: scale(1.2);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.micro-timer-soft-pulse),
          :global(.micro-timer-hard-pulse),
          :global(.micro-score-pulse),
          :global(.micro-live-dot) {
            animation: none !important;
          }
        }
      `}</style>
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
                    href={solanaExplorerTxUrl(result.txSig)}
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

  const [oddsRange, setOddsRange] = useState<OddsRange>("all");
  const [oddsPoints, setOddsPoints] = useState<{ t: number; pct: number[] }[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>("discussion");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const lastDbVolumeFetchAtRef = useRef(0);
  const lastDbResolutionFetchAtRef = useRef(0);
  const lastWsUpdateAtRef = useRef(0);
  const lastMobileSnapAtRef = useRef(0);

  // Creator profile
  const [creatorProfile, setCreatorProfile] = useState<Profile | null>(null);

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
  home_team?: string | null;
  away_team?: string | null;
  home_badge?: string | null;
  away_badge?: string | null;
  raw?: Record<string, unknown> | null;
} | null>(null);
const [liveMicroPayload, setLiveMicroPayload] = useState<{
  provider_payload_start?: Record<string, unknown> | null;
  provider_payload_end?: Record<string, unknown> | null;
  start_home_score?: number | null;
  start_away_score?: number | null;
  end_home_score?: number | null;
  end_away_score?: number | null;
} | null>(null);
const [liveScorePolling, setLiveScorePolling] = useState(false);
const [liveScoreFailures, setLiveScoreFailures] = useState(0);
const [liveScoreLastSuccessAt, setLiveScoreLastSuccessAt] = useState<number | null>(null);
const [trafficLiveCount, setTrafficLiveCount] = useState<number | null>(null);
const [trafficPolling, setTrafficPolling] = useState(false);
const [trafficDebugFrameTick, setTrafficDebugFrameTick] = useState(0);
const [trafficDebugImageUrl, setTrafficDebugImageUrl] = useState<string | null>(null);
const [trafficDebugFrameAvailable, setTrafficDebugFrameAvailable] = useState<boolean | null>(null);
const [trafficDebugSourceOpened, setTrafficDebugSourceOpened] = useState<boolean | null>(null);
const [trafficDebugDetections, setTrafficDebugDetections] = useState<number | null>(null);
const [trafficDebugFrameWidth, setTrafficDebugFrameWidth] = useState<number | null>(null);
const [trafficDebugFrameHeight, setTrafficDebugFrameHeight] = useState<number | null>(null);
const [trafficDebugLineX, setTrafficDebugLineX] = useState<number | null>(null);
const [trafficDebugLineY, setTrafficDebugLineY] = useState<number | null>(null);
const [trafficDebugLastTrackId, setTrafficDebugLastTrackId] = useState<number | null>(null);
const [trafficDebugLastDirection, setTrafficDebugLastDirection] = useState<string | null>(null);
const [trafficDebugDecisionTrackId, setTrafficDebugDecisionTrackId] = useState<number | null>(null);
const [trafficDebugDecisionReason, setTrafficDebugDecisionReason] = useState<string | null>(null);
const [trafficDebugDecisionCounted, setTrafficDebugDecisionCounted] = useState<boolean | null>(null);
const [trafficDebugTrackDeltaX, setTrafficDebugTrackDeltaX] = useState<number | null>(null);
const [trafficDebugTrackSamples, setTrafficDebugTrackSamples] = useState<number | null>(null);
const [persistedTradeScore, setPersistedTradeScore] = useState<{
  home: number;
  away: number;
  source: string | null;
  updatedAt: number;
} | null>(null);
const scoreLogRef = useRef<{
  lastIgnoredSignature: string;
  lastDisplaySignature: string;
}>({
  lastIgnoredSignature: "",
  lastDisplaySignature: "",
});

// Related block (RIGHT column under TradingPanel)
  const [relatedTab, setRelatedTab] = useState<RelatedTab>("related");
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedMarkets, setRelatedMarkets] = useState<any[]>([]);

  useEffect(() => {
    setDescriptionExpanded(false);
  }, [market?.publicKey]);

  // Mobile drawer state
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [mobileOutcomeIndex, setMobileOutcomeIndex] = useState(0);
  const [mobileDefaultSide, setMobileDefaultSide] = useState<"buy" | "sell">("buy");
  // NBA widget drawer
  const [nbaDrawerOpen, setNbaDrawerOpen] = useState(false);
  // Soccer match details drawer
  const [soccerDrawerOpen, setSoccerDrawerOpen] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const loadMarket = useCallback(
    async (marketAddress: string, silent = false) => {
      if (!silent) setLoading(true);
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
        const dbSupplies = toNumberArray(supabaseMarket.outcome_supplies) ?? [];
        const onchainRawSupplies = Array.isArray(snap?.marketAcc?.q)
          ? snap.marketAcc.q
          : Array.isArray((snap?.marketAcc as any)?.outcomeSupplies)
          ? (snap?.marketAcc as any).outcomeSupplies
          : [];
        const onchainSupplies = onchainRawSupplies.map((x: any) => toFiniteNumber(x));
        const supplies = onchainSupplies.length ? onchainSupplies : dbSupplies;
        const onchainYes = onchainSupplies.length >= 1 ? onchainSupplies[0] || 0 : null;
        const onchainNo = onchainSupplies.length >= 2 ? onchainSupplies[1] || 0 : null;

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

          yesSupply: mt === 0 && onchainYes != null ? onchainYes : Number(supabaseMarket.yes_supply) || 0,
          noSupply: mt === 0 && onchainNo != null ? onchainNo : Number(supabaseMarket.no_supply) || 0,

          // ✅ Block fields
          isBlocked: !!supabaseMarket.is_blocked,
          blockedReason: supabaseMarket.blocked_reason ?? null,
          blockedAt: supabaseMarket.blocked_at ?? null,

          // Sport fields
          marketMode: (supabaseMarket as any).market_mode ?? null,
          sportEventId: (supabaseMarket as any).sport_event_id ?? null,
          sportMeta: (supabaseMarket as any).sport_meta ?? null,
          sportTradingState: (supabaseMarket as any).sport_trading_state ?? null,
          startTime: (supabaseMarket as any).start_time ?? null,
          endTime: (supabaseMarket as any).end_time ?? null,
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

    /* Fetch creator profile when market loads */
    useEffect(() => {
      if (!market?.creator) { setCreatorProfile(null); return; }
      let cancelled = false;
      getProfile(market.creator).then((p) => { if (!cancelled) setCreatorProfile(p); });
      return () => { cancelled = true; };
    }, [market?.creator]);

    useEffect(() => {
      if (!id) return;
      setMarket(null);
      setLoading(true);
      setPositionShares(null);
      setOddsPoints([]);
      setMobileTradeOpen(false);
      setActiveLiveSession(null);
      setCreatorProfile(null);
      setPersistedTradeScore(null);
      setTrafficLiveCount(null);
      setTrafficPolling(false);
      scoreLogRef.current = { lastIgnoredSignature: "", lastDisplaySignature: "" };
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

    // Fetch live_micro payload row by linked market to recover provider badges for micro markets.
    useEffect(() => {
      if (!market?.publicKey) {
        setLiveMicroPayload(null);
        return;
      }

      let cancelled = false;
      (async () => {
        const { data, error } = await supabase
          .from("live_micro_markets")
          .select("provider_payload_start,provider_payload_end,start_home_score,start_away_score,end_home_score,end_away_score,created_at")
          .eq("linked_market_address", market.publicKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error || !data) {
          setLiveMicroPayload(null);
          return;
        }

        setLiveMicroPayload({
          provider_payload_start: asObject(data.provider_payload_start),
          provider_payload_end: asObject(data.provider_payload_end),
          start_home_score: Number.isFinite(Number(data.start_home_score)) ? Number(data.start_home_score) : null,
          start_away_score: Number.isFinite(Number(data.start_away_score)) ? Number(data.start_away_score) : null,
          end_home_score: Number.isFinite(Number(data.end_home_score)) ? Number(data.end_home_score) : null,
          end_away_score: Number.isFinite(Number(data.end_away_score)) ? Number(data.end_away_score) : null,
        });
      })();

      return () => {
        cancelled = true;
      };
    }, [market?.publicKey]);

    // Auto-refresh sport event after kickoff (even if provider status lags behind "live").
    useEffect(() => {
      if (market?.marketMode !== "sport" || !market?.sportEventId) return;

      const eventStartMs =
        parseIsoUtc(market?.startTime)?.getTime() ??
        parseIsoUtc((sportEvent as any)?.start_time)?.getTime() ??
        parseIsoUtc((market?.sportMeta as any)?.start_time)?.getTime() ??
        NaN;
      const nowMs = Date.now();
      const statusRaw = String(liveScore?.status || sportEvent?.status || "").toLowerCase();
      const isFinished =
        statusRaw === "finished" ||
        statusRaw === "final" ||
        statusRaw === "ended" ||
        statusRaw === "completed";
      const isLiveLike = statusRaw === "live" || statusRaw === "in_play";
      const afterKickoffWindow =
        Number.isFinite(eventStartMs) && nowMs >= (eventStartMs as number) - 2 * 60_000;
      if ((!afterKickoffWindow && !isLiveLike) || isFinished) return;

      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        const updated = await refreshSportEvent(market.sportEventId!).catch(() => null);
        if (!cancelled && updated) setSportEvent(updated);
      };

      void poll();
      const iv = setInterval(async () => {
        await poll();
      }, 25_000);
      return () => {
        cancelled = true;
        clearInterval(iv);
      };
    }, [
      market?.marketMode,
      market?.sportEventId,
      market?.startTime,
      market?.sportMeta,
      sportEvent?.start_time,
      sportEvent?.status,
      liveScore?.status,
    ]);

    // Poll /api/sports/live for sport-linked markets with adaptive interval + stale handling.
    // Basketball/NBA auto-routes to API-NBA via the sport param; others use TheSportsDB.
    useEffect(() => {
      const meta = market?.sportMeta as any;
      const provider = String(meta?.provider || "");
      const providerEventId = String(meta?.provider_event_id || "");
      const metaSport = String(meta?.sport || "").toLowerCase();
      const isNba = metaSport === "basketball" || metaSport === "nba";
      // Accept thesportsdb provider, or NBA markets (they auto-route on the server)
      if ((!isNba && provider !== "thesportsdb") || !providerEventId || market?.marketMode !== "sport") {
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

      // Build URL: for NBA, pass sport= so the API auto-routes to API-NBA
      const liveUrl = isNba
        ? `/api/sports/live?sport=basketball&event_id=${encodeURIComponent(providerEventId)}`
        : `/api/sports/live?provider=thesportsdb&event_id=${encodeURIComponent(providerEventId)}`;

      const poll = async () => {
        if (cancelled) return;
        setLiveScorePolling(true);

        try {
          const res = await fetch(liveUrl, { cache: "no-store" });
          if (!res.ok) throw new Error(`live score fetch failed: ${res.status}`);

          const data = await res.json();
          if (cancelled) return;

          const nextStatus = String(data?.status || latestKnownStatus || "unknown").toLowerCase();
          latestKnownStatus = nextStatus;
          consecutiveFailures = 0;
          setLiveScoreFailures(0);
          setLiveScoreLastSuccessAt(Date.now());

          const nextRaw = asObject(data?.raw);
          const nextHomeBadge = normalizeVisualUrl(
            data?.home_badge ??
              nextRaw.home_badge ??
              nextRaw.strHomeTeamBadge ??
              null,
          );
          const nextAwayBadge = normalizeVisualUrl(
            data?.away_badge ??
              nextRaw.away_badge ??
              nextRaw.strAwayTeamBadge ??
              null,
          );

          setLiveScore((prev) => {
            const prevRaw = asObject(prev?.raw);
            return {
              home_score: data?.home_score ?? prev?.home_score ?? null,
              away_score: data?.away_score ?? prev?.away_score ?? null,
              minute: data?.minute ?? prev?.minute ?? null,
              status: nextStatus || prev?.status || "unknown",
              home_team: data?.home_team ?? prev?.home_team ?? null,
              away_team: data?.away_team ?? prev?.away_team ?? null,
              home_badge: nextHomeBadge ?? prev?.home_badge ?? null,
              away_badge: nextAwayBadge ?? prev?.away_badge ?? null,
              raw: {
                ...prevRaw,
                ...nextRaw,
                home_badge:
                  nextRaw.home_badge ??
                  nextRaw.strHomeTeamBadge ??
                  prevRaw.home_badge ??
                  prevRaw.strHomeTeamBadge ??
                  null,
                away_badge:
                  nextRaw.away_badge ??
                  nextRaw.strAwayTeamBadge ??
                  prevRaw.away_badge ??
                  prevRaw.strAwayTeamBadge ??
                  null,
                strHomeTeamBadge:
                  nextRaw.strHomeTeamBadge ??
                  nextRaw.home_badge ??
                  prevRaw.strHomeTeamBadge ??
                  prevRaw.home_badge ??
                  null,
                strAwayTeamBadge:
                  nextRaw.strAwayTeamBadge ??
                  nextRaw.away_badge ??
                  prevRaw.strAwayTeamBadge ??
                  prevRaw.away_badge ??
                  null,
              },
            };
          });
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

    // --- Confetti on score change during live matches ---
    const prevScoreRef = useRef<{ home: number; away: number } | null>(null);
    useEffect(() => {
      const home = liveScore?.home_score ?? 0;
      const away = liveScore?.away_score ?? 0;
      const prev = prevScoreRef.current;

      if (prev !== null) {
        const totalNow = home + away;
        const totalBefore = prev.home + prev.away;
        // Only fire when score increases (not on reset/correction/initial load)
        if (totalNow > totalBefore && market?.marketMode === "sport") {
          void (async () => {
            try {
              const confetti = (await import("canvas-confetti")).default;
              const defaults = {
                spread: 60,
                ticks: 100,
                gravity: 0.8,
                decay: 0.94,
                startVelocity: 30,
                colors: ["#61ff9a", "#ffffff", "#ff5c73"],
              };
              confetti({ ...defaults, particleCount: 40, origin: { x: 0.2, y: 0.6 }, angle: 60 });
              confetti({ ...defaults, particleCount: 40, origin: { x: 0.8, y: 0.6 }, angle: 120 });
            } catch { /* canvas-confetti load failure is non-critical */ }
          })();
        }
      }

      prevScoreRef.current = { home, away };
    }, [liveScore?.home_score, liveScore?.away_score, market?.marketMode]);

    // Realtime market updates: websocket subscription on this trade page only.
    useEffect(() => {
      if (!id || !connection) return;

      let cancelled = false;
      let subId: number | null = null;
      let pollId: ReturnType<typeof setInterval> | null = null;
      let mobilePollId: ReturnType<typeof setInterval> | null = null;
      let volumeFetchInFlight = false;
      const marketPk = new PublicKey(id);
      const coder = (program as any)?.coder;
      const marketDbId = market?.dbId ?? null;
      const marketAddress = market?.publicKey || id;

      const refreshDbVolume = async () => {
        if (cancelled || volumeFetchInFlight) return;
        if (document.visibilityState !== "visible") return;
        if (!marketDbId && !marketAddress) return;
        const now = Date.now();
        if (now - lastDbVolumeFetchAtRef.current < 60_000) return;
        lastDbVolumeFetchAtRef.current = now;

        volumeFetchInFlight = true;
        try {
          let nextVolume: number | null = null;

          if (marketDbId) {
            const { data, error } = await supabase
              .from("markets")
              .select("total_volume")
              .eq("id", marketDbId)
              .maybeSingle();
            if (!error && data?.total_volume != null) {
              const n = Number(data.total_volume);
              if (Number.isFinite(n)) nextVolume = n;
            }
          }

          if ((nextVolume == null || !Number.isFinite(nextVolume)) && marketAddress) {
            const { data, error } = await supabase
              .from("markets")
              .select("total_volume")
              .eq("market_address", marketAddress)
              .maybeSingle();
            if (!error && data?.total_volume != null) {
              const n = Number(data.total_volume);
              if (Number.isFinite(n)) nextVolume = n;
            }
          }

          if (cancelled || nextVolume == null || !Number.isFinite(nextVolume)) return;
          setMarket((prev) => (prev ? { ...prev, totalVolume: nextVolume as number } : prev));
        } finally {
          volumeFetchInFlight = false;
        }
      };

      const applyFromInfo = (info: any) => {
        if (!info || cancelled) return;
        if (info.lamports != null) setMarketBalanceLamports(Number(info.lamports));
        if (!coder?.accounts?.decode) {
          void refreshDbVolume();
          return;
        }

        try {
          const marketAcc = coder.accounts.decode("market", info.data);
          const rawSupplies = Array.isArray(marketAcc?.q)
            ? marketAcc.q
            : Array.isArray(marketAcc?.outcomeSupplies)
            ? marketAcc.outcomeSupplies
            : [];

          const decodedSupplies = rawSupplies.map((x: any) => toFiniteNumber(x));
          if (!decodedSupplies.length) return;
          lastWsUpdateAtRef.current = Date.now();

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
        void refreshDbVolume();
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

      if (subId == null) {
        pollId = setInterval(() => {
          if (document.visibilityState !== "visible") return;
          if (program && coder?.accounts?.decode) {
            void refreshFromRpc();
            return;
          }
          if (!submitting) void loadMarket(id, true);
        }, 10_000);
      }

      const wsWatchdogId = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (submitting) return;
        if (Date.now() - lastWsUpdateAtRef.current > 20_000) {
          void refreshFromRpc();
        }
      }, 15_000);

      if (isMobile) {
        mobilePollId = setInterval(() => {
          if (document.visibilityState !== "visible") return;
          if (submitting) return;
          const now = Date.now();
          if (now - lastMobileSnapAtRef.current < 3_500) return;
          if (now - lastWsUpdateAtRef.current <= 6_000) return;
          lastMobileSnapAtRef.current = now;
          void refreshFromRpc();
        }, 5_000);
      }

      return () => {
        cancelled = true;
        if (pollId) clearInterval(pollId);
        if (mobilePollId) clearInterval(mobilePollId);
        clearInterval(wsWatchdogId);
        if (subId != null) {
          connection.removeAccountChangeListener(subId).catch(() => {});
        }
      };
    }, [id, connection, program, submitting, market?.dbId, market?.publicKey, isMobile]);

  // DB realtime sync for this market row (resolution/contest/proofs/block/sport state),
  // with slow polling fallback when realtime is unavailable or silent.
  useEffect(() => {
    if (!market?.publicKey) return;

    let cancelled = false;

    const marketDbId = market.dbId ?? null;
    const marketAddress = market.publicKey;
    const filter = marketDbId ? `id=eq.${marketDbId}` : `market_address=eq.${marketAddress}`;
    const dbSelect =
      "resolution_status,proposed_winning_outcome,resolution_proposed_at,contest_deadline,contested,contest_count," +
      "proposed_proof_url,proposed_proof_image,proposed_proof_note," +
      "resolved,resolved_at,winning_outcome,resolution_proof_url,resolution_proof_image,resolution_proof_note," +
      "is_blocked,blocked_reason,blocked_at,sport_trading_state,start_time,end_time," +
      "outcome_supplies,yes_supply,no_supply";

    const applyPatch = (row: any) => {
      if (!row || cancelled) return;
      setMarket((prev) => {
        if (!prev) return prev;
        const wsStale = Date.now() - lastWsUpdateAtRef.current > 20_000;
        const allowSupplyPatch = wsStale || !(prev.outcomeSupplies?.length);
        return applyMarketDbPatch(prev, row, allowSupplyPatch);
      });
    };

    const channel = supabase
      .channel(`trade_market_sync_${marketDbId || marketAddress}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "markets", filter },
        (payload) => {
          if (cancelled || !payload?.new) return;
          applyPatch(payload.new);
        },
      )
      .subscribe();

    const fetchDbPatch = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      if (submitting) return;
      const now = Date.now();
      if (now - lastDbResolutionFetchAtRef.current < 12_000) return;
      lastDbResolutionFetchAtRef.current = now;

      try {
        let query = supabase.from("markets").select(dbSelect).limit(1);
        query = marketDbId ? query.eq("id", marketDbId) : query.eq("market_address", marketAddress);
        const { data, error } = await query.maybeSingle();
        if (!cancelled && !error && data) applyPatch(data);
      } catch {
        // silent fallback
      }
    };

    void fetchDbPatch();
    const fallbackId = window.setInterval(() => {
      void fetchDbPatch();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(fallbackId);
      supabase.removeChannel(channel);
    };
  }, [market?.dbId, market?.publicKey, submitting]);

  const fallbackMicroEvent = useMemo(() => {
    if (!market) return null;
    if (!isSoccerNextGoalMicroMarket(market.sportMeta, market.question, market.description)) return null;

    const meta = asObject(market.sportMeta);
    const liveMicro = asObject(meta.live_micro);
    const liveMicroPayloadStart = asObject(
      liveMicroPayload?.provider_payload_start ?? (liveMicro as any)?.provider_payload_start,
    );
    const liveMicroPayloadEnd = asObject(
      liveMicroPayload?.provider_payload_end ?? (liveMicro as any)?.provider_payload_end,
    );
    const liveMicroPayloadStartLiveRaw = asObject(asObject(liveMicroPayloadStart.live).raw);
    const liveMicroPayloadEndLiveRaw = asObject(asObject(liveMicroPayloadEnd.live).raw);
    const metaRaw = asObject(meta.raw);
    const liveMicroRaw = asObject(liveMicro.raw);
    const metaLiveRaw = asObject((meta as any)?.live?.raw);
    const liveMicroLiveRaw = asObject((liveMicro as any)?.live?.raw);
    const liveScoreRaw = asObject(liveScore?.raw);
    const matchup = parseMatchupFromQuestion(market.question);
    const startScoreMeta = asObject(meta.start_score);
    const startScoreMicro = asObject(liveMicro.start_score);
    const startScoreDesc = parseScorePairFromText(readDescriptionField(market.description, "Start Score"));

    const startHomeCandidate = Number(
      startScoreMeta.home ??
      startScoreMeta.home_score ??
      startScoreMicro.home ??
      startScoreMicro.home_score ??
      startScoreDesc?.home ??
      0,
    );
    const startAwayCandidate = Number(
      startScoreMeta.away ??
      startScoreMeta.away_score ??
      startScoreMicro.away ??
      startScoreMicro.away_score ??
      startScoreDesc?.away ??
      0,
    );
    const startHome = Number.isFinite(startHomeCandidate) ? startHomeCandidate : 0;
    const startAway = Number.isFinite(startAwayCandidate) ? startAwayCandidate : 0;
    const homeBadge =
      normalizeVisualUrl(
        liveScore?.home_badge ??
          liveScoreRaw.home_badge ??
          liveScoreRaw.strHomeTeamBadge ??
          liveMicroPayloadStartLiveRaw.home_badge ??
          liveMicroPayloadStartLiveRaw.strHomeTeamBadge ??
          liveMicroPayloadEndLiveRaw.home_badge ??
          liveMicroPayloadEndLiveRaw.strHomeTeamBadge ??
          liveMicroRaw.home_badge ??
          liveMicroRaw.strHomeTeamBadge ??
          liveMicroLiveRaw.home_badge ??
          liveMicroLiveRaw.strHomeTeamBadge ??
          metaRaw.home_badge ??
          metaRaw.strHomeTeamBadge ??
          metaLiveRaw.home_badge ??
          metaLiveRaw.strHomeTeamBadge ??
          null,
      ) ?? null;
    const awayBadge =
      normalizeVisualUrl(
        liveScore?.away_badge ??
          liveScoreRaw.away_badge ??
          liveScoreRaw.strAwayTeamBadge ??
          liveMicroPayloadStartLiveRaw.away_badge ??
          liveMicroPayloadStartLiveRaw.strAwayTeamBadge ??
          liveMicroPayloadEndLiveRaw.away_badge ??
          liveMicroPayloadEndLiveRaw.strAwayTeamBadge ??
          liveMicroRaw.away_badge ??
          liveMicroRaw.strAwayTeamBadge ??
          liveMicroLiveRaw.away_badge ??
          liveMicroLiveRaw.strAwayTeamBadge ??
          metaRaw.away_badge ??
          metaRaw.strAwayTeamBadge ??
          metaLiveRaw.away_badge ??
          metaLiveRaw.strAwayTeamBadge ??
          null,
      ) ?? null;

    const event: any = {
      sport: "soccer",
      status: String(liveScore?.status || "live"),
      league: String(meta.league || liveMicro.league || "Soccer"),
      home_team: matchup?.home || "Home",
      away_team: matchup?.away || "Away",
      home_badge: homeBadge,
      away_badge: awayBadge,
      start_time: (typeof meta.start_time === "string" ? meta.start_time : market.startTime) || null,
      end_time:
        (typeof meta.window_end === "string" ? meta.window_end : null) ||
        (typeof liveMicro.window_end === "string" ? liveMicro.window_end : null) ||
        market.endTime ||
        null,
      score: {
        home: liveScore?.home_score ?? startHome,
        away: liveScore?.away_score ?? startAway,
        minute: liveScore?.minute ?? null,
      },
      raw: {
        ...liveMicroPayloadStartLiveRaw,
        ...liveMicroPayloadEndLiveRaw,
        ...metaRaw,
        ...liveMicroRaw,
        ...liveScoreRaw,
        home_badge:
          homeBadge ??
          liveMicroPayloadStartLiveRaw.home_badge ??
          liveMicroPayloadEndLiveRaw.home_badge ??
          metaRaw.home_badge ??
          liveMicroRaw.home_badge ??
          liveScoreRaw.home_badge ??
          null,
        away_badge:
          awayBadge ??
          liveMicroPayloadStartLiveRaw.away_badge ??
          liveMicroPayloadEndLiveRaw.away_badge ??
          metaRaw.away_badge ??
          liveMicroRaw.away_badge ??
          liveScoreRaw.away_badge ??
          null,
        strHomeTeamBadge:
          homeBadge ??
          liveMicroPayloadStartLiveRaw.strHomeTeamBadge ??
          liveMicroPayloadEndLiveRaw.strHomeTeamBadge ??
          metaRaw.strHomeTeamBadge ??
          liveMicroRaw.strHomeTeamBadge ??
          liveScoreRaw.strHomeTeamBadge ??
          null,
        strAwayTeamBadge:
          awayBadge ??
          liveMicroPayloadStartLiveRaw.strAwayTeamBadge ??
          liveMicroPayloadEndLiveRaw.strAwayTeamBadge ??
          metaRaw.strAwayTeamBadge ??
          liveMicroRaw.strAwayTeamBadge ??
          liveScoreRaw.strAwayTeamBadge ??
          null,
      },
      live: {
        raw: {
          ...liveMicroPayloadStartLiveRaw,
          ...liveMicroPayloadEndLiveRaw,
          ...metaLiveRaw,
          ...liveMicroLiveRaw,
          home_badge:
            homeBadge ??
            liveMicroPayloadStartLiveRaw.home_badge ??
            liveMicroPayloadEndLiveRaw.home_badge ??
            metaLiveRaw.home_badge ??
            liveMicroLiveRaw.home_badge ??
            null,
          away_badge:
            awayBadge ??
            liveMicroPayloadStartLiveRaw.away_badge ??
            liveMicroPayloadEndLiveRaw.away_badge ??
            metaLiveRaw.away_badge ??
            liveMicroLiveRaw.away_badge ??
            null,
          strHomeTeamBadge:
            homeBadge ??
            liveMicroPayloadStartLiveRaw.strHomeTeamBadge ??
            liveMicroPayloadEndLiveRaw.strHomeTeamBadge ??
            metaLiveRaw.strHomeTeamBadge ??
            liveMicroLiveRaw.strHomeTeamBadge ??
            null,
          strAwayTeamBadge:
            awayBadge ??
            liveMicroPayloadStartLiveRaw.strAwayTeamBadge ??
            liveMicroPayloadEndLiveRaw.strAwayTeamBadge ??
            metaLiveRaw.strAwayTeamBadge ??
            liveMicroLiveRaw.strAwayTeamBadge ??
            null,
        },
      },
      last_update: liveScoreLastSuccessAt ? new Date(liveScoreLastSuccessAt).toISOString() : undefined,
    };

    return event as SportEvent;
  }, [
    market?.publicKey,
    market?.sportMeta,
    market?.question,
    market?.description,
    market?.startTime,
    market?.endTime,
    liveScore?.home_score,
    liveScore?.away_score,
    liveScore?.home_badge,
    liveScore?.away_badge,
    liveScore?.raw,
    liveScore?.minute,
    liveScore?.status,
    liveMicroPayload?.provider_payload_start,
    liveMicroPayload?.provider_payload_end,
    liveScoreLastSuccessAt,
  ]);

  // Merge liveScore into sportEvent for display while keeping last known values on fetch errors.
  const sportEventForUi = useMemo(() => {
    const baseEvent = sportEvent || fallbackMicroEvent;
    if (!baseEvent) return null;
    const liveMicroPayloadStartLiveRaw = asObject(
      asObject(asObject(liveMicroPayload?.provider_payload_start).live).raw,
    );
    const liveMicroPayloadEndLiveRaw = asObject(
      asObject(asObject(liveMicroPayload?.provider_payload_end).live).raw,
    );
    const ev: any = {
      ...baseEvent,
      score: { ...(baseEvent.score || {}) },
      raw: {
        ...liveMicroPayloadStartLiveRaw,
        ...liveMicroPayloadEndLiveRaw,
        ...(baseEvent.raw || {}),
      },
      live: { ...(asObject((baseEvent as any).live)) },
    };
    const baseHomeBadge =
      normalizeVisualUrl(
        ev.home_badge ??
          liveMicroPayloadStartLiveRaw.home_badge ??
          liveMicroPayloadStartLiveRaw.strHomeTeamBadge ??
          liveMicroPayloadEndLiveRaw.home_badge ??
          liveMicroPayloadEndLiveRaw.strHomeTeamBadge ??
          ev.raw?.home_badge ??
          ev.raw?.strHomeTeamBadge ??
          ev.live?.raw?.home_badge ??
          ev.live?.raw?.strHomeTeamBadge ??
          null,
      ) ?? null;
    const baseAwayBadge =
      normalizeVisualUrl(
        ev.away_badge ??
          liveMicroPayloadStartLiveRaw.away_badge ??
          liveMicroPayloadStartLiveRaw.strAwayTeamBadge ??
          liveMicroPayloadEndLiveRaw.away_badge ??
          liveMicroPayloadEndLiveRaw.strAwayTeamBadge ??
          ev.raw?.away_badge ??
          ev.raw?.strAwayTeamBadge ??
          ev.live?.raw?.away_badge ??
          ev.live?.raw?.strAwayTeamBadge ??
          null,
      ) ?? null;
    if (baseHomeBadge) {
      ev.home_badge = baseHomeBadge;
      ev.raw.home_badge = baseHomeBadge;
      ev.raw.strHomeTeamBadge = baseHomeBadge;
    }
    if (baseAwayBadge) {
      ev.away_badge = baseAwayBadge;
      ev.raw.away_badge = baseAwayBadge;
      ev.raw.strAwayTeamBadge = baseAwayBadge;
    }
    ev.live.raw = { ...(asObject(ev.live?.raw)) };
    if (baseHomeBadge) {
      ev.live.raw.home_badge = baseHomeBadge;
      ev.live.raw.strHomeTeamBadge = baseHomeBadge;
    }
    if (baseAwayBadge) {
      ev.live.raw.away_badge = baseAwayBadge;
      ev.live.raw.strAwayTeamBadge = baseAwayBadge;
    }
    if (market?.startTime) ev.start_time = market.startTime;
    if (market?.endTime) ev.end_time = market.endTime;
    if (liveScore) {
      if (liveScore.home_score != null) ev.score.home = liveScore.home_score;
      if (liveScore.away_score != null) ev.score.away = liveScore.away_score;
      if (liveScore.minute != null) {
        ev.score.minute = liveScore.minute;
        ev.raw.intProgress = liveScore.minute;
      }
      if (liveScore.status) ev.status = liveScore.status;
      if (liveScoreLastSuccessAt) ev.last_update = new Date(liveScoreLastSuccessAt).toISOString();
      const liveScoreRaw = asObject(liveScore.raw);
      const liveScoreHomeBadge =
        normalizeVisualUrl(
          liveScore.home_badge ??
            liveScoreRaw.home_badge ??
            liveScoreRaw.strHomeTeamBadge ??
            null,
        ) ?? null;
      const liveScoreAwayBadge =
        normalizeVisualUrl(
          liveScore.away_badge ??
            liveScoreRaw.away_badge ??
            liveScoreRaw.strAwayTeamBadge ??
            null,
        ) ?? null;
      if (liveScoreHomeBadge) {
        ev.home_badge = liveScoreHomeBadge;
        ev.raw.home_badge = liveScoreHomeBadge;
        ev.raw.strHomeTeamBadge = liveScoreHomeBadge;
        ev.live.raw.home_badge = liveScoreHomeBadge;
        ev.live.raw.strHomeTeamBadge = liveScoreHomeBadge;
      }
      if (liveScoreAwayBadge) {
        ev.away_badge = liveScoreAwayBadge;
        ev.raw.away_badge = liveScoreAwayBadge;
        ev.raw.strAwayTeamBadge = liveScoreAwayBadge;
        ev.live.raw.away_badge = liveScoreAwayBadge;
        ev.live.raw.strAwayTeamBadge = liveScoreAwayBadge;
      }
      // Propagate goal details from live score
      if (liveScoreRaw.home_goal_details) ev.raw.home_goal_details = liveScoreRaw.home_goal_details;
      if (liveScoreRaw.away_goal_details) ev.raw.away_goal_details = liveScoreRaw.away_goal_details;
    }
    return ev as SportEvent;
  }, [
    sportEvent,
    fallbackMicroEvent,
    liveMicroPayload?.provider_payload_start,
    liveMicroPayload?.provider_payload_end,
    liveScore,
    liveScoreLastSuccessAt,
    market?.startTime,
    market?.endTime,
  ]);

  const sharedSportDisplayStatus: DisplayStatus = useMemo(
    () => (sportEventForUi ? resolveDisplayStatus(sportEventForUi) : "unknown"),
    [sportEventForUi],
  );
  const sharedSportMinute = useMemo(
    () => (sportEventForUi ? liveLabel(sportEventForUi) : ""),
    [sportEventForUi],
  );
  const persistedScorePair = persistedTradeScore
    ? { home: persistedTradeScore.home, away: persistedTradeScore.away }
    : null;
  const bestLiveScore = useMemo(
    () =>
      resolveBestLiveScore({
        liveScore,
        sportEventForUi,
        liveMicroPayload,
        market,
        lastKnownScore: persistedScorePair,
      }),
    [
      liveScore,
      sportEventForUi,
      liveMicroPayload,
      market,
      persistedScorePair?.home,
      persistedScorePair?.away,
    ],
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
    await loadMarket(id, true);
  };

  void tick();
  const t = window.setInterval(() => void tick(), 25000);

  return () => {
    cancelled = true;
    window.clearInterval(t);
  };
}, [id, market?.resolutionStatus, submitting, loadMarket]);

// Poll full market state from Supabase during live sport events (every 60s).
// Live score polling (existing, ~15-30s) only updates scores.
// This poll keeps Supabase-sourced data fresh (sport_trading_state, outcome_supplies, etc.).
useEffect(() => {
  if (!id) return;
  if (market?.marketMode !== "sport") return;
  // Only poll while provider says live (display status)
  const isLive = sharedSportDisplayStatus === "live";
  if (!isLive) return;

  let cancelled = false;

  const tick = async () => {
    if (cancelled || document.visibilityState !== "visible" || submitting) return;
    await loadMarket(id, true);
  };

  const iv = window.setInterval(() => void tick(), 60_000);
  return () => {
    cancelled = true;
    window.clearInterval(iv);
  };
}, [id, market?.marketMode, sharedSportDisplayStatus, submitting, loadMarket]);

// Refresh traffic debug frame independently from count polling.
useEffect(() => {
  if (!market?.publicKey) return;

  const marketMode = String(market.marketMode || "").trim().toLowerCase();
  const trafficMeta = asObject(market.sportMeta);
  const trafficType = String(trafficMeta.type || "").trim().toLowerCase();
  const isTrafficFlashMarket = marketMode === "flash_traffic" || trafficType === "flash_traffic";
  if (!isTrafficFlashMarket) return;

  const roundId = String(trafficMeta.round_id || trafficMeta.roundId || market.publicKey).trim();
  if (!roundId) return;

  const resolutionStatus = String(market.resolutionStatus || "").trim().toLowerCase();
  const isTrafficTerminal =
    market.resolved === true ||
    resolutionStatus === "proposed" ||
    resolutionStatus === "finalized" ||
    resolutionStatus === "cancelled";
  if (isTrafficTerminal) return;

  let cancelled = false;
  const tick = () => {
    if (cancelled || document.visibilityState !== "visible") return;
    setTrafficDebugFrameTick((prev) => {
      const next = prev + 1;
      console.log("[traffic-preview] image refresh tick", { roundId, tick: next });
      return next;
    });
  };

  tick();
  const iv = window.setInterval(() => tick(), 850);
  return () => {
    cancelled = true;
    window.clearInterval(iv);
  };
}, [market?.marketMode, market?.publicKey, market?.sportMeta, market?.resolutionStatus, market?.resolved]);

useEffect(() => {
  if (!market?.publicKey) {
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(null);
    return;
  }

  const marketMode = String(market.marketMode || "").trim().toLowerCase();
  const trafficMeta = asObject(market.sportMeta);
  const trafficType = String(trafficMeta.type || "").trim().toLowerCase();
  const isTrafficFlashMarket = marketMode === "flash_traffic" || trafficType === "flash_traffic";
  if (!isTrafficFlashMarket) {
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(null);
    return;
  }

  const roundId = String(trafficMeta.round_id || trafficMeta.roundId || market.publicKey).trim();
  if (!roundId) {
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(false);
    return;
  }

  const resolutionStatus = String(market.resolutionStatus || "").trim().toLowerCase();
  const isTrafficTerminal =
    market.resolved === true ||
    resolutionStatus === "proposed" ||
    resolutionStatus === "finalized" ||
    resolutionStatus === "cancelled";
  if (isTrafficTerminal || document.visibilityState !== "visible") return;

  const nextUrl = `/api/traffic/frame?roundId=${encodeURIComponent(roundId)}&ts=${Date.now()}&tick=${trafficDebugFrameTick}`;
  let cancelled = false;
  const probe = new window.Image();
  probe.onload = () => {
    if (cancelled) return;
    setTrafficDebugImageUrl(nextUrl);
    setTrafficDebugFrameAvailable(true);
    console.log("[traffic-preview] image url updated", { roundId, url: nextUrl });
  };
  probe.onerror = () => {
    if (cancelled) return;
    setTrafficDebugFrameAvailable((prev) => (prev === true ? true : false));
  };
  probe.src = nextUrl;

  return () => {
    cancelled = true;
    probe.onload = null;
    probe.onerror = null;
  };
}, [
  trafficDebugFrameTick,
  market?.marketMode,
  market?.publicKey,
  market?.sportMeta,
  market?.resolutionStatus,
  market?.resolved,
]);

// Poll live traffic counter for flash traffic markets.
useEffect(() => {
  if (!market?.publicKey) {
    setTrafficLiveCount(null);
    setTrafficPolling(false);
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(null);
    setTrafficDebugSourceOpened(null);
    setTrafficDebugDetections(null);
    setTrafficDebugFrameWidth(null);
    setTrafficDebugFrameHeight(null);
    setTrafficDebugLineX(null);
    setTrafficDebugLineY(null);
    setTrafficDebugLastTrackId(null);
    setTrafficDebugLastDirection(null);
    setTrafficDebugDecisionTrackId(null);
    setTrafficDebugDecisionReason(null);
    setTrafficDebugDecisionCounted(null);
    setTrafficDebugTrackDeltaX(null);
    setTrafficDebugTrackSamples(null);
    return;
  }

  const marketMode = String(market.marketMode || "").trim().toLowerCase();
  const trafficMeta = asObject(market.sportMeta);
  const trafficType = String(trafficMeta.type || "").trim().toLowerCase();
  const isTrafficFlashMarket = marketMode === "flash_traffic" || trafficType === "flash_traffic";
  if (!isTrafficFlashMarket) {
    setTrafficLiveCount(null);
    setTrafficPolling(false);
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(null);
    setTrafficDebugSourceOpened(null);
    setTrafficDebugDetections(null);
    setTrafficDebugFrameWidth(null);
    setTrafficDebugFrameHeight(null);
    setTrafficDebugLineX(null);
    setTrafficDebugLineY(null);
    setTrafficDebugLastTrackId(null);
    setTrafficDebugLastDirection(null);
    setTrafficDebugDecisionTrackId(null);
    setTrafficDebugDecisionReason(null);
    setTrafficDebugDecisionCounted(null);
    setTrafficDebugTrackDeltaX(null);
    setTrafficDebugTrackSamples(null);
    return;
  }

  const roundId = String(trafficMeta.round_id || trafficMeta.roundId || market.publicKey).trim();
  if (!roundId) {
    setTrafficLiveCount(null);
    setTrafficPolling(false);
    setTrafficDebugImageUrl(null);
    setTrafficDebugFrameAvailable(false);
    setTrafficDebugSourceOpened(null);
    setTrafficDebugDetections(null);
    setTrafficDebugFrameWidth(null);
    setTrafficDebugFrameHeight(null);
    setTrafficDebugLineX(null);
    setTrafficDebugLineY(null);
    setTrafficDebugLastTrackId(null);
    setTrafficDebugLastDirection(null);
    setTrafficDebugDecisionTrackId(null);
    setTrafficDebugDecisionReason(null);
    setTrafficDebugDecisionCounted(null);
    setTrafficDebugTrackDeltaX(null);
    setTrafficDebugTrackSamples(null);
    return;
  }

  const seedCount = firstFiniteNumber([
    trafficMeta.current_count,
    trafficMeta.end_count,
    trafficMeta.start_count,
  ]);
  if (seedCount != null) {
    setTrafficLiveCount(Math.max(0, Math.floor(seedCount)));
  }

  const resolutionStatus = String(market.resolutionStatus || "").trim().toLowerCase();
  const isTrafficTerminal =
    market.resolved === true ||
    resolutionStatus === "proposed" ||
    resolutionStatus === "finalized" ||
    resolutionStatus === "cancelled";
  if (isTrafficTerminal) {
    setTrafficPolling(false);
    return;
  }

  let cancelled = false;
  const poll = async () => {
    if (cancelled || document.visibilityState !== "visible") return;
    console.log("[traffic-preview] status poll", { roundId });
    setTrafficPolling(true);
    try {
      const params = new URLSearchParams({
        roundId,
        marketAddress: market.publicKey,
      });
      const res = await fetch(`/api/traffic/live?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      const nextCount = Number((json as any)?.currentCount);
      const nextSourceOpened = (json as any)?.sourceOpened;
      const nextDetections = Number((json as any)?.detectionsLastFrame);
      const nextFrameWidth = Number((json as any)?.frameWidth);
      const nextFrameHeight = Number((json as any)?.frameHeight);
      const nextLineX = Number((json as any)?.countingLineX);
      const nextLineY = Number((json as any)?.countingLineY);
      const nextLastTrackId = Number((json as any)?.lastCountedTrackId);
      const nextLastDirection = String((json as any)?.lastCrossingDirection || "").trim();
      const nextDecisionTrackId = Number((json as any)?.lastDecisionTrackId);
      const nextDecisionReason = String((json as any)?.lastDecisionReason || "").trim();
      const nextDecisionCountedRaw = (json as any)?.lastDecisionCounted;
      const nextTrackDeltaX = Number((json as any)?.lastTrackDeltaX);
      const nextTrackSamples = Number((json as any)?.lastTrackSamples);
      if (cancelled) return;
      if (Number.isFinite(nextCount)) {
        setTrafficLiveCount(Math.max(0, Math.floor(nextCount)));
      }
      if (typeof nextSourceOpened === "boolean") {
        setTrafficDebugSourceOpened(nextSourceOpened);
      }
      if (Number.isFinite(nextDetections)) {
        setTrafficDebugDetections(Math.max(0, Math.floor(nextDetections)));
      }
      if (Number.isFinite(nextFrameWidth)) {
        setTrafficDebugFrameWidth(Math.max(0, Math.floor(nextFrameWidth)));
      } else {
        setTrafficDebugFrameWidth(null);
      }
      if (Number.isFinite(nextFrameHeight)) {
        setTrafficDebugFrameHeight(Math.max(0, Math.floor(nextFrameHeight)));
      } else {
        setTrafficDebugFrameHeight(null);
      }
      if (Number.isFinite(nextLineX)) {
        setTrafficDebugLineX(Math.max(0, Math.floor(nextLineX)));
      } else {
        setTrafficDebugLineX(null);
      }
      if (Number.isFinite(nextLineY)) {
        setTrafficDebugLineY(Math.max(0, Math.floor(nextLineY)));
      } else {
        setTrafficDebugLineY(null);
      }
      if (Number.isFinite(nextLastTrackId)) {
        setTrafficDebugLastTrackId(Math.floor(nextLastTrackId));
      } else {
        setTrafficDebugLastTrackId(null);
      }
      setTrafficDebugLastDirection(nextLastDirection || null);
      if (Number.isFinite(nextDecisionTrackId)) {
        setTrafficDebugDecisionTrackId(Math.floor(nextDecisionTrackId));
      } else {
        setTrafficDebugDecisionTrackId(null);
      }
      setTrafficDebugDecisionReason(nextDecisionReason || null);
      setTrafficDebugDecisionCounted(
        typeof nextDecisionCountedRaw === "boolean" ? nextDecisionCountedRaw : null,
      );
      if (Number.isFinite(nextTrackDeltaX)) {
        setTrafficDebugTrackDeltaX(Number(nextTrackDeltaX));
      } else {
        setTrafficDebugTrackDeltaX(null);
      }
      if (Number.isFinite(nextTrackSamples)) {
        setTrafficDebugTrackSamples(Math.max(0, Math.floor(nextTrackSamples)));
      } else {
        setTrafficDebugTrackSamples(null);
      }
    } catch {
      // Best-effort polling, keep last known value on failures.
    } finally {
      if (!cancelled) setTrafficPolling(false);
    }
  };

  void poll();
  const iv = window.setInterval(() => {
    void poll();
  }, 2_000);

  return () => {
    cancelled = true;
    setTrafficPolling(false);
    window.clearInterval(iv);
  };
}, [market?.marketMode, market?.publicKey, market?.sportMeta, market?.resolutionStatus, market?.resolved]);

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
        const buyAccounts = {
          market: marketPubkey,
          userPosition: positionPDA,
          platformWallet: PLATFORM_WALLET,
          creator: creatorPubkey,
          trader: publicKey,
          systemProgram: SystemProgram.programId,
        };

        console.log("[trade buy debug] PLATFORM_WALLET", PLATFORM_WALLET.toBase58());
        console.log("[trade buy debug] market PDA", marketPubkey.toBase58());
        console.log("[trade buy debug] user position PDA", positionPDA.toBase58());
        console.log("[trade buy debug] trader public key", publicKey.toBase58());
        console.log("[trade buy debug] accounts", buyAccounts);

        const tx = await (program as any).methods
          .buyShares(amountBn, safeOutcome)
          .accounts(buyAccounts)
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
      const waitForSigConfirmed = async (sig: string) => {
        const deadline = Date.now() + 12_000;
        while (Date.now() < deadline) {
          try {
            const { value } = await connection.getSignatureStatuses([sig], {
              searchTransactionHistory: true,
            });
            const st = value?.[0];
            const cs = String(st?.confirmationStatus || "").toLowerCase();
            if (cs === "confirmed" || cs === "finalized") return;
          } catch {
            // keep retrying until timeout
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      };

      await waitForSigConfirmed(txSig);

      const snap = await loadOnchainSnapshot(id);
      if (snap?.marketLamports != null) setMarketBalanceLamports(snap.marketLamports);
      if (snap?.posAcc?.shares) {
        const sharesArr = Array.isArray(snap.posAcc.shares) ? snap.posAcc.shares.map((x: any) => Number(x) || 0) : [];
        setPositionShares(sharesArr);
      }
      await loadMarket(id, true); // keeps DB in sync (question, proofs, contest, etc.)

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
        await loadMarket(id, true);
        setTradeStep("idle");
        setTradeResult(null);
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        // Revert optimistic UI
        await loadMarket(id, true);
        setTradeStep("idle");
        setTradeResult(null);
        return;
      }

      // Revert optimistic UI on any error
      await loadMarket(id, true);
      
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

  const uiLockSportMeta = asObject(market?.sportMeta);
  const uiLockLiveMicroMeta = asObject(uiLockSportMeta.live_micro);
  const flashCryptoTypeTagForUiLock = String(uiLockSportMeta.type || uiLockLiveMicroMeta.type || "")
    .trim()
    .toLowerCase();
  const isFlashCryptoForUiLock =
    !!market &&
    (
      market.marketMode === "flash_crypto" ||
      flashCryptoTypeTagForUiLock === "flash_crypto_price" ||
      flashCryptoTypeTagForUiLock === "flash_crypto_graduation"
    );
  const isFlashTrafficForUiLock =
    !!market &&
    (
      market.marketMode === "flash_traffic" ||
      flashCryptoTypeTagForUiLock === "flash_traffic"
    );
  const isFlashFootForUiLock = market
    ? isSoccerNextGoalMicroMarket(market.sportMeta, market.question, market.description)
    : false;

  // Client-side timer:
  // - flash crypto + flash traffic + flash foot get 1s precision for immediate UI lock at 00:00
  // - others keep 15s refresh for lighter UI churn
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const tickMs = isFlashCryptoForUiLock || isFlashTrafficForUiLock || isFlashFootForUiLock ? 1_000 : 15_000;
    setNowMs(Date.now());
    const iv = setInterval(() => setNowMs(Date.now()), tickMs);
    return () => clearInterval(iv);
  }, [isFlashCryptoForUiLock, isFlashTrafficForUiLock, isFlashFootForUiLock]);
  const isSoccerNextGoalMicroForScore = isFlashFootForUiLock;
  const isSportLikeMarketForScore = !!market && (market.marketMode === "sport" || isSoccerNextGoalMicroForScore);
  const scoreStartRawForDisplay = market
    ? (
        market.startTime ||
        sportEventForUi?.start_time ||
        (market.sportMeta as any)?.start_time ||
        readDescriptionField(market.description, "Window Start")
      )
    : null;
  const scoreStartMsForDisplay = parseIsoUtc(scoreStartRawForDisplay)?.getTime() ?? NaN;
  const scoreBeforeStartForDisplay =
    isSportLikeMarketForScore &&
    Number.isFinite(scoreStartMsForDisplay) &&
    nowMs < scoreStartMsForDisplay;
  const bestLiveScorePair = bestLiveScore.home != null && bestLiveScore.away != null
    ? { home: bestLiveScore.home, away: bestLiveScore.away }
    : null;
  const unifiedTradeScorePair = scoreBeforeStartForDisplay
    ? null
    : (bestLiveScorePair ?? persistedScorePair);

  useEffect(() => {
    if (!id || !isSoccerNextGoalMicroForScore) return;
    const scope = `[flash-score][${id}]`;
    const ignoredSignature = bestLiveScore.ignoredSources.join("|");
    if (ignoredSignature && scoreLogRef.current.lastIgnoredSignature !== ignoredSignature) {
      bestLiveScore.ignoredSources.forEach((ignored) => {
        console.info(`${scope} rejected source=${ignored} reason=empty_or_stale`);
      });
      scoreLogRef.current.lastIgnoredSignature = ignoredSignature;
    }

    if (bestLiveScore.home != null && bestLiveScore.away != null) {
      const nextHome = bestLiveScore.home;
      const nextAway = bestLiveScore.away;
      const nextSource = bestLiveScore.source;
      setPersistedTradeScore((prev) => {
        const samePair = !!prev && prev.home === nextHome && prev.away === nextAway;
        const sameSource = !!prev && prev.source === nextSource;
        if (samePair && sameSource) return prev;
        console.info(
          `${scope} selected source=${nextSource ?? "unknown"} score=${nextHome}-${nextAway}`,
        );
        return {
          home: nextHome,
          away: nextAway,
          source: nextSource,
          updatedAt: Date.now(),
        };
      });
      return;
    }

    setPersistedTradeScore((prev) => {
      if (prev) {
        console.warn(`${scope} block empty override existing=${prev.home}-${prev.away} incoming=null`);
        return prev;
      }
      console.warn(`${scope} final score unavailable reason=no_valid_source`);
      return prev;
    });
  }, [
    id,
    isSoccerNextGoalMicroForScore,
    bestLiveScore.home,
    bestLiveScore.away,
    bestLiveScore.source,
    bestLiveScore.ignoredSources,
  ]);

  useEffect(() => {
    if (!id || !isSoccerNextGoalMicroForScore) return;
    const scope = `[flash-score][${id}]`;
    const finalScoreLabel = unifiedTradeScorePair ? `${unifiedTradeScorePair.home}-${unifiedTradeScorePair.away}` : "—";
    const hiddenReason = scoreBeforeStartForDisplay ? "pre-match" : "missing-valid-score";
    const displaySignature = `${finalScoreLabel}|${hiddenReason}|${bestLiveScore.source ?? "none"}`;
    if (scoreLogRef.current.lastDisplaySignature === displaySignature) return;
    scoreLogRef.current.lastDisplaySignature = displaySignature;

    console.info(`${scope} final hero score=${finalScoreLabel}`);
    console.info(`${scope} final market-card score=${finalScoreLabel}`);
    if (finalScoreLabel === "—") {
      console.warn(`${scope} score hidden reason=${hiddenReason}`);
    }
  }, [
    id,
    isSoccerNextGoalMicroForScore,
    unifiedTradeScorePair?.home,
    unifiedTradeScorePair?.away,
    scoreBeforeStartForDisplay,
    bestLiveScore.source,
  ]);

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
  const sportMeta = asObject(market.sportMeta);
  const liveMicroMeta = asObject(sportMeta.live_micro);
  const isSoccerNextGoalMicro = isSoccerNextGoalMicroMarket(
    market.sportMeta,
    market.question,
    market.description,
  );
  const cryptoTypeTag = String((sportMeta as any).type || (liveMicroMeta as any).type || "")
    .trim()
    .toLowerCase();
  const isFlashCryptoMarket =
    market.marketMode === "flash_crypto" ||
    cryptoTypeTag === "flash_crypto_price" ||
    cryptoTypeTag === "flash_crypto_graduation";
  const isFlashCryptoGraduationMarket = isFlashCryptoMarket && cryptoTypeTag === "flash_crypto_graduation";
  const isFlashCryptoPriceMarket = isFlashCryptoMarket && !isFlashCryptoGraduationMarket;
  const isFlashTrafficMarket =
    market.marketMode === "flash_traffic" ||
    cryptoTypeTag === "flash_traffic";
  const cryptoMeta = isFlashCryptoMarket ? asObject(market.sportMeta) : {};
  const cryptoSourceType =
    String(cryptoMeta.source_type || "").trim().toLowerCase() === "major" ? "major" : "pump_fun";
  const cryptoMajorSymbol = String(cryptoMeta.major_symbol || "").trim().toUpperCase() || null;
  const cryptoMajorPair = String(cryptoMeta.major_pair || "").trim().toUpperCase() || null;
  const majorConfig = cryptoMajorSymbol ? getFlashCryptoMajorConfigBySymbol(cryptoMajorSymbol) : null;
  const cryptoTokenMint = String(cryptoMeta.token_mint || cryptoMajorPair || "").trim();
  const cryptoTokenSymbol = String(cryptoMeta.token_symbol || cryptoMajorSymbol || "").trim();
  const cryptoTokenName = String(cryptoMeta.token_name || "").trim();
  const cryptoTokenImageUri =
    String(cryptoMeta.token_image_uri || majorConfig?.imageUri || "").trim() || null;
  const cryptoPriceStart = Number(cryptoMeta.price_start || 0);
  const cryptoProgressStart = firstFiniteNumber([cryptoMeta.progress_start, cryptoMeta.progressStart]);
  const cryptoProgressEnd = firstFiniteNumber([cryptoMeta.progress_end, cryptoMeta.progressEnd]);
  const cryptoDidGraduateEnd = parseTruthyFlag(cryptoMeta.did_graduate_end);
  const cryptoRemainingToGraduateEnd = firstFiniteNumber([
    cryptoMeta.remaining_to_graduate_end,
    cryptoMeta.remainingToGraduateEnd,
  ]);
  const cryptoDurationMinutes = Number(cryptoMeta.duration_minutes || 0) || null;
  const trafficMeta = isFlashTrafficMarket ? asObject(market.sportMeta) : {};
  const trafficRoundId = String(trafficMeta.round_id || trafficMeta.roundId || market.publicKey || "").trim();
  const trafficDebugFrameSrc =
    isFlashTrafficMarket && trafficRoundId
      ? trafficDebugImageUrl
      : null;
  const trafficWindowEnd = isFlashTrafficMarket
    ? String(trafficMeta.window_end || market.endTime || "").trim() || null
    : null;
  const trafficWindowEndMs = parseIsoUtc(trafficWindowEnd)?.getTime() ?? NaN;
  const trafficRemainingSec = Number.isFinite(trafficWindowEndMs)
    ? Math.max(0, Math.ceil((trafficWindowEndMs - nowMs) / 1000))
    : null;
  const trafficRemainingLabel = trafficRemainingSec == null ? "—" : formatCountdownMmSs(trafficRemainingSec);
  const microLoopSequence = isSoccerNextGoalMicro
    ? extractLoopSequence(market.description, market.sportMeta)
    : null;
  const microLoopPhase = isSoccerNextGoalMicro
    ? extractLoopPhase(market.description, market.sportMeta)
    : null;
  const microLoopPhaseLabel = isSoccerNextGoalMicro ? formatLoopPhaseLabel(microLoopPhase) : null;
  const isSportLikeMarket = market.marketMode === "sport" || isSoccerNextGoalMicro;
  const sportIsLive = isSportLikeMarket && sharedSportDisplayStatus === "live";
  const sportIsFinished = isSportLikeMarket && sharedSportDisplayStatus === "finished";

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
  const cryptoProposedProofMetrics = parseFlashCryptoProofMetrics(market.proposedProofNote);
  const cryptoResolvedProofMetrics = parseFlashCryptoProofMetrics(market.resolutionProofNote);
  const cryptoProposedGradMetrics = parseFlashCryptoGraduationMetrics(market.proposedProofNote);
  const cryptoResolvedGradMetrics = parseFlashCryptoGraduationMetrics(market.resolutionProofNote);
  const cryptoStartFromMeta = firstFiniteNumber([
    cryptoMeta.start_price,
    cryptoMeta.price_start,
    cryptoMeta.priceStart,
  ]);
  const cryptoFinalFromMeta = firstFiniteNumber([
    cryptoMeta.end_price,
    cryptoMeta.price_end,
    cryptoMeta.priceEnd,
    cryptoMeta.final_price,
    cryptoMeta.finalPrice,
  ]);
  const cryptoPercentFromMeta = firstFiniteNumber([
    cryptoMeta.percent_change,
    cryptoMeta.pct_change,
    cryptoMeta.change_pct,
    cryptoMeta.percentChange,
  ]);
  const cryptoCardMetrics = (() => {
    const startPrice =
      cryptoResolvedProofMetrics.startPrice ??
      cryptoProposedProofMetrics.startPrice ??
      cryptoStartFromMeta;
    const finalPrice =
      cryptoResolvedProofMetrics.finalPrice ??
      cryptoProposedProofMetrics.finalPrice ??
      cryptoFinalFromMeta;
    const persistedPercent =
      cryptoResolvedProofMetrics.percentChange ??
      cryptoProposedProofMetrics.percentChange ??
      cryptoPercentFromMeta;
    const percentChange =
      persistedPercent != null
        ? persistedPercent
        : startPrice != null && finalPrice != null && startPrice !== 0
        ? ((finalPrice - startPrice) / startPrice) * 100
        : null;
    const hasAny = startPrice != null || finalPrice != null || percentChange != null;
    return { startPrice, finalPrice, percentChange, hasAny };
  })();
  const showCryptoCardSummary =
    isFlashCryptoPriceMarket &&
    (endedByTime || isProposed || isResolvedOnChain || status === "finalized" || status === "cancelled") &&
    cryptoCardMetrics.hasAny;
  const cryptoGraduationCardMetrics = (() => {
    const startProgress =
      cryptoResolvedGradMetrics.progressStart ??
      cryptoProposedGradMetrics.progressStart ??
      cryptoProgressStart;
    const finalProgress =
      cryptoResolvedGradMetrics.progressEnd ??
      cryptoProposedGradMetrics.progressEnd ??
      cryptoProgressEnd;
    const didGraduateFinal =
      cryptoResolvedGradMetrics.didGraduateEnd ??
      cryptoProposedGradMetrics.didGraduateEnd ??
      cryptoDidGraduateEnd;
    const remainingToGraduateFinal =
      cryptoResolvedGradMetrics.remainingToGraduateEnd ??
      cryptoProposedGradMetrics.remainingToGraduateEnd ??
      cryptoRemainingToGraduateEnd;
    const hasAny =
      startProgress != null ||
      finalProgress != null ||
      didGraduateFinal != null ||
      remainingToGraduateFinal != null;
    return {
      startProgress,
      finalProgress,
      didGraduateFinal,
      remainingToGraduateFinal,
      hasAny,
    };
  })();
  const showCryptoGraduationCardSummary =
    isFlashCryptoGraduationMarket &&
    (endedByTime || isProposed || isResolvedOnChain || status === "finalized" || status === "cancelled") &&
    cryptoGraduationCardMetrics.hasAny;

  // Sport status: scheduled → live → locked → finished
  // Read sportStartTime from sportMeta or sportEvent
  const sportStartMs = (() => {
    const raw =
      market?.startTime ||
      sportEventForUi?.start_time ||
      sportEvent?.start_time ||
      (market.sportMeta as any)?.start_time ||
      readDescriptionField(market.description, "Window Start");
    const t = parseIsoUtc(raw)?.getTime() ?? NaN;
    return Number.isFinite(t) ? t : NaN;
  })();
  const resolvedSportEndMs = (() => {
    const raw =
      market?.endTime ||
      sportEventForUi?.end_time ||
      sportEvent?.end_time ||
      (market.sportMeta as any)?.end_time ||
      (market.sportMeta as any)?.window_end ||
      (asObject((market.sportMeta as any)?.live_micro).window_end as string | undefined) ||
      readDescriptionField(market.description, "Window End");
    const t = parseIsoUtc(raw)?.getTime() ?? NaN;
    return Number.isFinite(t) ? t : NaN;
  })();
  const sportKey = String(sportEventForUi?.sport || (market.sportMeta as any)?.sport || (isSoccerNextGoalMicro ? "soccer" : "")).toLowerCase();
  const isSoccerLike = sportKey === "soccer" || sportKey === "football";
  const sportDurationMs = predefinedSportDurationMs(sportKey);
  const sportHeuristicEndMs = Number.isFinite(sportStartMs) && Number.isFinite(sportDurationMs)
    ? sportStartMs + sportDurationMs
    : NaN;
  const sportPredefinedEndMs = Number.isFinite(resolvedSportEndMs)
    ? (isSoccerLike && Number.isFinite(sportHeuristicEndMs) ? sportHeuristicEndMs : resolvedSportEndMs)
    : Number.isFinite(sportStartMs) && Number.isFinite(sportDurationMs)
    ? sportStartMs + sportDurationMs
    : NaN;
  const sportLockOffsetMs = getTradingLockOffsetMs(sportKey);
  const hardSportLockMs = Number.isFinite(sportPredefinedEndMs)
    ? sportPredefinedEndMs - sportLockOffsetMs
    : NaN;
  const hardSportLockReached = Number.isFinite(hardSportLockMs) && nowMs >= hardSportLockMs;
  const sportBeforeStart = Number.isFinite(sportStartMs) && nowMs < sportStartMs;
  const sportGraceEndMs = Number.isFinite(sportPredefinedEndMs)
    ? sportPredefinedEndMs + (isSoccerLike ? SOCCER_GRACE_MS : 0)
    : NaN;
  const sportFinishedByTiming = !sportBeforeStart && Number.isFinite(sportGraceEndMs) && nowMs >= sportGraceEndMs;

  const sportFinished = sportBeforeStart
  ? false
  : sportIsFinished || market.sportTradingState === "ended_by_sport" || sportFinishedByTiming;
const ended = endedByTime;
  const sportEndMs = sportPredefinedEndMs;
  const sportLockMs = Number.isFinite(sportEndMs) ? sportEndMs - sportLockOffsetMs : NaN;
  const sportLocked = !sportFinished && (
    hardSportLockReached ||
    (!sportIsLive && Number.isFinite(sportLockMs) && nowMs >= sportLockMs)
  );

  // Compute sport phase: scheduled | live | locked | finished.
  // Provider live status has priority over early time-based checks before predefined end.
  const sportPhase: "scheduled" | "live" | "locked" | "finished" | null = (() => {
    if (!isSportLikeMarket) return null;
    if (sportFinished) return "finished";
    if (sportIsLive && !hardSportLockReached) return "live";
    // Hard guard: match hasn't started yet → always scheduled
    if (Number.isFinite(sportStartMs) && nowMs < sportStartMs) return "scheduled";
    if (sportLocked) return "locked";
    // Fallback: if we have end but no start, use ended check
    if (ended) return "finished";
    return "scheduled";
  })();

  const endLabel = hasValidEnd
    ? new Date(market.resolutionTime * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No end date";
  const sportKickoffLabel = Number.isFinite(sportStartMs)
    ? new Date(sportStartMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const sportEndsLabel = Number.isFinite(sportPredefinedEndMs)
    ? new Date(sportPredefinedEndMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const sportLocksLabel = Number.isFinite(sportLockMs)
    ? new Date(sportLockMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  const microWindowEndMs = (() => {
    const raw =
      sportMeta.window_end ??
      liveMicroMeta.window_end ??
      readDescriptionField(market.description, "Window End");
    const fromMeta = typeof raw === "string" ? parseIsoUtc(raw)?.getTime() ?? NaN : NaN;
    if (Number.isFinite(fromMeta)) return fromMeta;
    return hasValidEnd ? market.resolutionTime * 1000 : NaN;
  })();
  const cryptoWindowEnd = isFlashCryptoMarket
    ? String(cryptoMeta.window_end || market.endTime || "").trim() || null
    : null;
  const cryptoWindowEndMs = (() => {
    const parsed = parseIsoUtc(cryptoWindowEnd)?.getTime() ?? NaN;
    if (Number.isFinite(parsed)) return parsed;
    return hasValidEnd ? market.resolutionTime * 1000 : NaN;
  })();
  const cryptoUiTradingClosed =
    isFlashCryptoMarket &&
    Number.isFinite(cryptoWindowEndMs) &&
    nowMs >= cryptoWindowEndMs;
  const showCryptoUiLockState =
    cryptoUiTradingClosed &&
    !isProposed &&
    !isResolvedOnChain &&
    !ended;
  const microGoalObserved = isTruthyFlag(liveMicroMeta.goal_observed ?? sportMeta.goal_observed);
  const microTradingLocked = isTruthyFlag(liveMicroMeta.trading_locked ?? sportMeta.trading_locked);
  const blockedReasonLower = String(market.blockedReason || "").toLowerCase();
  const liveMicroAutoLocked =
    isSoccerNextGoalMicro &&
    (microGoalObserved ||
      microTradingLocked ||
      (market.isBlocked && /live micro|goal observed|goal detected|next goal/.test(blockedReasonLower)));
  const microWindowEnded = Number.isFinite(microWindowEndMs) ? nowMs >= microWindowEndMs : endedByTime;
  const flashFootUiTradingClosed =
    isSoccerNextGoalMicro &&
    Number.isFinite(microWindowEndMs) &&
    nowMs >= microWindowEndMs;
  const showFootUiLockState =
    flashFootUiTradingClosed &&
    !isProposed &&
    !isResolvedOnChain &&
    !ended &&
    !liveMicroAutoLocked;
  const showWindowEndedUiLockState = showCryptoUiLockState || showFootUiLockState;
  const microHeroState: "active" | "locked" | "resolving" | "ended" | null = (() => {
    if (!isSoccerNextGoalMicro) return null;
    if (isResolvedOnChain || status === "finalized" || status === "cancelled") return "ended";
    if (liveMicroAutoLocked) return "locked";
    if (isProposed || microWindowEnded) return "resolving";
    return "active";
  })();
  const showGenericBlockedBanner = !!market.isBlocked && !liveMicroAutoLocked;
  // marketClosed also respects the start_time guard:
  // if match hasn't started, sport-related locks don't apply
  const marketClosed = isResolvedOnChain || isProposed || ended || !!market.isBlocked
    || cryptoUiTradingClosed
    || flashFootUiTradingClosed
    || (!isFlashCryptoMarket && !isFlashTrafficMarket && !sportBeforeStart && sportLocked);

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
  const marketBadgeScorePair = unifiedTradeScorePair;
  const marketBadgeScore = marketBadgeScorePair
    ? `${marketBadgeScorePair.home}-${marketBadgeScorePair.away}`
    : null;
  const marketBadgeMinuteValue = sportEventForUi ? extractMinuteNumber(sportEventForUi) : NaN;
  const marketBadgeMinute = Number.isFinite(marketBadgeMinuteValue) && marketBadgeMinuteValue > 0
    ? `${Math.floor(marketBadgeMinuteValue)}'`
    : sharedSportMinute;
  const marketCardBadgeState: "scheduled" | "live" | "locked" | "resolving" | "finished" | "unknown" = (() => {
    if (ended || showResolvedProofBox || isResolvedOnChain) return "finished";
    if (isSoccerNextGoalMicro) {
      if (sportBeforeStart) return "scheduled";
      if (microHeroState === "ended" || sportPhase === "finished") return "finished";
      if (microHeroState === "locked" || sportPhase === "locked") return "locked";
      if (microHeroState === "resolving") return "resolving";
      if (microHeroState === "active") return "live";
    }
    if (sportPhase === "locked") return "locked";
    if (sharedSportDisplayStatus === "scheduled") return "scheduled";
    if (sharedSportDisplayStatus === "live") return "live";
    if (sharedSportDisplayStatus === "finished") return "finished";
    return "unknown";
  })();
  const sportMetaObj = asObject(market.sportMeta);
  const canonicalMarketImageUrl = normalizeVisualUrl(
    market.imageUrl ?? (market as any)?.image_url ?? null,
  );
  const marketCardVisualUrl = pickMarketCardVisual(
    sportEventForUi,
    sportMetaObj,
    market.imageUrl ?? (market as any)?.image_url ?? null,
  );
  const providerPrimaryVisualUrl = pickProviderVisual(sportEventForUi, sportMetaObj);
  const teamBadgeFallbackVisualUrl =
    pickBadge(sportEventForUi, sportMetaObj, "home") ||
    pickBadge(sportEventForUi, sportMetaObj, "away");
  const tradeCardThumbUrl =
    canonicalMarketImageUrl ||
    providerPrimaryVisualUrl ||
    marketCardVisualUrl ||
    teamBadgeFallbackVisualUrl ||
    null;
  const effectiveVol =
    Number.isFinite(marketBalanceLamports)
      ? (marketBalanceLamports as number)
      : Number(
          (market as any)?.totalVolume ??
          (market as any)?.total_volume ??
          0
        );
  const fullDescription = market?.description || "";
  const truncatedDescription = fullDescription.slice(0, 300);
  const shouldTruncate = fullDescription.length > 300;

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

              {/* Sport score card — when ended (on-chain), badge shows FINAL regardless of provider */}
              {sportEventForUi && isSportLikeMarket && (
                <SportScoreCard
                  event={sportEventForUi}
                  meta={market?.sportMeta}
                  displayStatus={ended ? "finished" : sharedSportDisplayStatus}
                  minute={ended ? "" : sharedSportMinute}
                  polling={liveScorePolling}
                  stale={liveScoreFailures >= 3}
                  lastPolledAt={liveScoreLastSuccessAt}
                  isLiveMicro={isSoccerNextGoalMicro}
                  microWindowEndMs={microWindowEndMs}
                  microGoalObserved={microGoalObserved}
                  microTradingLocked={microTradingLocked || !!market.isBlocked}
                  microState={microHeroState}
                  resolvedScorePair={unifiedTradeScorePair}
                  lockToResolvedScore={isSoccerNextGoalMicro}
                />
              )}

              {/* Soccer match details button */}
              {sportEventForUi && isSportLikeMarket && isSoccerLike && (market.sportMeta as any)?.provider_event_id && (
                <button
                  onClick={() => setSoccerDrawerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-800 bg-white/[0.03] hover:bg-white/[0.06] transition text-xs text-gray-400 hover:text-gray-200"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                  Match Details
                </button>
              )}

              {/* Sport trading state banners */}
              {isSoccerNextGoalMicro && microHeroState && (
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    microHeroState === "active"
                      ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
                      : microHeroState === "locked"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : microHeroState === "resolving"
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                      : "border-gray-600 bg-gray-800/40 text-gray-300"
                  }`}
                >
                  <div className="text-sm font-semibold">
                    {microHeroState === "active" && "Window active"}
                    {microHeroState === "locked" && "Goal detected"}
                    {microHeroState === "resolving" && "Resolving window"}
                    {microHeroState === "ended" && "Window ended"}
                  </div>
                  <div className="text-xs opacity-90 mt-0.5">
                    {microHeroState === "active" && "Trading open"}
                    {microHeroState === "locked" && "Trading locked"}
                    {microHeroState === "resolving" && "Awaiting resolution"}
                    {microHeroState === "ended" && "Final state reached"}
                  </div>
                </div>
              )}
              {!isSoccerNextGoalMicro && sportPhase === "locked" && (
                <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200 flex items-center gap-2">
                  Match ending soon, trading locked
                </div>
              )}
              {!isSoccerNextGoalMicro && sportPhase === "finished" && (
                <div className="rounded-xl border border-gray-600 bg-gray-800/40 px-4 py-3 text-sm text-gray-300 flex items-center gap-2">
                  Match ended — trading closed
                </div>
              )}

              {/* NBA Match Stats button — basketball markets only */}
              {market.marketMode === "sport" &&
                ["basketball", "nba", "ncaamb", "ncaawb", "wnba"].includes(sportKey) &&
                (market.sportMeta as any)?.provider_event_id && (
                  <button
                    onClick={() => setNbaDrawerOpen(true)}
                    className="w-full rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 transition px-4 py-3 text-sm text-blue-300 font-semibold flex items-center justify-center gap-2"
                  >
                    <span>📊</span> Match Stats
                  </button>
              )}

              {/* Flash Crypto Hero */}
              {isFlashCryptoPriceMarket && (() => {
                const cryptoIsEnded = isResolvedOnChain || isProposed || endedByTime;
                if (!cryptoTokenMint || !(cryptoPriceStart > 0)) return null;

                return (
                  <FlashCryptoMiniChart
                    tokenMint={cryptoTokenMint}
                    sourceType={cryptoSourceType}
                    majorSymbol={cryptoMajorSymbol}
                    majorPair={cryptoMajorPair}
                    tokenSymbol={cryptoTokenSymbol || undefined}
                    tokenName={cryptoTokenName || undefined}
                    tokenImageUri={cryptoTokenImageUri}
                    durationMinutes={cryptoDurationMinutes}
                    priceStart={cryptoPriceStart}
                    finalPrice={cryptoCardMetrics.finalPrice}
                    percentChange={cryptoCardMetrics.percentChange}
                    windowEnd={cryptoWindowEnd}
                    isEnded={cryptoIsEnded}
                  />
                );
              })()}
              {isFlashCryptoGraduationMarket && (() => {
                const cryptoIsEnded = isResolvedOnChain || isProposed || endedByTime;
                if (!cryptoTokenMint) return null;

                return (
                  <FlashCryptoGraduationHero
                    tokenMint={cryptoTokenMint}
                    tokenSymbol={cryptoTokenSymbol || undefined}
                    tokenName={cryptoTokenName || undefined}
                    tokenImageUri={cryptoTokenImageUri}
                    durationMinutes={cryptoDurationMinutes}
                    progressStart={cryptoGraduationCardMetrics.startProgress ?? cryptoProgressStart}
                    finalProgress={cryptoGraduationCardMetrics.finalProgress}
                    didGraduateFinal={cryptoGraduationCardMetrics.didGraduateFinal}
                    windowEnd={cryptoWindowEnd}
                    isEnded={cryptoIsEnded}
                  />
                );
              })()}
              {isFlashTrafficMarket && (() => {
                const trafficIsLive =
                  !isResolvedOnChain &&
                  !isProposed &&
                  status !== "finalized" &&
                  status !== "cancelled" &&
                  (trafficRemainingSec == null ? !endedByTime : trafficRemainingSec > 0);
                const timerToneClass =
                  trafficRemainingSec == null || trafficRemainingSec > 120
                    ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100 shadow-[0_0_14px_rgba(52,211,153,0.22)]"
                    : trafficRemainingSec > 45
                    ? "border-amber-300/45 bg-amber-300/12 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.20)]"
                    : "border-red-300/55 bg-red-400/14 text-red-50 shadow-[0_0_16px_rgba(248,113,113,0.28)]";
                const timerPulseClass = trafficRemainingSec != null && trafficRemainingSec <= 20
                  ? "animate-pulse"
                  : "";

                return (
                  <div className="rounded-xl border border-white/12 bg-[linear-gradient(135deg,rgba(20,24,32,0.82),rgba(12,15,20,0.88))] px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm sm:text-base font-semibold text-white">
                          {market.question || "Traffic Market"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {trafficIsLive && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-300/35 bg-red-400/12 px-2.5 py-1 text-[11px] font-semibold text-red-100">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-300 animate-pulse" />
                            LIVE
                          </span>
                        )}
                        <div className={`rounded-lg border px-2.5 py-1 text-base sm:text-lg font-bold tabular-nums tracking-[0.04em] ${timerToneClass} ${timerPulseClass}`}>
                          {trafficRemainingLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {isFlashTrafficMarket && (
                <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-white/70">
                    Traffic Debug Preview
                  </div>
                  <div className="mt-1.5 flex h-[420px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/50 md:h-[520px]">
                    {trafficDebugFrameSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={trafficDebugFrameSrc}
                        alt="Traffic debug frame"
                        className="block h-full max-h-full w-full max-w-full object-contain"
                      />
                    ) : null}
                    {!trafficDebugFrameSrc && trafficDebugFrameAvailable === false && (
                      <div className="px-3 py-6 text-center text-xs text-white/70">
                        No debug frame available yet
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Market card */}
              <div className="bg-black border border-gray-800 rounded-xl p-4 md:p-5 hover:border-pump-green/60 transition-all duration-200">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden bg-pump-dark">
                    {tradeCardThumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tradeCardThumbUrl}
                        alt={market.question}
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
                    {isSoccerNextGoalMicro && (microLoopSequence != null || microLoopPhaseLabel) && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {microLoopSequence != null && (
                          <span className="px-2 py-1 rounded-full border border-pump-green/40 bg-pump-green/10 text-pump-green text-xs font-semibold">
                            Window #{microLoopSequence}
                          </span>
                        )}
                        {microLoopPhaseLabel ? (
                          <span className="text-xs text-gray-400 font-medium">{microLoopPhaseLabel}</span>
                        ) : null}
                      </div>
                    )}
  
                    {/* Creator profile */}
                    {market.creator && (
                      <div className="flex items-center gap-2 mt-1">
                        {creatorProfile?.avatar_url ? (
                          <img src={creatorProfile.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gray-700 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-500">
                          by{" "}
                          <span className="text-gray-300">
                            {creatorProfile?.display_name
                              ? creatorProfile.display_name
                              : `${market.creator.slice(0, 4)}…${market.creator.slice(-4)}`}
                          </span>
                        </span>
                      </div>
                    )}

                    {market.socialLinks && (
                      <div className="mb-0">
                        <CreatorSocialLinks socialLinks={market.socialLinks} />
                      </div>
                    )}
                  </div>
                </div>

                {showCryptoCardSummary && (
                  <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-cyan-200/80 mb-2">
                      Flash Crypto Snapshot
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Start price</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {formatFlashCryptoPrice(cryptoCardMetrics.startPrice)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Final price</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {formatFlashCryptoPrice(cryptoCardMetrics.finalPrice)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Change %</div>
                        <div
                          className={`text-sm font-semibold tabular-nums ${
                            cryptoCardMetrics.percentChange == null
                              ? "text-gray-300"
                              : cryptoCardMetrics.percentChange >= 0
                              ? "text-pump-green"
                              : "text-[#ff5c73]"
                          }`}
                        >
                          {cryptoCardMetrics.percentChange == null
                            ? "—"
                            : `${cryptoCardMetrics.percentChange >= 0 ? "+" : ""}${cryptoCardMetrics.percentChange.toFixed(2)}%`}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {showCryptoGraduationCardSummary && (
                  <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-cyan-200/80 mb-2">
                      Flash Graduation Snapshot
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Start progress</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {formatFlashProgress(cryptoGraduationCardMetrics.startProgress)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Final progress</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {formatFlashProgress(cryptoGraduationCardMetrics.finalProgress)}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Graduate status</div>
                        <div className={`text-sm font-semibold ${
                          cryptoGraduationCardMetrics.didGraduateFinal ? "text-pump-green" : "text-red-300"
                        }`}>
                          {cryptoGraduationCardMetrics.didGraduateFinal == null
                            ? "—"
                            : cryptoGraduationCardMetrics.didGraduateFinal
                            ? "Graduated"
                            : "Not graduated"}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[11px] text-gray-500">Remaining</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {cryptoGraduationCardMetrics.remainingToGraduateFinal == null
                            ? "—"
                            : cryptoGraduationCardMetrics.remainingToGraduateFinal.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
  
                <div className="flex items-center gap-4 text-sm text-gray-400 mt-3 pt-3 border-t border-gray-800">
                  <div>
                    <span className="text-xs text-gray-400">Vol</span>{" "}
                    <span className="text-base md:text-lg font-semibold text-white">
                      {formatVol(effectiveVol)} SOL
                    </span>
                  </div>
  
                  {isSportLikeMarket ? (
                    <div className="leading-tight">
                      <div>
                        {sportKickoffLabel ? `Kickoff ${sportKickoffLabel}` : "Kickoff —"}
                        {sportEndsLabel ? ` Ends ~ ${sportEndsLabel}` : ""}
                      </div>
                      {sportLocksLabel && (
                        <div className="text-[11px] text-gray-500">Locks at {sportLocksLabel}</div>
                      )}
                    </div>
                  ) : (
                    <div>{endLabel}</div>
                  )}
  
                  <div className="ml-auto text-xs text-gray-500 flex items-center gap-2">
                    {/* Blocked badge */}
                    {market.isBlocked && (
                      liveMicroAutoLocked ? (
                        <span className="px-2 py-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 text-yellow-300">
                          Locked
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full border border-red-600/40 bg-red-600/20 text-red-400">
                          Blocked
                        </span>
                      )
                    )}

                    {/* Sport phase badges — on-chain ended overrides provider status */}
                    {(() => {
                      return (
                        <>
                          {!market.isBlocked && marketCardBadgeState === "scheduled" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-400">
                              Scheduled
                            </span>
                          )}
                          {!market.isBlocked && marketCardBadgeState === "live" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                              Live
                              {marketBadgeMinute && <span className="text-red-300">{marketBadgeMinute}</span>}
                              {marketBadgeScore && (
                                <span className="ml-1 font-mono text-white">
                                  {marketBadgeScore}
                                </span>
                              )}
                            </span>
                          )}
                          {!market.isBlocked && marketCardBadgeState === "locked" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 flex items-center gap-1">
                              Locked
                              {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                            </span>
                          )}
                          {!market.isBlocked && marketCardBadgeState === "resolving" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-200 flex items-center gap-1">
                              Resolving
                              {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                            </span>
                          )}
                          {!market.isBlocked && marketCardBadgeState === "finished" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-gray-500/40 bg-gray-700/30 text-gray-200 flex items-center gap-1">
                              Final
                              {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                            </span>
                          )}
                          {!market.isBlocked && marketCardBadgeState === "unknown" && !showProposedBox && !showResolvedProofBox && (
                            <span className="px-2 py-1 rounded-full border border-gray-600/40 bg-gray-700/20 text-gray-300">—</span>
                          )}
                        </>
                      );
                    })()}

                    {showProposedBox && !market.isBlocked && (
                      <span className="px-2 py-1 rounded-full border border-pump-green/40 bg-pump-green/10 text-pump-green flex items-center gap-1">
                        Proposed
                        {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                      </span>
                    )}

                    {showResolvedProofBox && (
                      <span className="px-2 py-1 rounded-full border border-gray-600 bg-gray-800/40 text-green-400 flex items-center gap-1">
                        Resolved
                        {marketBadgeScore && <span className="ml-1 font-mono text-white">{marketBadgeScore}</span>}
                      </span>
                    )}
                  </div>
                </div>
  
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
              <div className="bg-black border border-gray-800 rounded-xl p-5 md:p-6">
  
                {filteredOddsPoints.length ? (
                  <>
                    <div className="py-1 md:py-2">
                      <OddsHistoryChart
                        points={filteredOddsPoints}
                        outcomeNames={names}
                        height={isMobile ? 240 : 320}
                      />
                    </div>
  
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
  
              {/* Discussion / Activity / Rules */}
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

                  <button
                    onClick={() => setBottomTab("rules")}
                    className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
                      bottomTab === "rules"
                        ? "bg-pump-green/15 border-pump-green text-pump-green"
                        : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    Rules
                  </button>
                </div>

                {bottomTab === "discussion" ? (
                  <CommentsSection marketId={market.publicKey} />
                ) : bottomTab === "activity" ? (
                  <MarketActivityTab
                    marketDbId={market.dbId}
                    marketAddress={market.publicKey}
                    outcomeNames={names}
                  />
                ) : (
                  <div className="mt-4">
                    {isSoccerNextGoalMicro && (
                      <div className="mb-3 text-xs text-gray-400 space-y-1">
                        {microLoopSequence != null && (
                          <div>
                            Window: <span className="text-gray-200">#{microLoopSequence}</span>
                          </div>
                        )}
                        {microLoopPhaseLabel && (
                          <div>
                            Loop phase: <span className="text-gray-200">{microLoopPhaseLabel}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-sm text-gray-300 whitespace-pre-wrap">
                      {fullDescription ? (
                        <>
                          {descriptionExpanded || !shouldTruncate
                            ? fullDescription
                            : truncatedDescription}

                          {shouldTruncate && (
                            <button
                              onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                              className="ml-2 text-[#00FF88] hover:underline"
                            >
                              {descriptionExpanded ? "See less" : "See more"}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500">No rules provided.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
  
            {/* ════════════════════════════════════════════════════════════
                RIGHT COLUMN - STICKY (reste fixe pendant le scroll)
                ════════════════════════════════════════════════════════════ */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-6 space-y-4 pb-8">
                {/* Live micro auto-lock gets dedicated state copy; admin blocks keep the generic banner */}
                {liveMicroAutoLocked ? (
                  <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-5">
                    <h3 className="text-lg font-bold text-yellow-200 mb-2">Goal detected</h3>
                    <p className="text-sm text-yellow-100/90">
                      Trading has been locked for this market and it will resolve at window end.
                    </p>
                    {Number.isFinite(microWindowEndMs) && (
                      <p className="text-xs text-yellow-200/80 mt-3">
                        Window ends at{" "}
                        {new Date(microWindowEndMs).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                        .
                      </p>
                    )}
                  </div>
                ) : showGenericBlockedBanner ? (
                  <BlockedMarketBanner
                    reason={market.blockedReason}
                    blockedAt={market.blockedAt}
                  />
                ) : !isMobile && !ended ? (
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
                    marketClosedTitle={showWindowEndedUiLockState ? "Trading locked" : undefined}
                    marketClosedMessage={
                      showWindowEndedUiLockState
                        ? "Market window ended. Waiting for settlement / resolution."
                        : undefined
                    }
                  />
                ) : null}
  
                <ResolutionPanel
                  marketAddress={market.publicKey}
                  resolutionStatus={market.resolutionStatus ?? "open"}
                  isFlashCrypto={isFlashCryptoMarket}
                  cryptoFlashType={isFlashCryptoGraduationMarket ? "graduation" : isFlashCryptoMarket ? "price" : null}
                  cryptoTokenMint={cryptoTokenMint || null}
                  cryptoProvider={String(cryptoMeta.provider_name || cryptoMeta.provider_source || "pump_fun").trim() || null}
                  cryptoSourceType={cryptoSourceType}
                  cryptoMajorSymbol={cryptoMajorSymbol}
                  cryptoMajorPair={cryptoMajorPair}
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
                marketClosedTitle={showWindowEndedUiLockState ? "Trading locked" : undefined}
                marketClosedMessage={
                  showWindowEndedUiLockState
                    ? "Market window ended. Waiting for settlement / resolution."
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      )}

      <TradeBuyPopOverlay
        marketAddress={market.publicKey}
        marketId={market.dbId ?? null}
      />

      {/* NBA Widget Drawer — basketball match stats */}
      <NbaWidgetDrawer
        isOpen={nbaDrawerOpen}
        onClose={() => setNbaDrawerOpen(false)}
        gameId={String((market.sportMeta as any)?.provider_event_id || "")}
        isMobile={isMobile}
      />

      {/* Soccer Match Drawer — lineups + statistics */}
      <SoccerMatchDrawer
        isOpen={soccerDrawerOpen}
        onClose={() => setSoccerDrawerOpen(false)}
        eventId={String((market.sportMeta as any)?.provider_event_id || "")}
        isMobile={isMobile}
      />
    </>
  );
}
