import { NextResponse } from "next/server";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/funmarket_pump.json";
import { getConnection, getUserPositionPDA, PROGRAM_ID } from "@/utils/solana";
import { supabaseServer } from "@/lib/supabaseServer";
import { readPlaySession } from "@/lib/playAuth";
import { realFeedMultiple, parseBLamports, DEFAULT_BASE_PRICE_LAMPORTS } from "@/lib/realTradeQuote";
import { getPlayQuoteShareTotals } from "@/lib/playEngine";
import { playNewTradeQuoteUsd } from "@/lib/playPayoutMath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One personalized batch for all mounted mobile cards, never one quote per outcome.
export async function POST(req: Request) {
  const stateVersions: Record<string, number> = {};
  const respond = (multiples: Record<string, (number | null)[]>) =>
    NextResponse.json({ multiples, stateVersions }, { headers: { "Cache-Control": "private, no-store" } });
  const multiples: Record<string, (number | null)[]> = {};
  try {
    const body = await req.json();
    if (body.mode !== "play" && body.mode !== "real") return respond(multiples);
    const addresses = Array.from(new Set<string>(
      (Array.isArray(body.addresses) ? body.addresses : [])
        .filter((a: unknown) => typeof a === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
    )).slice(0, 100);
    if (!addresses.length) return respond(multiples);
    if (body.mode === "play") {
      const session = readPlaySession(req);
      if (!session) return respond(multiples);
      const { data, error } = await supabaseServer().rpc("play_feed_quotes", {
        wallet_in: session.wallet, addresses,
      });
      if (error) return respond(multiples); // migration unavailable: omit
      const targets = addresses.flatMap(addr => {
        const quotes = data?.[addr];
        const first = Array.isArray(quotes) ? quotes.find(Boolean) : null;
        const stateVersion = Number(first?.state_version);
        const outcomeCount = Number(first?.outcome_count);
        return Number.isInteger(stateVersion) && Number.isInteger(outcomeCount)
          ? [{ marketAddress: addr, stateVersion, outcomeCount }]
          : [];
      });
      const totals = await getPlayQuoteShareTotals(targets);
      for (const addr of addresses) {
        if (!Array.isArray(data?.[addr])) continue;
        const first = data[addr].find(Boolean);
        const stateVersion = Number(first?.state_version);
        if (Number.isInteger(stateVersion)) stateVersions[addr] = stateVersion;
        multiples[addr] = data[addr].map((quote: {
          outcome_index?: unknown;
          shares?: unknown;
          virtual_pool_usd_after?: unknown;
          stake_usd?: unknown;
        } | null) => {
          const outcome = Number(quote?.outcome_index);
          const total = totals.get(`${addr}|${outcome}`);
          const marginal = total === undefined || !quote
            ? null
            : playNewTradeQuoteUsd({
                newTradeShares: quote.shares,
                currentTotalWinningShares: total,
                finalPoolUsdAfter: quote.virtual_pool_usd_after,
                newStakeUsd: quote.stake_usd,
              });
          const value = Number(marginal?.multiple);
          return Number.isFinite(value) && value > 0 ? value : null;
        });
      }
    } else {
      // REAL positions are public on-chain data. Use the same connected wallet
      // as TradingPanel; this address grants no authority to execute anything.
      if (typeof body.wallet !== "string") return respond(multiples);
      const wallet = new PublicKey(body.wallet);
      const marketKeys = addresses.map(a => new PublicKey(a));
      // Keep each market and its position in the same RPC snapshot (limit 100).
      const accountKeys = marketKeys.flatMap(key => [key, getUserPositionPDA(key, wallet)[0]]);
      const [infoBatches, rows] = await Promise.all([
        Promise.all(Array.from({ length: Math.ceil(accountKeys.length / 100) }, (_, i) =>
          getConnection().getMultipleAccountsInfo(accountKeys.slice(i * 100, (i + 1) * 100), "confirmed"))),
        // Trade page reads the configured base from this same market row.
        supabaseServer().from("markets").select("*").in("market_address", addresses),
      ]);
      if (rows.error) return respond(multiples);
      const byAddress = new Map((rows.data ?? []).map(row => [row.market_address, row]));
      const coder = new BorshAccountsCoder(idl as Idl);
      const infos = infoBatches.flat();
      marketKeys.forEach((marketKey, index) => {
        const info = infos[index * 2];
        const positionInfo = infos[index * 2 + 1];
        if (!info || !info.owner.equals(PROGRAM_ID)) return;
        try {
          const market = coder.decode("Market", info.data);
          if (!("Open" in market.status) || market.resolved || market.cancelled || Number(market.resolution_time) <= Date.now() / 1000) return;
          const count = Number(market.outcome_count);
          if (count < 2 || count > 10) return;
          const row = byAddress.get(addresses[index]);
          if (!row || row.is_blocked || row.resolved || row.cancelled ||
            (row.resolution_status && row.resolution_status !== "open")) return;
          let holdings = Array<number>(count).fill(0);
          if (positionInfo) {
            if (!positionInfo.owner.equals(PROGRAM_ID)) return;
            const position = coder.decode("UserPosition", positionInfo.data);
            if (!position.market.equals(marketKey) || !position.user.equals(wallet)) return;
            holdings = position.shares.slice(0, count).map(Number);
            if (holdings.length !== count) return;
          }
          const base = parseBLamports(row) || DEFAULT_BASE_PRICE_LAMPORTS;
          multiples[addresses[index]] = market.q.slice(0, count).map((s: unknown, outcome: number) =>
            realFeedMultiple(base, Number(s), info.lamports, holdings[outcome]));
        } catch { /* invalid account: omit */ }
      });
    }
  } catch { /* unavailable snapshot: preserve percentage-only cards */ }
  return respond(multiples);
}
