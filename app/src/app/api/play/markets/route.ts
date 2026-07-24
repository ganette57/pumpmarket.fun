import { NextResponse } from "next/server";
import { getPlayMarketSnapshots, PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ADDRESSES = 200;

// POST /api/play/markets   { market_addresses: string[] }
//
// Batch Play book for the feed: supplies, implied probabilities, virtual
// pool and status for many markets in one round trip.
//
// PUBLIC ON PURPOSE — no Play session required. These are odds, i.e. public
// market information, exactly like the Real supplies already rendered to
// signed-out visitors. Requiring a session would leave the feed blank in
// Play mode until the user signs, which is precisely the stale/empty state
// this phase exists to remove. Nothing user-scoped is returned: no
// balances, no positions, no account.
//
// Markets with no Play state yet are NOT omitted — the engine synthesizes
// the backend-defined opening book (equal seed per outcome) so a fresh
// market shows real initial probabilities rather than falling back to Real.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.market_addresses) ? body.market_addresses : [];

    const addresses: string[] = Array.from(
      new Set<string>(
        raw
          .map((a: unknown) => String(a ?? "").trim())
          .filter((a: string) => a.length >= 32 && a.length <= 64)
      )
    ).slice(0, MAX_ADDRESSES);

    if (addresses.length === 0) {
      return NextResponse.json({ snapshots: {} });
    }

    const snapshots = await getPlayMarketSnapshots(addresses);
    return NextResponse.json({ snapshots });
  } catch (e: unknown) {
    if (e instanceof PlayEngineError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[/api/play/markets] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
