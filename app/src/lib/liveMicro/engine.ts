import "server-only";

import { getLiveMicroSoccerLoopConfig, getLiveMicroWindowMinutes } from "@/lib/liveMicro/config";
import {
  createBinaryMarketOnchain,
  getOperatorPublicKeyBase58,
  proposeResolutionOnchain,
} from "@/lib/liveMicro/operator";
import { fetchSoccerSnapshot, type SoccerScoreSnapshot } from "@/lib/liveMicro/provider";
import {
  LIVE_MICRO_TYPE,
  activateLiveMicroMatchLoop as activateLiveMicroMatchLoopRow,
  countRunnableLiveMicroMatchLoops,
  createLiveMicroRow,
  findActiveLiveMicroByMatch,
  findRecentLiveMicroForLoopStep,
  findLiveMicroMatchLoopByMatch,
  findSportEventIdByProviderMatchId,
  getLiveMicroById,
  listActiveLiveMicros,
  listRunnableLiveMicroMatchLoops,
  markGoalObservedAndLockTrading,
  markLiveMicroError,
  markLiveMicroResolved,
  persistResolutionProposalToMarkets,
  tryTouchLiveMicroMatchLoop,
  updateLiveMicroMatchLoop,
  updateLiveMicroSnapshot,
  upsertLinkedMarketRow,
  type LiveMicroMatchLoopRow,
  type LiveMicroRow,
  type ResolutionOutcome,
} from "@/lib/liveMicro/repository";

export type StartLiveMicroInput = {
  providerMatchId: string;
  providerName: string;
  windowMinutes: number;
  loopContext?: {
    loopId: string;
    loopPhase: "first_half" | "second_half";
    loopSequence: number;
  };
};

export type StartLiveMicroResult = {
  liveMicroId: string;
  marketAddress: string;
  marketId: string | null;
  createTxSig: string;
  windowStart: string;
  windowEnd: string;
  startHomeScore: number;
  startAwayScore: number;
};

export type ActivateLiveMicroMatchLoopInput = {
  providerMatchId: string;
  providerName: string;
  activatedBy?: string | null;
  windowMinutes?: number;
};

export type ActivateLiveMicroMatchLoopResult = {
  loop: LiveMicroMatchLoopRow;
  firstMarketCreated: boolean;
  firstMarket: StartLiveMicroResult | null;
  reason: string;
};

const LOOP_STEP_CREATE_LOCKS_KEY = "__FUNMARKET_LIVE_MICRO_LOOP_STEP_CREATE_LOCKS__";
const LOOP_STEP_EXISTS_ERROR_PREFIX = "Loop step micro-market already exists";

function getLoopStepLockSet(): Set<string> {
  const host = (typeof process !== "undefined" ? process : globalThis) as Record<string, unknown>;
  const existing = host[LOOP_STEP_CREATE_LOCKS_KEY] as Set<string> | undefined;
  if (existing) return existing;
  const created = new Set<string>();
  host[LOOP_STEP_CREATE_LOCKS_KEY] = created;
  return created;
}

function makeLoopStepKey(loopId: string, loopPhase: "first_half" | "second_half", loopSequence: number): string {
  return `${loopId}:${loopPhase}:${Math.max(1, Math.floor(loopSequence))}`;
}

async function withLoopStepCreateLock<T>(
  loopId: string,
  loopPhase: "first_half" | "second_half",
  loopSequence: number,
  work: () => Promise<T>,
): Promise<T | null> {
  const key = makeLoopStepKey(loopId, loopPhase, loopSequence);
  const locks = getLoopStepLockSet();
  if (locks.has(key)) return null;
  locks.add(key);
  try {
    return await work();
  } finally {
    locks.delete(key);
  }
}

function isLoopStepExistsError(message: string): boolean {
  return message.includes(LOOP_STEP_EXISTS_ERROR_PREFIX);
}

function sanitizeWindowMinutes(x: number): number {
  if (!Number.isFinite(x)) return 5;
  return Math.max(1, Math.min(15, Math.floor(x)));
}

