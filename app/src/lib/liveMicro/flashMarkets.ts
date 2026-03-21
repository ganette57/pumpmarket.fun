import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { LIVE_MICRO_TYPE, setLinkedMarketImageUrlIfMissing } from "@/lib/liveMicro/repository";
import { FLASH_CRYPTO_MICRO_TYPE } from "@/lib/flashCrypto/types";
import { listFlashCryptoMarketsForExplorer } from "@/lib/flashCrypto/repository";
import type { FlashMarket, FlashMarketKind, FlashMarketStatus } from "@/lib/flashMarkets/types";

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
  description: string | null;
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

function normalizePositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  return floored >= 1 ? floored : null;
}

function readDescriptionField(description: string | null | undefined, fieldLabel: string): string | null {
  const raw = String(description || "");
  if (!raw) return null;
  const escaped = fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

function loopSequenceFromDescription(description: string | null | undefined): number | null {
  return normalizePositiveInt(readDescriptionField(description, "Loop Sequence"));
}

function loopSequenceFromMeta(sportMeta: Record<string, unknown> | null): number | null {
  const meta = asObject(sportMeta);
  const liveMicro = asObject(meta.live_micro);
  return (
    normalizePositiveInt(liveMicro.loop_sequence) ??
    normalizePositiveInt(liveMicro.loopSequence) ??
    normalizePositiveInt(meta.loop_sequence) ??
    normalizePositiveInt(meta.loopSequence) ??
    null
  );
}

function loopSequenceFromPayload(payloadStart: Record<string, unknown> | null): number | null {
  return (
    normalizePositiveInt(readPath(payloadStart, ["loop_context", "loopSequence"])) ??
    normalizePositiveInt(readPath(payloadStart, ["loop_context", "sequence"])) ??
    normalizePositiveInt(readPath(payloadStart, ["loop_context", "loop_sequence"])) ??
    normalizePositiveInt(readPath(payloadStart, ["loopSequence"])) ??
    normalizePositiveInt(readPath(payloadStart, ["loop_sequence"])) ??
    null
  );
}

function loopPhaseFromPayload(payloadStart: Record<string, unknown> | null, sportMeta: Record<string, unknown> | null): string | null {
  return (
    firstText([
      readPath(payloadStart, ["loop_context", "loopPhase"]),
      readPath(payloadStart, ["loop_context", "loop_phase"]),
      readPath(payloadStart, ["loop_context", "phase"]),
      readPath(payloadStart, ["loopPhase"]),
      readPath(payloadStart, ["loop_phase"]),
      readPath(sportMeta, ["live_micro", "loop_phase"]),
      readPath(sportMeta, ["live_micro", "loopPhase"]),
    ]) || null
  );
}

function normalizeImageUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "null" || raw === "undefined" || raw.startsWith("data:")) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/^http:\/\//i, "https://");
}

