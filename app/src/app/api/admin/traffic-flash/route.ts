import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin";
import { assertLiveMicroGuards, getLiveMicroFlags } from "@/lib/liveMicro/config";
import { ensureLiveMicroAutoTickStarted, getLiveMicroAutoTickStatus } from "@/lib/liveMicro/autoTick";
import {
  getTrafficFlashRuntimeStatus,
  listRecentTrafficFlash,
  setTrafficFlashEnabled,
  startTrafficFlash,
} from "@/lib/traffic/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionType = "status" | "set_enabled" | "start_flash" | "list_recent";

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

function normalizeDuration(value: unknown): 60 | 180 | 300 {
  const n = Math.floor(Number(value));
  if (n === 180) return 180;
  if (n === 300) return 300;
  return 60;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const adminOk = await isAdminRequest(req);
  if (adminOk) return true;

  const flags = getLiveMicroFlags();
  const expected = flags.triggerToken;
  if (!expected) return false;

  const token = String(req.headers.get("x-live-micro-token") || "").trim();
  return token === expected;
}

export async function POST(req: Request) {
  ensureLiveMicroAutoTickStarted();
  const authorized = await isAuthorized(req);
  if (!authorized) return jsonError("Unauthorized", 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // keep empty
  }

  const action = String(body.action || "status").trim() as ActionType;

  try {
    assertLiveMicroGuards({ requireOperator: true });

    if (action === "set_enabled") {
      const enabled = !!body.enabled;
      const next = setTrafficFlashEnabled(enabled);
      return NextResponse.json({
        ok: true,
        action,
        ...next,
        status: getTrafficFlashRuntimeStatus(),
      });
    }

    if (action === "start_flash") {
      const threshold = Math.max(1, Math.floor(Number(body.threshold || 12)));
      const durationSec = normalizeDuration(body.duration_sec ?? body.durationSec ?? 60);
      const cameraId = String(body.camera_id || body.cameraId || "").trim();
      const result = await startTrafficFlash({
        threshold,
        durationSec,
        cameraId,
      });

      return NextResponse.json({
        ok: true,
        action,
        auto_tick: getLiveMicroAutoTickStatus(),
        status: getTrafficFlashRuntimeStatus(),
        result,
      });
    }

    if (action === "list_recent") {
      const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit || 20))));
      const recent = await listRecentTrafficFlash(limit);
      return NextResponse.json({
        ok: true,
        action,
        recent,
      });
    }

    if (action === "status") {
      const recent = await listRecentTrafficFlash(20);
      return NextResponse.json({
        ok: true,
        action,
        status: getTrafficFlashRuntimeStatus(),
        auto_tick: getLiveMicroAutoTickStatus(),
        recent,
      });
    }

    return jsonError(`Unknown action: ${action}`, 400);
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    return jsonError(msg, 500, { action });
  }
}
