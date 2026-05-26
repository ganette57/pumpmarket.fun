import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { supabaseServer } from "@/lib/supabaseServer";

// Host-only update of `live_sessions.market_address`. Mirrors the signed-
// message verification used by the status route so RLS-protected updates stay
// gated behind a wallet signature.

const MAX_DRIFT_MS = 2 * 60_000; // 2 minutes replay window

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const sessionId = params.id;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session id" }, { status: 400 });
    }

    const body = await req.json();
    const { wallet, signature, market_address, ts } = body as {
      wallet?: string;
      signature?: string;
      market_address?: string;
      ts?: number;
    };

    if (!wallet || !signature || !market_address || typeof ts !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: wallet, signature, market_address, ts" },
        { status: 400 },
      );
    }

    const newMarketAddress = String(market_address).trim();
    if (!newMarketAddress) {
      return NextResponse.json({ error: "market_address is required" }, { status: 400 });
    }

    if (Math.abs(Date.now() - ts) > MAX_DRIFT_MS) {
      return NextResponse.json(
        { error: "Timestamp too far from server time (replay protection)" },
        { status: 400 },
      );
    }

    // Verify ed25519 signature over a domain-separated message.
    const message = `FUNMARKET_LIVE_MARKET|${sessionId}|${newMarketAddress}|${ts}`;
    const messageBytes = new TextEncoder().encode(message);

    let pubKeyBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubKeyBytes = bs58.decode(wallet);
      sigBytes = bs58.decode(signature);
    } catch {
      return NextResponse.json(
        { error: "Invalid base58 in wallet or signature" },
        { status: 400 },
      );
    }

    const verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    if (!verified) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 403 });
    }

    const supabase = supabaseServer();

    const { data: session, error: fetchErr } = await supabase
      .from("live_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.host_wallet !== wallet) {
      return NextResponse.json(
        { error: "Only the host can change the linked market" },
        { status: 403 },
      );
    }

    const { data: updated, error: updErr } = await supabase
      .from("live_sessions")
      .update({ market_address: newMarketAddress })
      .eq("id", sessionId)
      .select("*")
      .single();

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ session: updated });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || "Unknown error") },
      { status: 500 },
    );
  }
}