function normalizeProviderName(input: string): string {
  const p = String(input || "").trim().toLowerCase();
  if (!p) return "api-football";
  if (p === "api_football" || p === "api-football" || p === "api_sports" || p === "api-sports") {
    return "api-football";
  }
  if (p === "the-sports-db") return "thesportsdb";
  return p;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readNestedNumber(input: unknown, path: string[]): number | null {
  let cur: unknown = input;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  const n = Number(cur);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function readNestedString(input: unknown, path: string[]): string | null {
  let cur: unknown = input;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  const s = String(cur || "").trim();
  return s || null;
}

function normalizeIso(input: string | null): string | null {
  if (!input) return null;
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function extractElapsedMinute(snapshot: SoccerScoreSnapshot): number | null {
  const payload = asObject(snapshot.payload);
  const candidates = [
    readNestedNumber(payload, ["event", "score", "minute"]),
    readNestedNumber(payload, ["event", "raw", "full", "fixture", "status", "elapsed"]),
    readNestedNumber(payload, ["fixture", "fixture", "status", "elapsed"]),
    readNestedNumber(payload, ["override", "minute"]),
  ];

  for (const c of candidates) {
    if (typeof c === "number" && c >= 0) return c;
  }
  return null;
}

function extractScheduledStartIso(snapshot: SoccerScoreSnapshot): string | null {
  const payload = asObject(snapshot.payload);
  const candidates = [
    readNestedString(payload, ["live", "start_time"]),
    readNestedString(payload, ["live", "startTime"]),
    readNestedString(payload, ["event", "start_time"]),
    readNestedString(payload, ["event", "raw", "full", "fixture", "date"]),
    readNestedString(payload, ["fixture", "fixture", "date"]),
  ];

  for (const c of candidates) {
    const iso = normalizeIso(c);
    if (iso) return iso;
  }
  return null;
}

function makeQuestion(snapshot: SoccerScoreSnapshot, windowMinutes: number): string {
  const matchup = snapshot.homeTeam && snapshot.awayTeam
    ? `${snapshot.homeTeam} vs ${snapshot.awayTeam}`
    : `Match ${snapshot.providerMatchId}`;
  return `Next Goal in ${windowMinutes} Minutes? ${matchup}`;
}

function makeDescription(
  snapshot: SoccerScoreSnapshot,
  windowStartIso: string,
  windowEndIso: string,
  loopContext?: StartLiveMicroInput["loopContext"],
): string {
  const rows = [
    "DEVNET live micro-market generated by operator.",
    `Type: ${LIVE_MICRO_TYPE}`,
    `Provider: ${snapshot.providerName}`,
    `Provider Match ID: ${snapshot.providerMatchId}`,
    `Window Start: ${windowStartIso}`,
    `Window End: ${windowEndIso}`,
    `Start Score: ${snapshot.homeScore}-${snapshot.awayScore}`,
  ];

  if (loopContext) {
    rows.push(`Loop Controller ID: ${loopContext.loopId}`);
    rows.push(`Loop Phase: ${loopContext.loopPhase}`);
    rows.push(`Loop Sequence: ${loopContext.loopSequence}`);
  }

  return rows.join("\n");
}

export async function startLiveMicroMarket(input: StartLiveMicroInput): Promise<StartLiveMicroResult> {
  const providerMatchId = String(input.providerMatchId || "").trim();
  const providerName = normalizeProviderName(input.providerName || "api-football");
  const windowMinutes = sanitizeWindowMinutes(input.windowMinutes);

  if (!providerMatchId) throw new Error("provider_match_id is required");

  const active = await findActiveLiveMicroByMatch({ providerMatchId, providerName });
  if (active) {
    throw new Error(`Active micro-market already exists for provider_match_id=${providerMatchId}`);
  }

  if (input.loopContext) {
    const existingStep = await findRecentLiveMicroForLoopStep({
      providerMatchId,
      providerName,
      loopId: input.loopContext.loopId,
      loopPhase: input.loopContext.loopPhase,
      loopSequence: input.loopContext.loopSequence,
    });
    if (existingStep) {
      throw new Error(
        `${LOOP_STEP_EXISTS_ERROR_PREFIX} (loop_id=${input.loopContext.loopId}, phase=${input.loopContext.loopPhase}, sequence=${input.loopContext.loopSequence})`,
      );
    }
  }

  const snapshot = await fetchSoccerSnapshot({ providerName, providerMatchId });

  if (snapshot.status !== "live") {
    throw new Error(`Match is not live (status=${snapshot.status})`);
  }

  const windowStartIso = nowIso();
  const windowEndIso = new Date(Date.now() + windowMinutes * 60_000).toISOString();
  const resolutionTimeSec = Math.floor(new Date(windowEndIso).getTime() / 1000);

  const createResult = await createBinaryMarketOnchain({
    resolutionTimeSec,
    outcomes: ["YES", "NO"],
  });

  const operatorWallet = getOperatorPublicKeyBase58();
  if (!operatorWallet) {
    throw new Error("Operator wallet unavailable");
  }

  const sportEventId = await findSportEventIdByProviderMatchId(providerMatchId);

  const marketRow = await upsertLinkedMarketRow({
    marketAddress: createResult.marketAddress,
    creator: operatorWallet,
    question: makeQuestion(snapshot, windowMinutes),
    description: makeDescription(snapshot, windowStartIso, windowEndIso, input.loopContext),
    endDateIso: windowEndIso,
    sportEventId,
    sportMeta: {
      sport: "soccer",
      micro_market_type: LIVE_MICRO_TYPE,
      provider: snapshot.providerName,
      provider_match_id: snapshot.providerMatchId,
      window_start: windowStartIso,
      window_end: windowEndIso,
      start_score: {
        home: snapshot.homeScore,
        away: snapshot.awayScore,
      },
      loop: input.loopContext
        ? {
          id: input.loopContext.loopId,
          phase: input.loopContext.loopPhase,
          sequence: input.loopContext.loopSequence,
        }
        : null,
      devnet_only: true,
    },
  });

  const row = await createLiveMicroRow({
    providerMatchId: snapshot.providerMatchId,
    providerName: snapshot.providerName,
    linkedMarketId: marketRow.id,
    linkedMarketAddress: marketRow.marketAddress,
    windowStartIso,
    windowEndIso,
    startHomeScore: snapshot.homeScore,
    startAwayScore: snapshot.awayScore,
    createdByOperatorWallet: operatorWallet,
    payloadStart: input.loopContext
      ? {
        ...snapshot.payload,
        loop_context: input.loopContext,
      }
      : snapshot.payload,
  });

  return {
    liveMicroId: row.id,
    marketAddress: marketRow.marketAddress,
    marketId: marketRow.id,
    createTxSig: createResult.txSig,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    startHomeScore: row.start_home_score,
    startAwayScore: row.start_away_score,
  };
}

function totalGoals(home: number, away: number): number {
  return Math.max(0, home) + Math.max(0, away);
}

function detectGoalIncreaseFromStart(row: LiveMicroRow, snapshot: SoccerScoreSnapshot): boolean {
  const startTotal = totalGoals(row.start_home_score, row.start_away_score);
  const currentTotal = totalGoals(snapshot.homeScore, snapshot.awayScore);
  return currentTotal > startTotal;
}

function hasPendingYes(row: LiveMicroRow): boolean {
  return row.pending_outcome === "YES" || row.goal_observed === true;
}

function hasWindowEnded(row: LiveMicroRow, nowMs: number): boolean {
  return nowMs >= new Date(row.window_end).getTime();
}

async function proposeAndPersist(row: LiveMicroRow, outcome: ResolutionOutcome, snapshot: SoccerScoreSnapshot) {
  if (!row.linked_market_address) {
    throw new Error("Missing linked_market_address on live micro row");
  }
  if (!hasWindowEnded(row, Date.now())) {
    throw new Error(`Refusing proposal before window_end (${row.window_end})`);
  }

  const outcomeIndex: 0 | 1 = outcome === "YES" ? 0 : 1;
  const proposal = await proposeResolutionOnchain({
    marketAddress: row.linked_market_address,
    outcomeIndex,
  });

  const proofNote = JSON.stringify({
    source: "live_micro_market_devnet",
    live_micro_market_id: row.id,
    micro_market_type: row.micro_market_type,
    provider_name: row.provider_name,
    provider_match_id: row.provider_match_id,
    window_start: row.window_start,
    window_end: row.window_end,
    start_score: {
      home: row.start_home_score,
      away: row.start_away_score,
    },
    end_score: {
      home: snapshot.homeScore,
      away: snapshot.awayScore,
    },
    outcome,
    onchain_tx_sig: proposal.txSig,
  });

  await persistResolutionProposalToMarkets({
    marketAddress: row.linked_market_address,
    proposedWinningOutcome: proposal.proposedOutcome,
    contestDeadlineIso: proposal.contestDeadlineIso,
    proposedProofNote: proofNote,
  });

  await markLiveMicroResolved({
    id: row.id,
    outcome,
    homeScore: snapshot.homeScore,
    awayScore: snapshot.awayScore,
    payloadEnd: snapshot.payload,
  });

  return {
    outcome,
    proposal,
  };
}

async function processSnapshotForRow(
  row: LiveMicroRow,
  snapshot: SoccerScoreSnapshot,
  source: "provider" | "override",
): Promise<Record<string, unknown>> {
  await updateLiveMicroSnapshot({
    id: row.id,
    homeScore: snapshot.homeScore,
    awayScore: snapshot.awayScore,
    payloadEnd: snapshot.payload,
  });

  const nowMs = Date.now();
  const windowEnded = hasWindowEnded(row, nowMs);
  const goalIncreasedFromStart = detectGoalIncreaseFromStart(row, snapshot);
  const goalPreviouslyObserved = hasPendingYes(row);
  const messageSuffix = source === "override" ? " (override snapshot)" : "";

  if (!windowEnded) {
    if (goalIncreasedFromStart && !goalPreviouslyObserved) {
      await markGoalObservedAndLockTrading({
        id: row.id,
        linkedMarketAddress: row.linked_market_address,
      });

      return {
        id: row.id,
        provider_match_id: row.provider_match_id,
        market_address: row.linked_market_address,
        status: "trading_locked",
        score: `${snapshot.homeScore}-${snapshot.awayScore}`,
        provider_status: snapshot.status,
        pending_outcome: "YES",
        message: `Goal observed during active window; trading locked until ${row.window_end}${messageSuffix}`,
      };
    }

    if (goalPreviouslyObserved) {
      if (!row.trading_locked_at) {
        await markGoalObservedAndLockTrading({
          id: row.id,
          linkedMarketAddress: row.linked_market_address,
          goalObservedAtIso: row.goal_observed_at,
          tradingLockedAtIso: row.trading_locked_at,
        });
      }

      return {
        id: row.id,
        provider_match_id: row.provider_match_id,
        market_address: row.linked_market_address,
        status: "trading_locked",
        score: `${snapshot.homeScore}-${snapshot.awayScore}`,
        provider_status: snapshot.status,
        pending_outcome: "YES",
        message: `Trading remains locked until window end (${row.window_end})${messageSuffix}`,
      };
    }

    return {
      id: row.id,
      provider_match_id: row.provider_match_id,
      market_address: row.linked_market_address,
      status: "active",
      score: `${snapshot.homeScore}-${snapshot.awayScore}`,
      provider_status: snapshot.status,
      pending_outcome: row.pending_outcome,
      message: `Window active; no goal observed yet${messageSuffix}`,
    };
  }

  const outcome: ResolutionOutcome = hasPendingYes(row) ? "YES" : "NO";
  const proposed = await proposeAndPersist(row, outcome, snapshot);

  return {
    id: row.id,
    provider_match_id: row.provider_match_id,
    market_address: row.linked_market_address,
    status: "proposed",
    outcome: proposed.outcome,
    tx_sig: proposed.proposal.txSig,
    contest_deadline: proposed.proposal.contestDeadlineIso,
  };
}

async function processOneRow(row: LiveMicroRow): Promise<Record<string, unknown>> {
  const snapshot = await fetchSoccerSnapshot({
    providerName: row.provider_name,
    providerMatchId: row.provider_match_id,
  });

  return processSnapshotForRow(row, snapshot, "provider");
}

function getHardStopReason(params: {
  snapshot: SoccerScoreSnapshot;
  elapsedMinute: number | null;
  scheduledStartIso: string | null;
}): string | null {
  const cfg = getLiveMicroSoccerLoopConfig();
  if (params.snapshot.status === "finished") return "provider_finished";
  if (typeof params.elapsedMinute === "number" && params.elapsedMinute >= cfg.hardStopMinute) {
    return "hard_stop_minute_reached";
  }

  if (params.scheduledStartIso) {
    const startMs = Date.parse(params.scheduledStartIso);
    if (Number.isFinite(startMs) && Date.now() >= startMs + cfg.hardStopMaxMatchMinutes * 60_000) {
      return "hard_stop_max_match_minutes_reached";
    }
  }

  return null;
}

async function endLoopWithReason(
  loop: LiveMicroMatchLoopRow,
  reason: string,
  payload: Record<string, unknown> | null,
  scheduledStartIso: string | null,
): Promise<LiveMicroMatchLoopRow> {
  return updateLiveMicroMatchLoop({
    id: loop.id,
    loopStatus: "ended",
    loopPhase: "ended",
    stopReason: reason,
    currentActiveLiveMicroId: null,
    lastSnapshotPayload: payload,
    scheduledStartTimeIso: scheduledStartIso,
    errorMessage: null,
  });
}

async function syncLoopForExistingStepMarket(params: {
  loop: LiveMicroMatchLoopRow;
  phase: "first_half" | "second_half";
  sequence: number;
  existing: LiveMicroRow;
  payload: Record<string, unknown> | null;
  scheduledStartIso: string | null;
}): Promise<LiveMicroMatchLoopRow> {
  const firstHalfCount = params.phase === "first_half"
    ? Math.max(params.loop.first_half_count, params.sequence)
    : params.loop.first_half_count;
  const secondHalfCount = params.phase === "second_half"
    ? Math.max(params.loop.second_half_count, params.sequence)
    : params.loop.second_half_count;
  const currentActiveLiveMicroId = params.existing.engine_status === "active" ? params.existing.id : null;

  return updateLiveMicroMatchLoop({
    id: params.loop.id,
    loopStatus: params.loop.loop_status === "halftime" ? "halftime" : "active",
    loopPhase: params.phase,
    firstHalfCount,
    secondHalfCount,
    currentActiveLiveMicroId,
    lastSnapshotPayload: params.payload,
    scheduledStartTimeIso: params.scheduledStartIso,
    stopReason: null,
    errorMessage: null,
  });
}

type EnsureLoopStepMarketResult =
  | { status: "created"; created: StartLiveMicroResult; loop: LiveMicroMatchLoopRow }
  | { status: "existing"; existing: LiveMicroRow; loop: LiveMicroMatchLoopRow }
  | { status: "stale_loop" }
  | { status: "in_progress" };

async function ensureLoopStepMarket(params: {
  loop: LiveMicroMatchLoopRow;
  phase: "first_half" | "second_half";
  sequence: number;
  windowMinutes: number;
  payload: Record<string, unknown> | null;
  scheduledStartIso: string | null;
}): Promise<EnsureLoopStepMarketResult> {
  const locked = await withLoopStepCreateLock(
    params.loop.id,
    params.phase,
    params.sequence,
    async (): Promise<EnsureLoopStepMarketResult> => {
      const existingBefore = await findRecentLiveMicroForLoopStep({
        providerMatchId: params.loop.provider_match_id,
        providerName: params.loop.provider_name,
        loopId: params.loop.id,
        loopPhase: params.phase,
        loopSequence: params.sequence,
      });
      if (existingBefore) {
        console.log("[live-micro:loop] create skipped (dedupe hit)", {
          loopId: params.loop.id,
          providerMatchId: params.loop.provider_match_id,
          phase: params.phase,
          sequence: params.sequence,
          existingLiveMicroId: existingBefore.id,
          existingStatus: existingBefore.engine_status,
        });
        const syncedLoop = await syncLoopForExistingStepMarket({
          loop: params.loop,
          phase: params.phase,
          sequence: params.sequence,
          existing: existingBefore,
          payload: params.payload,
          scheduledStartIso: params.scheduledStartIso,
        });
        return {
          status: "existing",
          existing: existingBefore,
          loop: syncedLoop,
        };
      }

      const touchedLoop = await tryTouchLiveMicroMatchLoop({
        id: params.loop.id,
        expectedUpdatedAt: params.loop.updated_at,
      });
      if (!touchedLoop) {
        console.log("[live-micro:loop] create skipped (stale loop touch)", {
          loopId: params.loop.id,
          providerMatchId: params.loop.provider_match_id,
          phase: params.phase,
          sequence: params.sequence,
        });
        return { status: "stale_loop" };
      }

      const existingAfterTouch = await findRecentLiveMicroForLoopStep({
        providerMatchId: params.loop.provider_match_id,
        providerName: params.loop.provider_name,
        loopId: params.loop.id,
        loopPhase: params.phase,
        loopSequence: params.sequence,
      });
      if (existingAfterTouch) {
        console.log("[live-micro:loop] create skipped (dedupe after touch)", {
          loopId: params.loop.id,
          providerMatchId: params.loop.provider_match_id,
          phase: params.phase,
          sequence: params.sequence,
          existingLiveMicroId: existingAfterTouch.id,
          existingStatus: existingAfterTouch.engine_status,
        });
        const syncedLoop = await syncLoopForExistingStepMarket({
          loop: touchedLoop,
          phase: params.phase,
          sequence: params.sequence,
          existing: existingAfterTouch,
          payload: params.payload,
          scheduledStartIso: params.scheduledStartIso,
        });
        return {
          status: "existing",
          existing: existingAfterTouch,
          loop: syncedLoop,
        };
      }

      try {
        const created = await startLiveMicroMarket({
          providerMatchId: params.loop.provider_match_id,
          providerName: params.loop.provider_name,
          windowMinutes: params.windowMinutes,
          loopContext: {
            loopId: params.loop.id,
            loopPhase: params.phase,
            loopSequence: params.sequence,
          },
        });

        const firstHalfCount = params.phase === "first_half"
          ? Math.max(touchedLoop.first_half_count, params.sequence)
          : touchedLoop.first_half_count;
        const secondHalfCount = params.phase === "second_half"
          ? Math.max(touchedLoop.second_half_count, params.sequence)
          : touchedLoop.second_half_count;

        const updatedLoop = await updateLiveMicroMatchLoop({
          id: touchedLoop.id,
          loopStatus: "active",
          loopPhase: params.phase,
          firstHalfCount,
          secondHalfCount,
          currentActiveLiveMicroId: created.liveMicroId,
          lastSnapshotPayload: params.payload,
          scheduledStartTimeIso: params.scheduledStartIso,
          stopReason: null,
          errorMessage: null,
        });

        return {
          status: "created",
          created,
          loop: updatedLoop,
        };
      } catch (e: any) {
        const message = String(e?.message || e || "Unknown error");
        if (message.includes("Active micro-market already exists") || isLoopStepExistsError(message)) {
          const dedupedExisting = await findRecentLiveMicroForLoopStep({
            providerMatchId: params.loop.provider_match_id,
            providerName: params.loop.provider_name,
            loopId: params.loop.id,
            loopPhase: params.phase,
            loopSequence: params.sequence,
          }) || await findActiveLiveMicroByMatch({
            providerMatchId: params.loop.provider_match_id,
            providerName: params.loop.provider_name,
          });

          if (!dedupedExisting) return { status: "stale_loop" };

          console.log("[live-micro:loop] create deduped after race", {
            loopId: params.loop.id,
            providerMatchId: params.loop.provider_match_id,
            phase: params.phase,
            sequence: params.sequence,
            existingLiveMicroId: dedupedExisting.id,
            existingStatus: dedupedExisting.engine_status,
          });

          const syncedLoop = await syncLoopForExistingStepMarket({
            loop: touchedLoop,
            phase: params.phase,
            sequence: params.sequence,
            existing: dedupedExisting,
            payload: params.payload,
            scheduledStartIso: params.scheduledStartIso,
          });

          return {
            status: "existing",
            existing: dedupedExisting,
            loop: syncedLoop,
          };
        }

        throw e;
      }
    },
  );

  if (!locked) {
    console.log("[live-micro:loop] create skipped (in-process lock busy)", {
      loopId: params.loop.id,
      providerMatchId: params.loop.provider_match_id,
      phase: params.phase,
      sequence: params.sequence,
    });
    return { status: "in_progress" };
  }
  return locked;
}

export async function activateLiveMicroMatchLoop(
  input: ActivateLiveMicroMatchLoopInput,
): Promise<ActivateLiveMicroMatchLoopResult> {
  const providerMatchId = String(input.providerMatchId || "").trim();
  const providerName = normalizeProviderName(input.providerName || "api-football");
  const windowMinutes = sanitizeWindowMinutes(input.windowMinutes ?? getLiveMicroWindowMinutes());

  if (!providerMatchId) throw new Error("provider_match_id is required");

  const existingLoop = await findLiveMicroMatchLoopByMatch({ providerMatchId, providerName });
  const isExistingRunnable = !!existingLoop && (existingLoop.loop_status === "active" || existingLoop.loop_status === "halftime");

  if (!isExistingRunnable) {
    const cfg = getLiveMicroSoccerLoopConfig();
    const activeLoopCount = await countRunnableLiveMicroMatchLoops();
    if (activeLoopCount >= cfg.maxActiveMatchLoops) {
      throw new Error(`Max active match loops reached (${cfg.maxActiveMatchLoops})`);
    }
  }

  const snapshot = await fetchSoccerSnapshot({ providerName, providerMatchId });
  const scheduledStartIso = extractScheduledStartIso(snapshot);
  const scheduledStartIsoResolved = scheduledStartIso || existingLoop?.scheduled_start_time || null;

  let loop = await activateLiveMicroMatchLoopRow({
    providerMatchId,
    providerName,
    activatedBy: input.activatedBy || null,
    scheduledStartTimeIso: scheduledStartIsoResolved,
    lastSnapshotPayload: snapshot.payload,
  });

  const elapsedMinute = extractElapsedMinute(snapshot);
  const hardStopReason = getHardStopReason({
    snapshot,
    elapsedMinute,
    scheduledStartIso: scheduledStartIsoResolved || loop.scheduled_start_time,
  });

  if (hardStopReason) {
    loop = await endLoopWithReason(
      loop,
      hardStopReason,
      snapshot.payload,
      scheduledStartIsoResolved || loop.scheduled_start_time,
    );
    return {
      loop,
      firstMarketCreated: false,
      firstMarket: null,
      reason: hardStopReason,
    };
  }

  const active = await findActiveLiveMicroByMatch({ providerMatchId, providerName });
  if (active) {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "active",
      loopPhase: "first_half",
      currentActiveLiveMicroId: active.id,
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIsoResolved || loop.scheduled_start_time,
      stopReason: null,
      errorMessage: null,
    });

    return {
      loop,
      firstMarketCreated: false,
      firstMarket: null,
      reason: "active_micro_already_exists",
    };
  }

  if (snapshot.status !== "live") {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "active",
      loopPhase: "first_half",
      currentActiveLiveMicroId: null,
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIsoResolved || loop.scheduled_start_time,
      stopReason: null,
      errorMessage: null,
    });

    return {
      loop,
      firstMarketCreated: false,
      firstMarket: null,
      reason: `match_not_live:${snapshot.status}`,
    };
  }

  try {
    const ensured = await ensureLoopStepMarket({
      loop,
      phase: "first_half",
      sequence: 1,
      windowMinutes,
      payload: snapshot.payload,
      scheduledStartIso: scheduledStartIsoResolved || loop.scheduled_start_time,
    });

    if (ensured.status === "created") {
      loop = ensured.loop;
      return {
        loop,
        firstMarketCreated: true,
        firstMarket: ensured.created,
        reason: "first_market_created",
      };
    }

    if (ensured.status === "existing") {
      loop = ensured.loop;
      return {
        loop,
        firstMarketCreated: false,
        firstMarket: null,
        reason: ensured.existing.engine_status === "active"
          ? "active_micro_already_exists"
          : "first_market_already_created",
      };
    }

    return {
      loop,
      firstMarketCreated: false,
      firstMarket: null,
      reason: ensured.status === "in_progress"
        ? "first_market_creation_in_progress"
        : "first_market_creation_race_skipped",
    };
  } catch (e: any) {
    const message = String(e?.message || e || "Unknown error");
    if (message.includes("Active micro-market already exists") || isLoopStepExistsError(message)) {
      return {
        loop,
        firstMarketCreated: false,
        firstMarket: null,
        reason: "active_micro_already_exists",
      };
    }

    await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "error",
      errorMessage: message,
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIsoResolved || loop.scheduled_start_time,
    });

    throw e;
  }
}