function firstImageUrl(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function imageFromKnownKeys(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  return firstImageUrl([
    raw.image_url,
    raw.imageUrl,
    raw.thumbnail,
    raw.thumb,
    raw.event_image,
    raw.event_thumb,
    raw.event_poster,
    raw.event_banner,
    raw.event_square,
    raw.event_thumbnail,
    raw.strThumb,
    raw.strPoster,
    raw.strBanner,
    raw.strSquare,
    raw.strFanart1,
    raw.strFanart2,
    raw.strCutout,
  ]);
}

function pickImageFromSportEventRaw(raw: Record<string, unknown> | null): string | null {
  return imageFromKnownKeys(raw);
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
  const liveMicro = asObject(meta.live_micro);
  const payloadEndDirect = asObject(payloadEnd);
  const payloadStartDirect = asObject(payloadStart);
  const payloadEndEvent = asObject(readPath(payloadEndDirect, ["event"]));
  const payloadStartEvent = asObject(readPath(payloadStartDirect, ["event"]));
  const payloadEndEventRaw = asObject(readPath(payloadEndEvent, ["raw"]));
  const payloadStartEventRaw = asObject(readPath(payloadStartEvent, ["raw"]));
  const payloadEndRaw = asObject(payloadEndDirect.raw);
  const payloadStartRaw = asObject(payloadStartDirect.raw);
  const payloadEndLiveRaw = asObject(readPath(payloadEndDirect, ["live", "raw"]));
  const payloadStartLiveRaw = asObject(readPath(payloadStartDirect, ["live", "raw"]));
  const liveMicroRaw = asObject(liveMicro.raw);
  const rawMeta = asObject(meta.raw);
  const images = asObject(meta.images);

  const resolved = firstImageUrl([
    imageFromKnownKeys(payloadEndEvent),
    imageFromKnownKeys(payloadStartEvent),
    imageFromKnownKeys(payloadEndEventRaw),
    imageFromKnownKeys(payloadStartEventRaw),
    imageFromKnownKeys(payloadEndDirect),
    imageFromKnownKeys(payloadStartDirect),
    imageFromKnownKeys(payloadEndRaw),
    imageFromKnownKeys(payloadStartRaw),
    imageFromKnownKeys(payloadEndLiveRaw),
    imageFromKnownKeys(payloadStartLiveRaw),
    imageFromKnownKeys(liveMicroRaw),
    imageFromKnownKeys(rawMeta),
    imageFromKnownKeys(images),
    imageFromKnownKeys(liveMicro),
    imageFromKnownKeys(meta),
  ]);
  if (resolved) return resolved;
  return normalizeImageUrl(fallbackMarketImageUrl);
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
  const fetchLimit = normalizeLimit(maxRows, 20, 500);
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
    .select("id,market_address,question,description,image_url,total_volume,created_at,resolution_status,is_blocked,sport_meta,sport_event_id")
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
  const pendingCanonicalBackfill = new Map<string, string>();
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
    const loopSequence =
      loopSequenceFromPayload(payloadStart) ??
      loopSequenceFromDescription(market?.description) ??
      loopSequenceFromMeta(sportMeta);
    const loopPhase = loopPhaseFromPayload(payloadStart, sportMeta);
    const canonicalMarketImageUrl = normalizeImageUrl(market?.image_url ?? null);
    // Sport event image from sport_events.raw (the actual source of theSportsDB images)
    const sportEventImage = sportEventImageByAddress.get(marketAddress) || null;
    const homeLogo = logoFromPayload(payloadStart, sportMeta, "home");
    const awayLogo = logoFromPayload(payloadStart, sportMeta, "away");
    const fallbackBadgeVisual = firstImageUrl([
      readPath(payloadEnd, ["live", "raw", "home_badge"]),
      readPath(payloadEnd, ["live", "raw", "away_badge"]),
      readPath(payloadStart, ["live", "raw", "home_badge"]),
      readPath(payloadStart, ["live", "raw", "away_badge"]),
      homeLogo,
      awayLogo,
    ]);
    const fallbackResolvedImage =
      providerImageFromPayload(payloadStart, payloadEnd, sportMeta, null) ||
      sportEventImage ||
      fallbackBadgeVisual;
    const heroImageUrl = canonicalMarketImageUrl || fallbackResolvedImage;
    if (!canonicalMarketImageUrl && heroImageUrl) {
      pendingCanonicalBackfill.set(marketAddress, heroImageUrl);
    }
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
      providerImageUrl: fallbackResolvedImage,
      marketImageUrl: canonicalMarketImageUrl,
      heroImageUrl,
      homeTeam: teamNameFromPayload(payloadStart, question, "home"),
      awayTeam: teamNameFromPayload(payloadStart, question, "away"),
      homeLogo,
      awayLogo,
      startScoreHome: startScore.home,
      startScoreAway: startScore.away,
      currentScoreHome: currentScore.home,
      currentScoreAway: currentScore.away,
      minute,
      windowEnd: row.window_end,
      loopSequence,
      loopPhase,
      remainingSec,
      status,
      volume: Math.max(0, Math.floor(toFiniteNumber(market?.total_volume) ?? 0)),
      createdAt: String(row.created_at || market?.created_at || new Date(0).toISOString()),
      kind: "sport",
    });
  }

  if (pendingCanonicalBackfill.size > 0) {
    await Promise.all(
      Array.from(pendingCanonicalBackfill.entries()).map(async ([marketAddress, imageUrl]) => {
        try {
          await setLinkedMarketImageUrlIfMissing({ marketAddress, imageUrl });
        } catch (error) {
          console.warn("[flashMarkets] canonical image backfill failed", { marketAddress, error });
        }
      }),
    );
  }

  return out;
}

