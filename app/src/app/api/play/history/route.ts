import { NextResponse } from "next/server";
import { verifyPlaySignature } from "@/lib/playAuth";
import {
  ensureAccount,
  getTrades,
  PlayEngineError,
  type PlayTradeStatus,
} from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS: PlayTradeStatus[] = ["open", "won", "lost", "refunded"];

// POST /api/play/history
//
// The verified wallet's own Play trades. Scoped server-side to the account
// resolved from the signature — a caller can never read another wallet's
// history by changing a parameter.
//
// Auth: signed wallet over  FUNMARKET_PLAY|history|<ts>
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const auth = verifyPlaySignature({
      wallet: body?.wallet,
      signature: body?.signature,
      ts: body?.ts,
      action: "history",
      parts: [],
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const rawStatus = String(body?.status || "").trim();
    const status = VALID_STATUS.includes(rawStatus as PlayTradeStatus)
      ? (rawStatus as PlayTradeStatus)
      : undefined;

    const limitRaw = Number(body?.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

    const account = await ensureAccount(auth.wallet);
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
