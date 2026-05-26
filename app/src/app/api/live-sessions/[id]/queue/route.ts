import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  serializeQueuedNextMarketConfig,
  type QueuedNextMarketConfig,
} from "@/lib/liveSessions";

// Host-only queue ops for the live session's "next market" CONFIG.
//
// The queued slot now stores a configuration only (title / outcomes /
// durationMin) — the on-chain market is created later (after the current
// market resolves) so its timer starts fresh from the selected duration.
//
// Actions:
//   set    — persist queued_market_config (jsonb).
//   clear  — clear the queued slot (also clears the legacy address column).
//
// Signed-message convention:
//   FUNMARKET_LIVE_QUEUE|{sessionId}|{action}|{payload}|{ts}
//   payload = canonical config JSON for "set", empty string for "clear".
//
// Requires column `queued_market_config jsonb` on `live_sessions`. If the
// column does not exist yet, Supabase returns a clear error and the host UI
// surfaces it — no other flow is broken.

const MAX_DRIFT_MS = 2 * 60_000;
const VALID_ACTIONS = ["set", "clear"] as const;
type Action = (typeof VALID_ACTIONS)[number];

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
    const { wallet, signature, action, config, ts } = body as {
      wallet?: string;
      signature?: string;
      action?: string;
      config?: QueuedNextMarketConfig;
      ts?: number;
    };

    if (!wallet || !signature || !action || typeof ts !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: wallet, signature, action, ts" },
        { status: 400 },
      );
    }
    if (!VALID_ACTIONS.includes(action as Action)) {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    let canonicalPayload = "";
    let configToStore: QueuedNextMarketConfig | null = null;

    if (action === "set") {
      if (!config || typeof config !== "object") {
        return NextResponse.json(
          { error: "config is required for set" },
          { status: 400 },
        );
      }
      // Re-serialise on the server with the SAME helper the client used so
      // the signed-message payload matches byte-for-byte. The stored row uses
      // the normalised version, never the raw client object.
      canonicalPayload = serializeQueuedNextMarketConfig(config);
      configToStore = JSON.parse(canonicalPayload) as QueuedNextMarketConfig;
    }

    if (Math.abs(Date.now() - ts) > MAX_DRIFT_MS) {
      return NextResponse.json(
        { error: "Timestamp too far from server time (replay protection)" },
        { status: 400 },
      );
    }

    const message = `FUNMARKET_LIVE_QUEUE|${sessionId}|${action}|${canonicalPayload}|${ts}`;
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
        { error: "Only the host can change the queue" },
        { status: 403 },
      );
    }

    // Defensively clear the legacy address column on every queue op so old
    // rows don't keep showing a stale Up Next.
    const patch: Record<string, unknown> =
      action === "set"
        ? { queued_market_config: configToStore, queued_market_address: null }
        : { queued_market_config: null, queued_market_address: null };

    const { data: updated, error: updErr } = await supabase
      .from("live_sessions")
      .update(patch)
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
