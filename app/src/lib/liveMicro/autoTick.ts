import "server-only";

import {
  assertLiveMicroGuards,
  getLiveMicroAutoTickConfig,
  getLiveMicroFlags,
} from "@/lib/liveMicro/config";
import { tickLiveMicroMarkets } from "@/lib/liveMicro/engine";

type AutoTickState = {
  started: boolean;
  starting: boolean;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  intervalMs: number;
  startedAt: string | null;
  ownerPid: number | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  runCount: number;
  overlapSkips: number;
  startSkips: number;
  lastStartSkipReason: string | null;
  disabledReason: string | null;
};

const GLOBAL_STATE_KEY = Symbol.for("FUNMARKET_LIVE_MICRO_AUTO_TICK_STATE");

function nowIso(): string {
  return new Date().toISOString();
}

function getStateHost(): Record<PropertyKey, unknown> {
  if (typeof process !== "undefined") {
    return process as unknown as Record<PropertyKey, unknown>;
  }
  return globalThis as Record<PropertyKey, unknown>;
}

function hasUsableTimer(timer: ReturnType<typeof setInterval> | null): boolean {
  if (!timer) return false;
  if ((timer as any)?._destroyed) return false;
  return true;
}

function getState(): AutoTickState {
  const host = getStateHost();
  const existing = host[GLOBAL_STATE_KEY] as AutoTickState | undefined;
  if (existing) return existing;

  const created: AutoTickState = {
    started: false,
    starting: false,
    running: false,
    timer: null,
    intervalMs: 15_000,
    startedAt: null,
    ownerPid: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    runCount: 0,
    overlapSkips: 0,
    startSkips: 0,
    lastStartSkipReason: null,
    disabledReason: null,
  };
  host[GLOBAL_STATE_KEY] = created;
  return created;
}

function log(msg: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[live-micro:auto-tick] ${msg}`, payload);
    return;
  }
  console.log(`[live-micro:auto-tick] ${msg}`);
}

async function runTick(reason: "startup" | "interval") {
  const state = getState();
  const cfg = getLiveMicroAutoTickConfig();

  if (state.running) {
    state.overlapSkips += 1;
    if (cfg.verboseLogs && (state.overlapSkips === 1 || state.overlapSkips % 20 === 0)) {
      log("tick skipped (already running)", { overlapSkips: state.overlapSkips });
    }
    return;
  }

  state.running = true;
  state.lastRunAt = nowIso();
  try {
    const result = await tickLiveMicroMarkets({ limit: cfg.limit });
    state.lastSuccessAt = nowIso();
    state.lastError = null;
    state.runCount += 1;

    const shouldLog =
      cfg.verboseLogs ||
      reason === "startup" ||
      result.processed > 0 ||
      result.loopProcessed > 0;
    if (shouldLog) {
      log("tick completed", {
        reason,
        processed: result.processed,
        loopProcessed: result.loopProcessed,
      });
    }
  } catch (e: any) {
    const message = String(e?.message || e || "Unknown auto-tick error");
    state.lastError = message;
    log("tick failed", { reason, error: message });
  } finally {
    state.running = false;
  }
}

export function ensureLiveMicroAutoTickStarted(): void {
  const state = getState();
  const cfg = getLiveMicroAutoTickConfig();
  state.intervalMs = cfg.intervalMs;

  if (state.started && hasUsableTimer(state.timer)) {
    state.startSkips += 1;
    state.lastStartSkipReason = "already_started";
    if (cfg.verboseLogs && (state.startSkips === 1 || state.startSkips % 25 === 0)) {
      log("start skipped (already started)", {
        pid: state.ownerPid,
        intervalMs: state.intervalMs,
        startSkips: state.startSkips,
      });
    }
    return;
  }

  if (state.starting) {
    state.startSkips += 1;
    state.lastStartSkipReason = "startup_in_progress";
    if (cfg.verboseLogs && (state.startSkips === 1 || state.startSkips % 25 === 0)) {
      log("start skipped (startup already in progress)", {
        pid: state.ownerPid,
        startSkips: state.startSkips,
      });
    }
    return;
  }

  if (!hasUsableTimer(state.timer)) {
    state.timer = null;
    state.started = false;
  }

  if (!cfg.enabled) {
    state.disabledReason = cfg.disabledReason || "auto-tick disabled";
    return;
  }

  const flags = getLiveMicroFlags();
  if (!flags.enabled || !flags.operatorEnabled) {
    state.disabledReason = "live micro or operator disabled";
    if (cfg.verboseLogs) {
      log("not started (live micro/operator disabled)", {
        enabled: flags.enabled,
        operatorEnabled: flags.operatorEnabled,
      });
    }
    return;
  }

  try {
    state.starting = true;
    assertLiveMicroGuards({ requireOperator: true });
  } catch (e: any) {
    state.disabledReason = String(e?.message || e || "guard failure");
    if (cfg.verboseLogs) log("not started (guard failure)", { error: state.disabledReason });
    state.starting = false;
    return;
  }

  if (hasUsableTimer(state.timer)) {
    state.started = true;
    state.starting = false;
    state.disabledReason = null;
    return;
  }

  state.started = true;
  state.startedAt = nowIso();
  state.ownerPid = typeof process !== "undefined" ? process.pid : null;
  state.disabledReason = null;
  state.lastStartSkipReason = null;
  state.startSkips = 0;

  try {
    state.timer = setInterval(() => {
      void runTick("interval");
    }, cfg.intervalMs);
    (state.timer as any)?.unref?.();
    log("started", { intervalMs: cfg.intervalMs, limit: cfg.limit });
  } catch (e: any) {
    state.started = false;
    state.timer = null;
    state.lastError = String(e?.message || e || "Failed to start auto-tick interval");
    log("failed to start", { error: state.lastError });
    return;
  } finally {
    state.starting = false;
  }

  if (cfg.runOnStart) {
    void runTick("startup");
  }
}

export function getLiveMicroAutoTickStatus() {
  const state = getState();
  const cfg = getLiveMicroAutoTickConfig();
  const flags = getLiveMicroFlags();
  return {
    enabled: cfg.enabled,
    intervalMs: cfg.intervalMs,
    limit: cfg.limit,
    started: state.started,
    running: state.running,
    startedAt: state.startedAt,
    ownerPid: state.ownerPid,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    runCount: state.runCount,
    overlapSkips: state.overlapSkips,
    startSkips: state.startSkips,
    lastStartSkipReason: state.lastStartSkipReason,
    disabledReason: state.disabledReason,
    guards: {
      liveMicroEnabled: flags.enabled,
      operatorEnabled: flags.operatorEnabled,
      allowedCluster: flags.allowedCluster,
      currentCluster: flags.currentCluster,
      devOnly: flags.devOnly,
    },
  };
}
