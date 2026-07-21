import { NextResponse } from "next/server";
import { readPlaySession } from "@/lib/playAuth";
import {
  ensureAccount,
  getTrades,
  PlayEngineError,
  type PlayTradeStatus,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS: PlayTradeStatus[] = ["open", "won", "lost", "refunded"];

// POST /api/play/history   { status?, limit? }
//
// The session wallet's own Play trades. The account is resolved from the
// session cookie, so a caller can never read another wallet's history by
// changing a parameter — there is no parameter to change.
//
// Auth: the play_session cookie.
export async function POST(req: Request) {
  try {
    const session = readPlaySession(req);
    if (!session) {
      return NextResponse.json(
        { error: "Play session required" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    const rawStatus = String(body?.status || "").trim();
    const status = VALID_STATUS.includes(rawStatus as PlayTradeStatus)
      ? (rawStatus as PlayTradeStatus)
      : undefined;

    const limitRaw = Number(body?.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const account = await ensureAccount(session.wallet);
    const trades = await getTrades({ accountId: account.id, status, limit });

    return NextResponse.json({ account_id: account.id, trades });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/history] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
