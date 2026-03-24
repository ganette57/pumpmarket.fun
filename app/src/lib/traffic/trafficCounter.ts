type TrafficRoundCounter = {
  count: number;
  startedAt: number;
  endAtMs?: number;
  stopped: boolean;
  stopReason?: string | null;
  interval?: ReturnType<typeof setInterval>;
};

const TRAFFIC_COUNTER_STORE_KEY = "__FUNMARKET_TRAFFIC_COUNTER_STORE__";

function getCounterStore(): Map<string, TrafficRoundCounter> {
  const host = (typeof process !== "undefined" ? process : globalThis) as Record<string, unknown>;
  const existing = host[TRAFFIC_COUNTER_STORE_KEY] as Map<string, TrafficRoundCounter> | undefined;
  if (existing) return existing;
  const created = new Map<string, TrafficRoundCounter>();
  host[TRAFFIC_COUNTER_STORE_KEY] = created;
  return created;
}

function normalizeRoundId(roundId: string): string {
  return String(roundId || "").trim();
}

export function startTrafficCounter(roundId: string): number {
  const id = normalizeRoundId(roundId);
  if (!id) return 0;

  const store = getCounterStore();
  const existing = store.get(id);
  if (existing?.interval) {
    console.log("[traffic-flash:counter] counter already running", {
      roundId: id,
      currentCount: existing.count,
    });
    return existing.count;
  }

  const state: TrafficRoundCounter = existing || {
    count: 0,
    startedAt: Date.now(),
    stopped: false,
    stopReason: null,
  };
  state.stopped = false;
  state.stopReason = null;
  state.interval = setInterval(() => {
    if (state.stopped) return;
    if (Number.isFinite(state.endAtMs) && Date.now() >= Number(state.endAtMs)) {
      console.log("[traffic-flash:counter] traffic round reached end_time", {
        roundId: id,
        endAtMs: state.endAtMs,
        currentCount: state.count,
      });
      stopTrafficCounter(id, "end_time_reached");
      return;
    }
    state.count += Math.floor(Math.random() * 2);
    console.log("[traffic-flash:counter] counter tick", {
      roundId: id,
      currentCount: state.count,
    });
  }, 1000);
  store.set(id, state);

  console.log("[traffic-flash:counter] counter started for roundId", {
    roundId: id,
    startedAt: state.startedAt,
  });

  return state.count;
}

export function setTrafficCounterEndTime(roundId: string, endAtMs: number): void {
  const id = normalizeRoundId(roundId);
  if (!id || !Number.isFinite(endAtMs)) return;
  const store = getCounterStore();
  const state =
    store.get(id) ||
    ({
      count: 0,
      startedAt: Date.now(),
      stopped: false,
      stopReason: null,
    } as TrafficRoundCounter);
  state.endAtMs = Number(endAtMs);
  store.set(id, state);
}

export function stopTrafficCounter(roundId: string, reason = "stopped"): number | null {
  const id = normalizeRoundId(roundId);
  if (!id) return null;
  const store = getCounterStore();
  const state = store.get(id);
  if (!state) return null;

  if (state.interval) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
  state.stopped = true;
  state.stopReason = reason;
  store.set(id, state);
  console.log("[traffic-flash:counter] traffic counter stopped for roundId", {
    roundId: id,
    reason,
    finalCount: state.count,
  });
  return state.count;
}

export async function getTrafficCount(roundId: string): Promise<number> {
  const id = normalizeRoundId(roundId);
  if (!id) return 0;

  const store = getCounterStore();
  let state = store.get(id);
  if (!state) {
    startTrafficCounter(id);
    state = store.get(id);
  }
  if (state && !state.stopped && Number.isFinite(state.endAtMs) && Date.now() >= Number(state.endAtMs)) {
    stopTrafficCounter(id, "end_time_reached");
    state = store.get(id);
  }

  const count = state?.count ?? 0;
  console.log("[traffic-flash:counter] getTrafficCount", { roundId: id, currentCount: count });
  return count;
}
