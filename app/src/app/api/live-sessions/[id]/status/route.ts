import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { supabaseServer } from "@/lib/supabaseServer";
import { linkedLiveMarketRequiresResolution } from "@/lib/liveSessionLifecycle";

const VALID_STATUSES = ["live", "locked", "ended", "resolved", "cancelled"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

const MAX_DRIFT_MS = 2 * 60_000; // 2 minutes replay window

/**
 * The current market's trade-lock / end timestamps, read from the market row
 * that actually owns them. Best-effort: a missing row or a deployment without
 * the `trading_lock_at` column yields nulls, which read as "no trade lock"
 * everywhere downstream.
 */
async function readMarketWindow(
  supabase: ReturnType<typeof supabaseServer>,
  marketAddress: unknown,
): Promise<{ lockAt: string | null; endAt: string | null }> {
  const addr = String(marketAddress || "").trim();
  if (!addr) return { lockAt: null, endAt: null };

  const { data, error } = await supabase
    .from("markets")
    .select("trading_lock_at,end_date")
    .eq("market_address", addr)
    .maybeSingle();

  if (error || !data) return { lockAt: null, endAt: null };
  return {
    lockAt: (data as any).trading_lock_at ?? null,
    endAt: (data as any).end_date ?? null,
  };
}


export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sessionId = params.id;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session id" }, { status: 400 });
    }

    const body = await req.json();
    const { wallet, signature, newStatus, ts } = body as {
      wallet?: string;
      signature?: string;
      newStatus?: string;
      ts?: number;
    };

    // ── Validate inputs ──────────────────────────────────────────
    if (!wallet || !signature || !newStatus || typeof ts !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: wallet, signature, newStatus, ts" },
        { status: 400 }
      );
    }

    if (!VALID_STATUSES.includes(newStatus as ValidStatus)) {
      return NextResponse.json(
        { error: `Invalid status: ${newStatus}` },
        { status: 400 }
      );
    }

    // ── Replay protection ────────────────────────────────────────
    if (Math.abs(Date.now() - ts) > MAX_DRIFT_MS) {
      return NextResponse.json(
        { error: "Timestamp too far from server time (replay protection)" },
        { status: 400 }
      );
    }

    // ── Verify ed25519 signature ─────────────────────────────────
    const message = `FUNMARKET_LIVE_STATUS|${sessionId}|${newStatus}|${ts}`;
    const messageBytes = new TextEncoder().encode(message);

    let pubKeyBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubKeyBytes = bs58.decode(wallet);
      sigBytes = bs58.decode(signature);
    } catch {
      return NextResponse.json(
        { error: "Invalid base58 in wallet or signature" },
        { status: 400 }
      );
    }

    const verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    if (!verified) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 403 });
    }

    // ── Fetch session and check ownership ────────────────────────
    const supabase = supabaseServer();

    const { data: session, error: fetchErr } = await supabase
      .from("live_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr) {
      console.error("API live-status fetch error:", fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ error: "Live session not found" }, { status: 404 });
    }

    if (session.host_wallet?.toLowerCase() !== wallet.toLowerCase()) {
      return NextResponse.json(
        { error: "Forbidden — you are not the host of this session" },
        { status: 403 }
      );
    }

    // Ending the stream session must not orphan an unresolved linked market.
    // This host route is not an admin/emergency control, so it fails closed
    // when the lifecycle row cannot be read.
    if (newStatus === "ended" && session.market_address) {
      const { data: linkedMarket, error: marketError } = await supabase
        .from("markets")
        .select("resolved,cancelled,resolution_status")
        .eq("market_address", session.market_address)
        .maybeSingle();
      if (
        marketError ||
        linkedLiveMarketRequiresResolution({
          marketAddress: session.market_address,
          market: linkedMarket
            ? {
                resolved: !!linkedMarket.resolved,
                cancelled: !!linkedMarket.cancelled,
                resolutionStatus: linkedMarket.resolution_status,
              }
            : null,
        })
      ) {
        return NextResponse.json(
          { error: "Propose a result or cancel the linked market before ending the session." },
          { status: 409 },
        );
      }
    }

    // ── Build patch (same logic as client handleStatusChange) ────
    //
    // EVERY branch here writes SESSION columns only. The flash trade deadline
    // lives on `markets.trading_lock_at` and is written exactly once, at
    // market creation — no host action may move it, or the automatic lock
    // would stop being deterministic. Nothing in this route touches the
    // `markets` table.
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: newStatus };

    switch (newStatus) {
      case "live": {
        patch.ended_at = null;
        if (!session.started_at) patch.started_at = now;
        // Re-mirror the CURRENT market's clock rather than nulling it. These
        // columns used to be wiped here, which was harmless while nothing
        // read them; they are now a convenience mirror of the market row, so
        // wiping them would leave the session describing a window that has
        // nothing to do with the market it points at. Read-only mirror — the
        // live surfaces still read markets.trading_lock_at, never this.
        const mirrored = await readMarketWindow(supabase, session.market_address);
        patch.lock_at = mirrored.lockAt;
        patch.end_at = mirrored.endAt;
        break;
      }
      case "locked":
        // Legacy session-level behaviour, unchanged: stamp when the host
        // manually locked the SESSION. This is not the flash trade deadline
        // and cannot shorten it — a manual lock closes trading through
        // `session.status`, which every live surface already gates on.
        patch.lock_at = now;
        break;
      case "ended":
        patch.end_at = now;
        patch.ended_at = now;
        break;
      case "resolved":
        patch.end_at = session.end_at || now;
        patch.ended_at = session.ended_at || now;
        break;
      case "cancelled":
        patch.end_at = session.end_at || now;
        patch.ended_at = session.ended_at || now;
        break;
    }

    // ── Update (no .select() to avoid "Cannot coerce" errors) ────
    const { error: updateErr } = await supabase
      .from("live_sessions")
      .update(patch)
      .eq("id", sessionId);

    if (updateErr) {
      console.error("API live-status update error:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // ── Re-fetch updated row ─────────────────────────────────────
    const { data: updated, error: refetchErr } = await supabase
      .from("live_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    if (refetchErr) {
      console.error("API live-status refetch error:", refetchErr);
      return NextResponse.json({ error: refetchErr.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "Session disappeared after update" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, session: updated });
  } catch (e: any) {
    console.error("API live-status crash:", e);
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
