import "server-only";

export type TrafficCounterLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type StartTrafficCounterInput = {
  streamUrl: string;
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
};

const DEFAULT_TRAFFIC_CLASSES = ["car", "bus", "truck", "motorcycle"];
const DEFAULT_TRACKER = "bytetrack";
const DEFAULT_WORKER_URL = "http://127.0.0.1:8090";

function workerBaseUrl(): string {
  return (
    String(process.env.TRAFFIC_VISION_WORKER_URL || "").trim() ||
    String(process.env.NEXT_PUBLIC_TRAFFIC_VISION_WORKER_URL || "").trim() ||
    DEFAULT_WORKER_URL
  ).replace(/\/+$/, "");
}

async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${workerBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
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

export async function startTrafficCounter(
  roundId: string,
  input: StartTrafficCounterInput,
): Promise<number> {
  const id = normalizeRoundId(roundId);
  if (!id) return 0;

  const body = {
    roundId: id,
    streamUrl: String(input.streamUrl || "").trim(),
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
  const id = normalizeRoundId(roundId);
  if (!id) return 0;

  const res = await workerFetch(`/rounds/${encodeURIComponent(id)}/status`, {
    method: "GET",
  });
  if (res.status === 404) {
    throw new Error(`traffic worker round not found: ${id}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`traffic worker status failed (${res.status}): ${text || "unknown error"}`);
  }

  const json = (await res.json().catch(() => ({}))) as Partial<WorkerRoundStatus>;
  return normalizeCount(json.currentCount);
}

export async function stopTrafficCounter(roundId: string, reason = "stopped"): Promise<number | null> {
  const id = normalizeRoundId(roundId);
  if (!id) return null;

  const res = await workerFetch(`/rounds/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`traffic worker stop failed (${res.status}): ${text || "unknown error"}`);
  }

  const json = (await res.json().catch(() => ({}))) as { finalCount?: unknown };
  return normalizeCount(json.finalCount);
}

// Kept for compatibility with existing call sites.
export function setTrafficCounterEndTime(roundId: string, endAtMs: number): void {
  void roundId;
  void endAtMs;
}
