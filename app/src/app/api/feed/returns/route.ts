import { NextResponse } from "next/server";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/funmarket_pump.json";
import { getConnection, PROGRAM_ID } from "@/utils/solana";
import { supabaseServer } from "@/lib/supabaseServer";
import { playProRataPayoutUsd, type PlayProRataInput } from "@/lib/playPayoutMath";
import { realFeedMultiple, parseBLamports, DEFAULT_BASE_PRICE_LAMPORTS } from "@/lib/realTradeQuote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One public batch for all mounted mobile cards, never one quote per outcome.
export async function POST(req: Request) {
  const multiples: Record<string, (number | null)[]> = {};
  try {
    const body = await req.json();
    if (body.mode !== "play" && body.mode !== "real") return NextResponse.json({ multiples });
    const addresses = Array.from(new Set<string>(
      (Array.isArray(body.addresses) ? body.addresses : [])
        .filter((a: unknown) => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
    )).slice(0, 100);
    if (!addresses.length) return NextResponse.json({ multiples });
    if (body.mode === "play") {
      const { data, error } = await supabaseServer().rpc("play_feed_quote_inputs", { addresses });
      if (error) return NextResponse.json({ multiples }); // migration unavailable: omit
      for (const addr of addresses) {
        if (!Array.isArray(data?.[addr])) continue;
        multiples[addr] = data[addr].map((input: PlayProRataInput) => {
          const payout = playProRataPayoutUsd(input);
          // play_quote rounds payout/stake to four decimals before the UI.
          return payout === null ? null : Number((Number(payout) / 100).toFixed(4));
        });
      }
    } else {
      const [infos, rows] = await Promise.all([
        getConnection().getMultipleAccountsInfo(addresses.map(a => new PublicKey(a)), "confirmed"),
        // Trade page reads the configured base from this same market row.
        supabaseServer().from("markets").select("*").in("market_address", addresses),
      ]);
      if (rows.error) return NextResponse.json({ multiples });
      const byAddress = new Map((rows.data ?? []).map(row => [row.market_address, row]));
      const coder = new BorshAccountsCoder(idl as Idl);
      infos.forEach((info, index) => {
        if (!info || !info.owner.equals(PROGRAM_ID)) return;
        try {
          const market = coder.decode("Market", info.data);
          if (!("Open" in market.status) || market.resolved || market.cancelled || Number(market.resolution_time) <= Date.now() / 1000) return;
          const count = Number(market.outcome_count);
          if (count < 2 || count > 10) return;
          const row = byAddress.get(addresses[index]);
          if (!row || row.is_blocked || row.resolved || row.cancelled ||
            (row.resolution_status && row.resolution_status !== "open")) return;
          const base = parseBLamports(row) || DEFAULT_BASE_PRICE_LAMPORTS;
          multiples[addresses[index]] = market.q.slice(0, count).map((s: unknown) =>
            realFeedMultiple(base, Number(s), info.lamports));
        } catch { /* invalid account: omit */ }
      });
    }
  } catch { /* unavailable snapshot: preserve percentage-only cards */ }
  return NextResponse.json({ multiples }, { headers: { "Cache-Control": "no-store" } });
}