async function processSingleLoop(params: {
  loop: LiveMicroMatchLoopRow;
  windowMinutes: number;
}): Promise<Record<string, unknown>> {
  const cfg = getLiveMicroSoccerLoopConfig();
  let loop = params.loop;

  if (loop.loop_phase === "ended" || loop.loop_status === "ended") {
    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "ended",
      stop_reason: loop.stop_reason,
    };
  }

  const active = await findActiveLiveMicroByMatch({
    providerMatchId: loop.provider_match_id,
    providerName: loop.provider_name,
  });

  if (active) {
    if (loop.current_active_live_micro_id !== active.id || loop.loop_status !== "active") {
      loop = await updateLiveMicroMatchLoop({
        id: loop.id,
        loopStatus: "active",
        currentActiveLiveMicroId: active.id,
        stopReason: null,
        errorMessage: null,
      });
    }

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "active_market_running",
      live_micro_id: active.id,
      phase: loop.loop_phase,
      first_half_count: loop.first_half_count,
      second_half_count: loop.second_half_count,
    };
  }

  if (loop.current_active_live_micro_id) {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      currentActiveLiveMicroId: null,
    });
  }

  const snapshot = await fetchSoccerSnapshot({
    providerName: loop.provider_name,
    providerMatchId: loop.provider_match_id,
  });

  const elapsedMinute = extractElapsedMinute(snapshot);
  const scheduledStartIso = extractScheduledStartIso(snapshot) || loop.scheduled_start_time;

  const hardStopReason = getHardStopReason({
    snapshot,
    elapsedMinute,
    scheduledStartIso,
  });

  if (hardStopReason) {
    loop = await endLoopWithReason(loop, hardStopReason, snapshot.payload, scheduledStartIso);
    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "ended",
      stop_reason: hardStopReason,
      elapsed_minute: elapsedMinute,
    };
  }

  if (loop.loop_phase === "first_half" && loop.first_half_count >= cfg.firstHalfMaxMarkets) {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "halftime",
      loopPhase: "halftime",
      halftimeStartedAtIso: nowIso(),
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIso,
      stopReason: null,
      errorMessage: null,
    });

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "halftime_started",
      halftime_started_at: loop.halftime_started_at,
      first_half_count: loop.first_half_count,
      second_half_count: loop.second_half_count,
    };
  }

  if (loop.loop_phase === "halftime") {
    let halftimeStartIso = loop.halftime_started_at;
    let halftimeStartMs = halftimeStartIso ? Date.parse(halftimeStartIso) : NaN;
    if (!Number.isFinite(halftimeStartMs)) {
      halftimeStartIso = nowIso();
      halftimeStartMs = Date.parse(halftimeStartIso);
      loop = await updateLiveMicroMatchLoop({
        id: loop.id,
        halftimeStartedAtIso: halftimeStartIso,
        lastSnapshotPayload: snapshot.payload,
        scheduledStartTimeIso: scheduledStartIso,
      });
    }

    const resumeAtMs = halftimeStartMs + cfg.halftimePauseMinutes * 60_000;
    if (Date.now() < resumeAtMs) {
      return {
        loop_id: loop.id,
        provider_match_id: loop.provider_match_id,
        status: "halftime_wait",
        phase: loop.loop_phase,
        halftime_started_at: halftimeStartIso,
        halftime_resume_at: new Date(resumeAtMs).toISOString(),
      };
    }

    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "active",
      loopPhase: "second_half",
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIso,
      stopReason: null,
      errorMessage: null,
    });
  }

  if (loop.loop_phase === "second_half" && loop.second_half_count >= cfg.secondHalfMaxMarkets) {
    loop = await endLoopWithReason(loop, "second_half_slots_exhausted", snapshot.payload, scheduledStartIso);
    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "ended",
      stop_reason: "second_half_slots_exhausted",
    };
  }

  if (snapshot.status !== "live") {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIso,
      errorMessage: null,
    });

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "waiting_match_live",
      provider_status: snapshot.status,
      phase: loop.loop_phase,
    };
  }

  const phase = loop.loop_phase;
  if (phase !== "first_half" && phase !== "second_half") {
    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "phase_not_eligible",
      phase,
    };
  }

  const nextSequence = phase === "first_half" ? loop.first_half_count + 1 : loop.second_half_count + 1;
  if (phase === "first_half" && nextSequence > cfg.firstHalfMaxMarkets) {
    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "halftime",
      loopPhase: "halftime",
      halftimeStartedAtIso: nowIso(),
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIso,
      stopReason: null,
      errorMessage: null,
    });

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "halftime_started",
      first_half_count: loop.first_half_count,
    };
  }

  if (phase === "second_half" && nextSequence > cfg.secondHalfMaxMarkets) {
    loop = await endLoopWithReason(loop, "second_half_slots_exhausted", snapshot.payload, scheduledStartIso);
    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "ended",
      stop_reason: "second_half_slots_exhausted",
    };
  }

  try {
    const ensured = await ensureLoopStepMarket({
      loop,
      phase,
      sequence: nextSequence,
      windowMinutes: params.windowMinutes,
      payload: snapshot.payload,
      scheduledStartIso,
    });

    if (ensured.status === "created") {
      loop = ensured.loop;
      return {
        loop_id: loop.id,
        provider_match_id: loop.provider_match_id,
        status: "market_created",
        phase: loop.loop_phase,
        live_micro_id: ensured.created.liveMicroId,
        market_address: ensured.created.marketAddress,
        first_half_count: loop.first_half_count,
        second_half_count: loop.second_half_count,
      };
    }

    if (ensured.status === "existing") {
      loop = ensured.loop;
      return {
        loop_id: loop.id,
        provider_match_id: loop.provider_match_id,
        status: "market_creation_deduped",
        phase: loop.loop_phase,
        live_micro_id: ensured.existing.id,
        existing_status: ensured.existing.engine_status,
        first_half_count: loop.first_half_count,
        second_half_count: loop.second_half_count,
      };
    }

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: ensured.status === "in_progress" ? "market_creation_in_progress" : "market_creation_stale_loop_skip",
      phase,
      first_half_count: loop.first_half_count,
      second_half_count: loop.second_half_count,
    };
  } catch (e: any) {
    const message = String(e?.message || e || "Unknown error");
    if (message.includes("Active micro-market already exists") || isLoopStepExistsError(message)) {
      return {
        loop_id: loop.id,
        provider_match_id: loop.provider_match_id,
        status: "active_market_exists_race",
      };
    }

    loop = await updateLiveMicroMatchLoop({
      id: loop.id,
      loopStatus: "error",
      errorMessage: message,
      lastSnapshotPayload: snapshot.payload,
      scheduledStartTimeIso: scheduledStartIso,
    });

    return {
      loop_id: loop.id,
      provider_match_id: loop.provider_match_id,
      status: "error",
      error: message,
    };
  }
}

