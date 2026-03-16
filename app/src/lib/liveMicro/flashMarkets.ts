import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { LIVE_MICRO_TYPE } from "@/lib/liveMicro/repository";
import type { FlashMarket, FlashMarketStatus } from "@/lib/flashMarkets/types";

type LiveMicroDbRow = {
  id: string;
  provider_match_id: string | null;
  linked_market_id: string | null;
  linked_market_address: string | null;
  window_end: string | null;
  start_home_score: number | null;
  start_away_score: number | null;
  end_home_score: number | null;
  end_away_score: number | null;
  goal_observed: boolean | null;
  trading_locked_at: string | null;
  pending_outcome: string | null;
  engine_status: string | null;
  provider_payload_start: Record<string, unknown> | null;
  provider_payload_end: Record<string, unknown> | null;
  created_at: string | null;
};

type MarketDbRow = {
  id: string | null;
  market_address: string;
  question: string | null;
  image_url: string | null;
  total_volume: number | null;
  created_at: string | null;
  resolution_status: string | null;
  is_blocked: boolean | null;
  sport_meta: Record<string, unknown> | null;
  sport_event_id: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readPath(obj: unknown, path: Array<string | number>): unknown {
  let cur: unknown = obj;
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

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function firstText(candidates: unknown[]): string | null {
  for (const c of candidates) {
    const t = toText(c);
    if (t) return t;
  }
  return null;
}

function firstNumber(candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = toFiniteNumber(c);
    if (n != null) return n;
  }
  return null;
}

function normalizeImageUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "null" || raw === "undefined" || raw.startsWith("data:")) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/^http:\/\//i, "https://");
}

/**
 * Pick the best event image from a sport_events.raw object.
 * Mirrors the keys used by trade/[id] pickEventBanner / pickMarketCardVisual.
 */
function pickImageFromSportEventRaw(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const keys = [
    "strBanner", "strFanart1", "strThumb", "strPoster",
    "strFanart2", "strCutout", "strSquare",
    "event_banner", "event_image", "event_thumb",
    "event_poster", "event_thumbnail",
  ];
  for (const key of keys) {
    const v = normalizeImageUrl(raw[key]);
    if (v) return v;
  }
  return null;
}

function parseQuestionTeams(question: string | null | undefined): { home: string; away: string } | null {
  const raw = String(question || "").trim();
  if (!raw) return null;
  const cleaned = raw.replace(/^next\s+goal\s+in\s+\d+\s+minutes\?\s*/i, "");
  const match = cleaned.match(/^(.+?)\s+vs\s+(.+)$/i);
  if (!match) return null;
  const home = String(match[1] || "").trim();
  const away = String(match[2] || "").trim();
  if (!home || !away) return null;
  return { home, away };
}

function parseStatus(row: LiveMicroDbRow, market: MarketDbRow | null, nowMs: number): FlashMarketStatus {
  const engineStatus = String(row.engine_status || "").toLowerCase();
  const resolutionStatus = String(market?.resolution_status || "open").toLowerCase();
  const windowEndMs = Date.parse(String(row.window_end || ""));
  const windowEnded = Number.isFinite(windowEndMs) ? nowMs >= windowEndMs : false;

  // Terminal states from on-chain resolution pipeline.
  if (resolutionStatus === "finalized") return "finalized";
  if (resolutionStatus === "cancelled") return "cancelled";

  // Engine is active — the micro market is live right now.
  if (engineStatus === "active") {
    if (resolutionStatus !== "open") return "resolving";
    const lockedByMicro = !!row.goal_observed || !!row.trading_locked_at || String(row.pending_outcome || "").toUpperCase() === "YES";
    if (lockedByMicro || !!market?.is_blocked) return "locked";
    if (windowEnded) return "resolving";
    return "active";
  }

  // Engine is NOT active (proposed, completed, etc.).
  // If the window has ended the market is effectively done — treat as finalized
  // even if the on-chain resolution_status hasn't been updated yet.
  if (windowEnded) return "finalized";

  // Window hasn't ended but engine isn't active — still pending / resolving.
  return "resolving";
}

