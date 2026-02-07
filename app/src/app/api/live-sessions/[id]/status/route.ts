import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { supabaseServer } from "@/lib/supabaseServer";

const VALID_STATUSES = ["live", "locked", "ended", "resolved", "cancelled"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

const MAX_DRIFT_MS = 2 * 60_000; // 2 minutes replay window

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

    // ── Build patch (same logic as client handleStatusChange) ────
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: newStatus };

    switch (newStatus) {
      case "live":
        patch.lock_at = null;
        patch.end_at = null;
        patch.ended_at = null;
        if (!session.started_at) patch.started_at = now;
        break;
      case "locked":
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