async function loadCryptoFlashCandidates(maxRows: number): Promise<FlashMarket[]> {
  try {
    const pairs = await listFlashCryptoMarketsForExplorer(maxRows);
    const nowMs = Date.now();
    const out: FlashMarket[] = [];

    for (const { liveMicro: row, market } of pairs) {
      const marketAddress = String(row.linked_market_address || "").trim();
      if (!marketAddress) continue;

      const payloadStart = (row.provider_payload_start || {}) as Record<string, unknown>;
      const payloadEnd = (row.provider_payload_end || {}) as Record<string, unknown>;
      const meta = (market?.sport_meta || {}) as Record<string, unknown>;

      const engineStatus = String(row.engine_status || "").toLowerCase();
      const resolutionStatus = String(market?.resolution_status || "open").toLowerCase();
      const windowEndMs = Date.parse(String(row.window_end || ""));
      const windowEnded = Number.isFinite(windowEndMs) ? nowMs >= windowEndMs : false;

      let status: FlashMarketStatus;
      if (resolutionStatus === "finalized") status = "finalized";
      else if (resolutionStatus === "cancelled") status = "cancelled";
      else if (engineStatus === "active") {
        status = windowEnded || resolutionStatus !== "open" ? "resolving" : "active";
      } else if (windowEnded) {
        // Keep Explorer UX aligned with sports flash: once the engine closed and
        // the market window is done, treat it as resolved for listing purposes.
        status = "finalized";
      } else {
        status = "resolving";
      }

      const remainingSec =
        status === "active" && Number.isFinite(windowEndMs)
          ? Math.max(0, Math.ceil((windowEndMs - nowMs) / 1000))
          : null;

      const tokenMint = String(payloadStart.token_mint || meta.token_mint || "");
      const tokenSymbol = String(payloadStart.token_symbol || meta.token_symbol || "");
      const tokenName = String(payloadStart.token_name || meta.token_name || "");
      const tokenImageUri = String(payloadStart.token_image_uri || meta.token_image_uri || "").trim() || null;
      const priceStart = Number(payloadStart.price_start || meta.price_start || 0);
      const priceEnd = Number(payloadEnd.price_end || meta.price_end || 0) || null;
      const durationMinutes = Number(payloadStart.duration_minutes || meta.duration_minutes || 0);

      out.push({
        liveMicroId: row.id,
        providerMatchId: tokenMint,
        marketAddress,
        marketId: market?.id ?? null,
        question: market?.question || `Will $${tokenSymbol} go UP in ${durationMinutes} minutes?`,
        league: null,
        sport: "crypto",
        providerImageUrl: tokenImageUri,
        marketImageUrl: String(market?.image_url || "").trim() || tokenImageUri,
        heroImageUrl: tokenImageUri,
        homeTeam: `$${tokenSymbol}`,
        awayTeam: "",
        homeLogo: tokenImageUri,
        awayLogo: null,
        startScoreHome: 0,
        startScoreAway: 0,
        currentScoreHome: 0,
        currentScoreAway: 0,
        minute: null,
        windowEnd: row.window_end,
        loopSequence: null,
        loopPhase: null,
        remainingSec,
        status,
        volume: Math.max(0, Math.floor(Number(market?.total_volume) || 0)),
        createdAt: String(row.created_at || market?.created_at || new Date(0).toISOString()),
        kind: "crypto",
        tokenMint,
        tokenSymbol,
        tokenName,
        tokenImageUri,
        priceStart: priceStart || null,
        priceEnd,
        durationMinutes: durationMinutes || null,
      });
    }

    return out;
  } catch (e) {
    console.warn("[flashMarkets] crypto candidates load failed:", e);
    return [];
  }
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
  const [sportCandidates, cryptoCandidates] = await Promise.all([
    loadFlashCandidates(20),
    loadCryptoFlashCandidates(20),
  ]);
  const candidates = [...sportCandidates, ...cryptoCandidates];
  const scoped = dedupeByMatch(candidates, explorerComparator)
    .filter(isStillLiveUx)
    .sort(explorerComparator);
  return scoped.slice(0, cap);
}

export async function getTopHomeLiveFlashMarket(kind: FlashMarketKind | "all" = "all"): Promise<FlashMarket | null> {
  const [sportCandidates, cryptoCandidates] = await Promise.all([
    loadFlashCandidates(20),
    loadCryptoFlashCandidates(20),
  ]);
  const candidates = [...sportCandidates, ...cryptoCandidates];
  const deduped = dedupeByMatch(candidates, homeComparator)
    .filter((m) => kind === "all" || m.kind === kind)
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
  kind: FlashMarketKind | "all" = "all",
): Promise<FlashMarket[]> {
  const cap = normalizeLimit(limit, 6, 200);
  const desiredRows = filter === "resolved" ? Math.max(cap, 200) : Math.max(cap, 20);
  const [sportCandidates, cryptoCandidates] = await Promise.all([
    loadFlashCandidates(desiredRows),
    loadCryptoFlashCandidates(desiredRows),
  ]);
  const candidates = [...sportCandidates, ...cryptoCandidates];
  const allowed = filter === "resolved" ? RESOLVED_STATUSES : OPEN_STATUSES;
  const filtered = candidates
    .filter((m) => kind === "all" || m.kind === kind)
    .filter((m) => allowed.has(m.status));
  const deduped = filter === "open"
    ? dedupeByMatch(filtered, explorerComparator).filter(isStillLiveUx)
    : filtered; // resolved: show all recent, no deduplication needed
  deduped.sort(explorerComparator);
  return deduped.slice(0, cap);
}
