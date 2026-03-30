import "server-only";

export type TrafficCounterLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type StartTrafficCounterInput = {
  streamUrl: string;
  sourceType?: "local_video" | "remote_stream";
  durationSec: number;
  line: TrafficCounterLine;
  classes?: string[];
  tracker?: string;
};

type WorkerRoundStatus = {
  roundId: string;
  status: "running" | "ended" | "stopped";
  currentCount: number;
  startedAt: number;
  endsAt: number;
  sourceOpened?: boolean;
  lastFrameAt?: number | null;
  detectionsLastFrame?: number;
  frameWidth?: number | null;
  frameHeight?: number | null;
  countingLineX?: number | null;
  countingLineY?: number | null;
  lastCountedTrackId?: number | null;
  lastCrossingDirection?: string | null;
  lastDecisionTrackId?: number | null;
  lastDecisionReason?: string | null;
  lastDecisionCounted?: boolean | null;
  lastTrackDeltaX?: number | null;
  lastTrackSamples?: number | null;
};

const DEFAULT_TRAFFIC_CLASSES = ["car", "bus", "truck", "motorcycle"];
const DEFAULT_TRACKER = "bytetrack";
const DEFAULT_WORKER_URL = "http://127.0.0.1:8090";
const MISSING_WORKER_ROUNDS = new Set<string>();

export function getTrafficWorkerBaseUrl(): string {
  return (
    String(process.env.TRAFFIC_VISION_WORKER_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_TRAFFIC_VISION_WORKER_URL || "").trim() ||
    DEFAULT_WORKER_URL
  ).replace(/\/+$/, "");
}