async function processActivatedLoops(input: {
  providerMatchId?: string;
  limit: number;
  windowMinutes: number;
}): Promise<{ processed: number; results: Array<Record<string, unknown>> }> {
  const loops = await listRunnableLiveMicroMatchLoops(input.limit);
  const candidates = input.providerMatchId
    ? loops.filter((x) => x.provider_match_id === input.providerMatchId)
    : loops;
  const orderedCandidates = [...candidates].sort((a, b) => {
    const statusWeightA = a.loop_status === "active" ? 0 : 1;
    const statusWeightB = b.loop_status === "active" ? 0 : 1;
    if (statusWeightA !== statusWeightB) return statusWeightA - statusWeightB;

    const hasCurrentA = a.current_active_live_micro_id ? 0 : 1;
    const hasCurrentB = b.current_active_live_micro_id ? 0 : 1;
    if (hasCurrentA !== hasCurrentB) return hasCurrentA - hasCurrentB;

    const updatedMsA = Date.parse(a.updated_at);
    const updatedMsB = Date.parse(b.updated_at);
    const normalizedA = Number.isFinite(updatedMsA) ? updatedMsA : 0;
    const normalizedB = Number.isFinite(updatedMsB) ? updatedMsB : 0;
    return normalizedB - normalizedA;
  });

  const results: Array<Record<string, unknown>> = [];

  for (const loop of orderedCandidates) {
    try {
      results.push(await processSingleLoop({ loop, windowMinutes: input.windowMinutes }));
    } catch (e: any) {
      const message = String(e?.message || e || "Unknown error");
      try {
        await updateLiveMicroMatchLoop({
          id: loop.id,
          loopStatus: "error",
          errorMessage: message,
        });
      } catch {
        // no-op
      }

      results.push({
        loop_id: loop.id,
        provider_match_id: loop.provider_match_id,
        status: "error",
        error: message,
      });
    }
  }

  return {
    processed: orderedCandidates.length,
    results,
  };
}