function scoreFromPayload(payload: Record<string, unknown> | null): { home: number; away: number } | null {
  const home = firstNumber([
    readPath(payload, ["current_score", "home"]),
    readPath(payload, ["score", "home"]),
    readPath(payload, ["event", "score", "home"]),
    readPath(payload, ["live", "home_score"]),
    readPath(payload, ["fixture", "goals", "home"]),
    readPath(payload, ["event", "raw", "full", "goals", "home"]),
    readPath(payload, ["event", "raw", "goals", "home"]),
  ]);
  const away = firstNumber([
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

function minuteFromPayload(payloadStart: Record<string, unknown> | null, payloadEnd: Record<string, unknown> | null): number | null {
  const minute = firstNumber([
    readPath(payloadEnd, ["minute"]),
    readPath(payloadEnd, ["event", "score", "minute"]),
    readPath(payloadEnd, ["event", "score", "elapsed"]),
    readPath(payloadEnd, ["event", "raw", "intProgress"]),
    readPath(payloadEnd, ["event", "raw", "full", "fixture", "status", "elapsed"]),
    readPath(payloadEnd, ["fixture", "fixture", "status", "elapsed"]),
    readPath(payloadStart, ["minute"]),
    readPath(payloadStart, ["event", "score", "minute"]),
    readPath(payloadStart, ["event", "score", "elapsed"]),
    readPath(payloadStart, ["event", "raw", "intProgress"]),
    readPath(payloadStart, ["event", "raw", "full", "fixture", "status", "elapsed"]),
    readPath(payloadStart, ["fixture", "fixture", "status", "elapsed"]),
  ]);
  if (minute == null) return null;
  return Math.max(0, Math.floor(minute));
}

function logoFromPayload(
  payloadStart: Record<string, unknown> | null,
  sportMeta: Record<string, unknown> | null,
  side: "home" | "away",
): string | null {
  const directKey = side === "home" ? "home_logo" : "away_logo";
  const eventRaw = asObject(readPath(payloadStart, ["event", "raw"]));
  const full = asObject(eventRaw.full);
  const teams = asObject(full.teams);
  const team = asObject(teams[side]);
  const liveMicro = asObject(asObject(sportMeta).live_micro);
  const rawMeta = asObject(asObject(sportMeta).raw);

  return firstText([
    readPath(payloadStart, [directKey]),
    readPath(payloadStart, ["event", directKey]),
    readPath(payloadStart, ["event", "raw", directKey]),
    readPath(payloadStart, ["fixture", "teams", side, "logo"]),
    team.logo,
    readPath(rawMeta, ["full", "teams", side, "logo"]),
    readPath(liveMicro, [directKey]),
  ]);
}

function leagueFromPayload(payloadStart: Record<string, unknown> | null, sportMeta: Record<string, unknown> | null): string | null {
  const rawMeta = asObject(asObject(sportMeta).raw);
  return firstText([
    readPath(payloadStart, ["league"]),
    readPath(payloadStart, ["event", "league"]),
    readPath(payloadStart, ["fixture", "league", "name"]),
    readPath(payloadStart, ["event", "raw", "full", "league", "name"]),
    readPath(rawMeta, ["full", "league", "name"]),
    readPath(rawMeta, ["league", "name"]),
    readPath(sportMeta, ["league"]),
  ]);
}

function sportFromPayload(payloadStart: Record<string, unknown> | null, sportMeta: Record<string, unknown> | null): string | null {
  return firstText([
    readPath(payloadStart, ["sport"]),
    readPath(payloadStart, ["event", "sport"]),
    readPath(sportMeta, ["sport"]),
    readPath(sportMeta, ["raw", "sport"]),
    "soccer",
  ]);
}

function providerImageFromPayload(
  payloadStart: Record<string, unknown> | null,
  payloadEnd: Record<string, unknown> | null,
  sportMeta: Record<string, unknown> | null,
  fallbackMarketImageUrl: string | null,
): string | null {
  const meta = asObject(sportMeta);
  const rawMeta = asObject(meta.raw);
  const images = asObject(meta.images);
  const liveMicro = asObject(meta.live_micro);
  const liveMicroRaw = asObject(liveMicro.raw);
  const endRaw = asObject(readPath(payloadEnd, ["event", "raw"]));
  const startRaw = asObject(readPath(payloadStart, ["event", "raw"]));
  // payload top-level and payload.raw (theSportsDB may store fields here)
  const payloadEndDirect = asObject(payloadEnd);
  const payloadStartDirect = asObject(payloadStart);
  const payloadEndRaw = asObject(payloadEndDirect.raw);
  const payloadStartRaw = asObject(payloadStartDirect.raw);

  // Keep this aligned with trade/[id] visual selection logic (pickMarketCardVisual / pickEventBanner).
  // Order: payload event.raw → payload top-level/raw → sportMeta.live_micro.raw → sportMeta.raw → sportMeta.images → sportMeta.live_micro → sportMeta top-level → fallback
  const candidates: unknown[] = [
    // 1. payload.event.raw (nested theSportsDB structure)
    endRaw.strBanner,
    startRaw.strBanner,
    endRaw.strFanart1,
    startRaw.strFanart1,
    endRaw.strThumb,
    startRaw.strThumb,
    endRaw.strPoster,
    startRaw.strPoster,
    endRaw.event_image,
    startRaw.event_image,
    endRaw.event_thumb,
    startRaw.event_thumb,
    endRaw.event_banner,
    startRaw.event_banner,
    endRaw.event_poster,
    startRaw.event_poster,
    endRaw.event_thumbnail,
    startRaw.event_thumbnail,
    endRaw.strFanart2,
    startRaw.strFanart2,
    endRaw.strCutout,
    startRaw.strCutout,
    endRaw.strSquare,
    startRaw.strSquare,
    // 2. payload top-level (theSportsDB stores fields flat in some configs)
    payloadEndDirect.strBanner,
    payloadStartDirect.strBanner,
    payloadEndDirect.strFanart1,
    payloadStartDirect.strFanart1,
    payloadEndDirect.strThumb,
    payloadStartDirect.strThumb,
    payloadEndDirect.strPoster,
    payloadStartDirect.strPoster,
    payloadEndDirect.event_image,
    payloadStartDirect.event_image,
    // 3. payload.raw (one-level nesting, not under event)
    payloadEndRaw.strBanner,
    payloadStartRaw.strBanner,
    payloadEndRaw.strFanart1,
    payloadStartRaw.strFanart1,
    payloadEndRaw.strThumb,
    payloadStartRaw.strThumb,
    payloadEndRaw.strPoster,
    payloadStartRaw.strPoster,
    payloadEndRaw.event_image,
    payloadStartRaw.event_image,
    // 4. sportMeta.live_micro.raw (trade page merges this into event.raw — was missing)
    liveMicroRaw.strBanner,
    liveMicroRaw.strFanart1,
    liveMicroRaw.strFanart2,
    liveMicroRaw.strThumb,
    liveMicroRaw.strPoster,
    liveMicroRaw.strCutout,
    liveMicroRaw.strSquare,
    liveMicroRaw.event_image,
    liveMicroRaw.event_thumb,
    liveMicroRaw.event_banner,
    liveMicroRaw.event_poster,
    liveMicroRaw.event_thumbnail,
    // 5. sportMeta.raw
    rawMeta.strBanner,
    rawMeta.strFanart1,
    rawMeta.strFanart2,
    rawMeta.strThumb,
    rawMeta.strPoster,
    rawMeta.strCutout,
    rawMeta.strSquare,
    rawMeta.event_image,
    rawMeta.event_thumb,
    rawMeta.event_banner,
    rawMeta.event_poster,
    rawMeta.event_thumbnail,
    // 6. sportMeta.images
    images.strBanner,
    images.strFanart1,
    images.strThumb,
    images.strPoster,
    images.event_image,
    images.event_thumb,
    // 7. sportMeta.live_micro (direct)
    liveMicro.strBanner,
    liveMicro.strFanart1,
    liveMicro.strThumb,
    liveMicro.strPoster,
    liveMicro.event_image,
    liveMicro.event_thumb,
    // 8. sportMeta top-level (trade page pickEventBanner checks "meta" directly)
    meta.strBanner,
    meta.strFanart1,
    meta.strFanart2,
    meta.strThumb,
    meta.strPoster,
    meta.strCutout,
    meta.strSquare,
    meta.event_image,
    meta.event_thumb,
    meta.event_banner,
    meta.event_poster,
    meta.event_thumbnail,
    // 9. market.image_url fallback
    fallbackMarketImageUrl,
  ];

  for (const c of candidates) {
    const normalized = normalizeImageUrl(c);
    if (normalized) return normalized;
  }

  return null;
}

function teamNameFromPayload(
  payloadStart: Record<string, unknown> | null,
  question: string | null | undefined,
  side: "home" | "away",
): string {
  const parsedQuestion = parseQuestionTeams(question);
  const eventRaw = asObject(readPath(payloadStart, ["event", "raw"]));
  const full = asObject(eventRaw.full);
  const teams = asObject(full.teams);
  const team = asObject(teams[side]);

  return (
    firstText([
      readPath(payloadStart, ["event", side === "home" ? "home_team" : "away_team"]),
      readPath(payloadStart, [side === "home" ? "home_team" : "away_team"]),
      readPath(payloadStart, ["fixture", "teams", side, "name"]),
      team.name,
      side === "home" ? parsedQuestion?.home : parsedQuestion?.away,
    ]) || (side === "home" ? "Home" : "Away")
  );
}

function scoreFromRow(row: LiveMicroDbRow): { home: number; away: number } {
  const homeStart = toFiniteNumber(row.start_home_score) ?? 0;
  const awayStart = toFiniteNumber(row.start_away_score) ?? 0;
  const homeEnd = toFiniteNumber(row.end_home_score);
  const awayEnd = toFiniteNumber(row.end_away_score);
  return {
    home: Math.max(0, Math.floor(homeEnd ?? homeStart)),
    away: Math.max(0, Math.floor(awayEnd ?? awayStart)),
  };
}

function recencyMs(value: string | null | undefined): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

const STATUS_RANK: Record<FlashMarketStatus, number> = {
  active: 0, locked: 1, resolving: 2, finalized: 3, cancelled: 4,
};

function explorerComparator(a: FlashMarket, b: FlashMarket): number {
  const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rankDiff !== 0) return rankDiff;
  if (b.volume !== a.volume) return b.volume - a.volume;
  return recencyMs(b.createdAt) - recencyMs(a.createdAt);
}

function homeComparator(a: FlashMarket, b: FlashMarket): number {
  const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rankDiff !== 0) return rankDiff;
  if (b.volume !== a.volume) return b.volume - a.volume;
  return recencyMs(b.createdAt) - recencyMs(a.createdAt);
}

function dedupeByMatch(rows: FlashMarket[], cmp: (a: FlashMarket, b: FlashMarket) => number): FlashMarket[] {
  const bestByMatch = new Map<string, FlashMarket>();
  for (const row of rows) {
    const key = row.providerMatchId || row.marketAddress;
    const current = bestByMatch.get(key);
    if (!current || cmp(row, current) < 0) {
      bestByMatch.set(key, row);
    }
  }
  return Array.from(bestByMatch.values());
}

function normalizeLimit(limit: number, fallback: number, max = 20): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

async function loadFlashCandidates(maxRows: number): Promise<FlashMarket[]> {
  const supabase = supabaseServer();
  const fetchLimit = normalizeLimit(maxRows, 20, 50);
  const nowMs = Date.now();

  const { data: liveRows, error: liveErr } = await supabase
    .from("live_micro_markets")
    .select(
      [
        "id",
        "provider_match_id",
        "linked_market_id",
        "linked_market_address",
        "window_end",
        "start_home_score",
        "start_away_score",
        "end_home_score",
        "end_away_score",
        "goal_observed",
        "trading_locked_at",
        "pending_outcome",
        "engine_status",
        "provider_payload_start",
        "provider_payload_end",
        "created_at",
      ].join(","),
    )
    .eq("micro_market_type", LIVE_MICRO_TYPE)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (liveErr) throw new Error(`live_micro_markets fetch failed: ${liveErr.message}`);

  const live = ((liveRows || []) as unknown as LiveMicroDbRow[]).filter((row) => !!row.linked_market_address);
  const addresses = Array.from(
    new Set(
      live
        .map((row) => String(row.linked_market_address || "").trim())
        .filter(Boolean),
    ),
  );
  if (!addresses.length) return [];

  const { data: marketRows, error: marketErr } = await supabase
    .from("markets")
    .select("id,market_address,question,image_url,total_volume,created_at,resolution_status,is_blocked,sport_meta,sport_event_id")
    .in("market_address", addresses);

  if (marketErr) throw new Error(`markets fetch for flash list failed: ${marketErr.message}`);

  const marketByAddress = new Map<string, MarketDbRow>();
  for (const row of (marketRows || []) as unknown as MarketDbRow[]) {
    marketByAddress.set(String(row.market_address || "").trim(), row);
  }

  // ── Batch-fetch sport_events to get provider images (strThumb, strBanner, etc.) ──
  // The markets table only stores sport_meta (no raw images), but sport_events.raw
  // contains the full theSportsDB event data including image URLs.
  const sportEventImageByAddress = new Map<string, string>();
  const sportEventIds = Array.from(
    new Set(
      Array.from(marketByAddress.values())
        .map((m) => m.sport_event_id)
        .filter((id): id is string => !!id),
    ),
  );
  if (sportEventIds.length > 0) {
    const { data: seRows, error: seErr } = await supabase
      .from("sport_events")
      .select("id,raw")
      .in("id", sportEventIds);
    if (!seErr && seRows) {
      const seById = new Map<string, Record<string, unknown>>();
      for (const se of seRows) {
        if (se.id && se.raw && typeof se.raw === "object" && !Array.isArray(se.raw)) {
          seById.set(se.id, se.raw as Record<string, unknown>);
        }
      }
      for (const row of (marketRows || []) as unknown as MarketDbRow[]) {
        const addr = String(row.market_address || "").trim();
        if (!addr || !row.sport_event_id) continue;
        const raw = seById.get(row.sport_event_id);
        if (!raw) continue;
        const img = pickImageFromSportEventRaw(raw);
        if (img) sportEventImageByAddress.set(addr, img);
      }
    }
  }

  const out: FlashMarket[] = [];
  for (const row of live) {
    const marketAddress = String(row.linked_market_address || "").trim();
    if (!marketAddress) continue;
    const market = marketByAddress.get(marketAddress) || null;

    const status = parseStatus(row, market, nowMs);
    const payloadStart = row.provider_payload_start || {};
    const payloadEnd = row.provider_payload_end || {};

    const startScore = {
      home: Math.max(0, Math.floor(toFiniteNumber(row.start_home_score) ?? 0)),
      away: Math.max(0, Math.floor(toFiniteNumber(row.start_away_score) ?? 0)),
    };
    const payloadCurrentScore = scoreFromPayload(payloadEnd) || scoreFromPayload(payloadStart);
    const rowScore = scoreFromRow(row);
    const currentScore = payloadCurrentScore || rowScore;

    const minute = minuteFromPayload(payloadStart, payloadEnd);
    const windowEndMs = Date.parse(String(row.window_end || ""));
    const remainingSec =
      status === "active" && Number.isFinite(windowEndMs)
        ? Math.max(0, Math.ceil((windowEndMs - nowMs) / 1000))
        : null;

    const sportMeta = market?.sport_meta || null;
    const question = market?.question || null;
    const marketImageUrl = normalizeImageUrl(market?.image_url ?? null);
    // Sport event image from sport_events.raw (the actual source of theSportsDB images)
    const sportEventImage = sportEventImageByAddress.get(marketAddress) || null;
    const providerImageUrl = providerImageFromPayload(payloadStart, payloadEnd, sportMeta, marketImageUrl) || sportEventImage;
    const heroImageUrl = providerImageUrl || marketImageUrl;
    const league = leagueFromPayload(payloadStart, sportMeta);
    const sport = sportFromPayload(payloadStart, sportMeta);

    out.push({
      liveMicroId: row.id,
      providerMatchId: String(row.provider_match_id || ""),
      marketAddress,
      marketId: market?.id ?? null,
      question: question || "Next goal in 5 minutes?",
      league,
      sport,
      providerImageUrl,
      marketImageUrl,
      heroImageUrl,
      homeTeam: teamNameFromPayload(payloadStart, question, "home"),
      awayTeam: teamNameFromPayload(payloadStart, question, "away"),
      homeLogo: logoFromPayload(payloadStart, sportMeta, "home"),
      awayLogo: logoFromPayload(payloadStart, sportMeta, "away"),
      startScoreHome: startScore.home,
      startScoreAway: startScore.away,
      currentScoreHome: currentScore.home,
      currentScoreAway: currentScore.away,
      minute,
      windowEnd: row.window_end,
      remainingSec,
      status,
      volume: Math.max(0, Math.floor(toFiniteNumber(market?.total_volume) ?? 0)),
      createdAt: String(row.created_at || market?.created_at || new Date(0).toISOString()),
    });
  }

  return out;
}

/** Returns true if the flash market is still relevant for live UX display. */
function isStillLiveUx(m: FlashMarket): boolean {
  // Always show active / locked — these are genuinely live right now.
  if (m.status === "active" || m.status === "locked") return true;

  // For "resolving": only show if the window ended recently (< 10 min ago).
  // After that the market is stale and should drop off the live feed.
  if (m.status === "resolving") {
    const windowEndMs = Date.parse(String(m.windowEnd || ""));
    if (!Number.isFinite(windowEndMs)) {
      // No window_end data — fall back to createdAt freshness (< 15 min).
      const createdMs = Date.parse(String(m.createdAt || ""));
      return Number.isFinite(createdMs) && Date.now() - createdMs < 15 * 60_000;
    }
    return Date.now() - windowEndMs < 10 * 60_000;
  }

  return false;
}

export async function getTopLiveFlashMarkets(limit = 6): Promise<FlashMarket[]> {
  const cap = normalizeLimit(limit, 6);
  const candidates = await loadFlashCandidates(20);
  const scoped = dedupeByMatch(candidates, explorerComparator)
    .filter(isStillLiveUx)
    .sort(explorerComparator);
  return scoped.slice(0, cap);
}

export async function getTopHomeLiveFlashMarket(): Promise<FlashMarket | null> {
  const candidates = await loadFlashCandidates(20);
  const deduped = dedupeByMatch(candidates, homeComparator)
    .filter(isStillLiveUx)
    .sort(homeComparator);
  return deduped[0] ?? null;
}

const OPEN_STATUSES: ReadonlySet<FlashMarketStatus> = new Set<FlashMarketStatus>(["active", "locked", "resolving"]);
const RESOLVED_STATUSES: ReadonlySet<FlashMarketStatus> = new Set<FlashMarketStatus>(["finalized", "cancelled"]);

/** Flash markets for Explorer — supports Open / Resolved filter. */
export async function getExplorerFlashMarkets(
  limit = 6,
  filter: "open" | "resolved" = "open",
): Promise<FlashMarket[]> {
  const cap = normalizeLimit(limit, 6);
  // Fetch more rows for resolved since many may be old
  const candidates = await loadFlashCandidates(filter === "resolved" ? 50 : 20);
  const allowed = filter === "resolved" ? RESOLVED_STATUSES : OPEN_STATUSES;
  const filtered = candidates.filter((m) => allowed.has(m.status));
  const deduped = filter === "open"
    ? dedupeByMatch(filtered, explorerComparator).filter(isStillLiveUx)
    : filtered; // resolved: show all recent, no deduplication needed
  deduped.sort(explorerComparator);
  return deduped.slice(0, cap);
}