async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${getTrafficWorkerBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function normalizeRoundId(roundId: string): string {
  return String(roundId || "").trim();
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeOptionalCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export type TrafficRoundStatus = {
  roundId: string;
  status: "running" | "ended" | "stopped";
  currentCount: number;
  startedAt: number;
  endsAt: number;
  sourceOpened: boolean;
  lastFrameAt: number | null;
  detectionsLastFrame: number;
  frameWidth: number | null;
  frameHeight: number | null;
  countingLineX: number | null;
  countingLineY: number | null;
  lastCountedTrackId: number | null;
  lastCrossingDirection: string | null;
  lastDecisionTrackId: number | null;
  lastDecisionReason: string | null;
  lastDecisionCounted: boolean | null;
  lastTrackDeltaX: number | null;
  lastTrackSamples: number | null;
};

export async function startTrafficCounter(
  roundId: string,
  input: StartTrafficCounterInput,
): Promise<number> {
  const id = normalizeRoundId(roundId);
  if (!id) return 0;
  MISSING_WORKER_ROUNDS.delete(id);

  const body = {
    roundId: id,
    streamUrl: String(input.streamUrl || "").trim(),
    sourceType: input.sourceType === "remote_stream" ? "remote_stream" : "local_video",
    durationSec: Math.max(1, Math.floor(Number(input.durationSec) || 60)),
    line: input.line,
    classes: (input.classes || DEFAULT_TRAFFIC_CLASSES).filter(Boolean),
    tracker: String(input.tracker || DEFAULT_TRACKER).trim() || DEFAULT_TRACKER,
  };

  if (!body.streamUrl) {
    throw new Error("traffic worker start failed: missing streamUrl");
  }

  const res = await workerFetch("/rounds/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`traffic worker start failed (${res.status}): ${text || "unknown error"}`);
  }

  const json = (await res.json().catch(() => ({}))) as Partial<WorkerRoundStatus>;
  return normalizeCount(json.currentCount);
}

export async function getTrafficCount(roundId: string): Promise<number> {
  const status = await getTrafficRoundStatus(roundId);
  return status.currentCount;
}

export async function getTrafficRoundStatus(roundId: string): Promise<TrafficRoundStatus> {
  const id = normalizeRoundId(roundId);
  if (!id) {
    return {
      roundId: "",
      status: "stopped",
      currentCount: 0,
      startedAt: 0,
      endsAt: 0,
      sourceOpened: false,
      lastFrameAt: null,
      detectionsLastFrame: 0,
      frameWidth: null,
      frameHeight: null,
      countingLineX: null,
      countingLineY: null,
      lastCountedTrackId: null,
      lastCrossingDirection: null,
      lastDecisionTrackId: null,
      lastDecisionReason: null,
      lastDecisionCounted: null,
      lastTrackDeltaX: null,
      lastTrackSamples: null,
    };
  }
  if (MISSING_WORKER_ROUNDS.has(id)) {
    return {
      roundId: id,
      status: "stopped",
      currentCount: 0,
      startedAt: 0,
      endsAt: 0,
      sourceOpened: false,
      lastFrameAt: null,
      detectionsLastFrame: 0,
      frameWidth: null,
      frameHeight: null,
      countingLineX: null,
      countingLineY: null,
      lastCountedTrackId: null,
      lastCrossingDirection: null,
      lastDecisionTrackId: null,
      lastDecisionReason: null,
      lastDecisionCounted: null,
      lastTrackDeltaX: null,
      lastTrackSamples: null,
    };
  }

  const res = await workerFetch(`/rounds/${encodeURIComponent(id)}/status`, {
    method: "GET",
  });
  if (res.status === 404) {
    MISSING_WORKER_ROUNDS.add(id);
    return {
      roundId: id,
      status: "stopped",
      currentCount: 0,
      startedAt: 0,
      endsAt: 0,
      sourceOpened: false,
      lastFrameAt: null,
      detectionsLastFrame: 0,
      frameWidth: null,
      frameHeight: null,
      countingLineX: null,
      countingLineY: null,
      lastCountedTrackId: null,
      lastCrossingDirection: null,
      lastDecisionTrackId: null,
      lastDecisionReason: null,
      lastDecisionCounted: null,
      lastTrackDeltaX: null,
      lastTrackSamples: null,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`traffic worker status failed (${res.status}): ${text || "unknown error"}`);
  }

  const json = (await res.json().catch(() => ({}))) as Partial<WorkerRoundStatus>;
  MISSING_WORKER_ROUNDS.delete(id);
  return {
    roundId: String(json.roundId || id),
    status:
      json.status === "running" || json.status === "ended" || json.status === "stopped"
        ? json.status
        : "stopped",
    currentCount: normalizeCount(json.currentCount),
    startedAt: normalizeCount(json.startedAt),
    endsAt: normalizeCount(json.endsAt),
    sourceOpened: normalizeBool(json.sourceOpened),
    lastFrameAt: normalizeOptionalCount(json.lastFrameAt),
    detectionsLastFrame: normalizeCount(json.detectionsLastFrame),
    frameWidth: normalizeOptionalCount(json.frameWidth),
    frameHeight: normalizeOptionalCount(json.frameHeight),
    countingLineX: normalizeOptionalCount(json.countingLineX),
    countingLineY: normalizeOptionalCount(json.countingLineY),
    lastCountedTrackId: normalizeOptionalCount(json.lastCountedTrackId),
    lastCrossingDirection: normalizeOptionalText(json.lastCrossingDirection),
    lastDecisionTrackId: normalizeOptionalCount(json.lastDecisionTrackId),
    lastDecisionReason: normalizeOptionalText(json.lastDecisionReason),
    lastDecisionCounted:
      typeof json.lastDecisionCounted === "boolean" ? json.lastDecisionCounted : null,
    lastTrackDeltaX:
      typeof json.lastTrackDeltaX === "number" && Number.isFinite(json.lastTrackDeltaX)
        ? Number(json.lastTrackDeltaX)
        : null,
    lastTrackSamples: normalizeOptionalCount(json.lastTrackSamples),
  };
}

export async function stopTrafficCounter(roundId: string, reason = "stopped"): Promise<number | null> {
  const id = normalizeRoundId(roundId);
  if (!id) return null;
  if (MISSING_WORKER_ROUNDS.has(id)) return null;

  const res = await workerFetch(`/rounds/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  if (res.status === 404) {
    MISSING_WORKER_ROUNDS.add(id);
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`traffic worker stop failed (${res.status}): ${text || "unknown error"}`);
  }

  MISSING_WORKER_ROUNDS.delete(id);
  const json = (await res.json().catch(() => ({}))) as { finalCount?: unknown };
  return normalizeCount(json.finalCount);
}

// Kept for compatibility with existing call sites.
export function setTrafficCounterEndTime(roundId: string, endAtMs: number): void {
  void roundId;
  void endAtMs;
}

export function getTrafficDebugFrameUrl(roundId: string): string {
  const id = normalizeRoundId(roundId);
  return `${getTrafficWorkerBaseUrl()}/rounds/${encodeURIComponent(id)}/frame.jpg`;
}