export type TickLiveMicroResult = {
  processed: number;
  results: Array<Record<string, unknown>>;
  loopProcessed: number;
  loopResults: Array<Record<string, unknown>>;
};

export type TickSnapshotOverride = {
  homeScore: number;
  awayScore: number;
  status?: "scheduled" | "live" | "finished" | "unknown";
};

export async function tickLiveMicroMarkets(input?: {
  id?: string;
  providerMatchId?: string;
  limit?: number;
  snapshotOverride?: TickSnapshotOverride;
}): Promise<TickLiveMicroResult> {
  const id = String(input?.id || "").trim();
  const providerMatchId = String(input?.providerMatchId || "").trim();
  const limit = Math.max(1, Math.min(100, Math.floor(input?.limit || 20)));
  const snapshotOverride = input?.snapshotOverride;

  const rows: LiveMicroRow[] = [];

  if (id) {
    const single = await getLiveMicroById(id);
    if (single && single.engine_status === "active") rows.push(single);
  } else {
    const active = await listActiveLiveMicros(limit);
    for (const row of active) {
      if (providerMatchId && row.provider_match_id !== providerMatchId) continue;
      rows.push(row);
    }
  }

  if (snapshotOverride && rows.length !== 1) {
    throw new Error("snapshot override requires exactly one targeted active micro-market (use id or provider_match_id)");
  }

  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    try {
      const res = await processOneRowWithOptionalOverride(row, snapshotOverride || null);
      results.push(res);
    } catch (e: any) {
      const message = String(e?.message || e || "Unknown error");
      try {
        await markLiveMicroError({
          id: row.id,
          errorState: "tick_failed",
          errorMessage: message,
        });
      } catch {
        // no-op
      }

      results.push({
        id: row.id,
        provider_match_id: row.provider_match_id,
        market_address: row.linked_market_address,
        status: "error",
        error: message,
      });
    }
  }

  let loopFilterProviderMatchId = providerMatchId;
  if (!loopFilterProviderMatchId && rows.length === 1) {
    loopFilterProviderMatchId = rows[0].provider_match_id;
  }

  let loopProcessed = 0;
  let loopResults: Array<Record<string, unknown>> = [];

  if (!snapshotOverride) {
    const loopTick = await processActivatedLoops({
      providerMatchId: loopFilterProviderMatchId || undefined,
      limit,
      windowMinutes: getLiveMicroWindowMinutes(),
    });
    loopProcessed = loopTick.processed;
    loopResults = loopTick.results;
  } else {
    loopResults = [{ status: "loop_processing_skipped_for_snapshot_override" }];
  }

  return {
    processed: rows.length,
    results,
    loopProcessed,
    loopResults,
  };
}

async function processOneRowWithOptionalOverride(
  row: LiveMicroRow,
  override: TickSnapshotOverride | null,
): Promise<Record<string, unknown>> {
  if (!override) return processOneRow(row);

  const snapshot: SoccerScoreSnapshot = {
    providerName: row.provider_name,
    providerMatchId: row.provider_match_id,
    status: override.status || "live",
    homeScore: Math.max(0, Math.floor(Number(override.homeScore) || 0)),
    awayScore: Math.max(0, Math.floor(Number(override.awayScore) || 0)),
    homeTeam: null,
    awayTeam: null,
    payload: {
      source: "tick_override",
      override,
    },
  };

  const res = await processSnapshotForRow(row, snapshot, "override");
  return {
    ...res,
    source: "tick_override",
  };
}
