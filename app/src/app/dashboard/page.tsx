"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";

import { useProgram } from "@/hooks/useProgram";
import { lamportsToSol, getUserPositionPDA } from "@/utils/solana";

// ---------- Supabase client (no extra file, avoids "@/lib/supabaseClient" missing) ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase =
  supabaseUrl && supabaseAnon ? createClient(supabaseUrl, supabaseAnon) : null;

// ---------- helpers ----------
function shortSig(sig?: string) {
  if (!sig) return "";
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}
function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
function toNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

type DbMarket = {
  id?: string; // uuid
  market_address?: string; // base58
  question?: string;
  creator?: string;
  total_volume?: number; // lamports (as in your app)
  fees_collected?: number; // lamports (on-chain fees_collected mirrored)
  resolved?: boolean;
  // optional fields if you have them
  end_date?: string;
};

type DbTx = {
  id?: string;
  market_id?: string; // uuid
  market_address?: string; // sometimes you might have it
  user_address?: string;
  tx_signature?: string;
  is_buy?: boolean;
  is_yes?: boolean; // legacy binary
  amount?: number; // shares
  cost?: number; // SOL (your recordTransaction stores SOL)
  created_at?: string;
};

type Claimable = {
  marketAddress: string;
  marketQuestion: string;
  estPayoutLamports?: number;
  winningIndex?: number;
};

export default function DashboardPage() {
  const { publicKey, connected } = useWallet();
  const walletBase58 = publicKey?.toBase58() || "";
  const { connection } = useConnection();
  const program = useProgram();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [myMarkets, setMyMarkets] = useState<DbMarket[]>([]);
  const [myTxs, setMyTxs] = useState<DbTx[]>([]);

  const [claimables, setClaimables] = useState<Claimable[]>([]);
  const [claimingMarket, setClaimingMarket] = useState<string | null>(null);

  // ---------- derived ----------
  const marketsById = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of myMarkets) if (mk.id) m.set(mk.id, mk);
    return m;
  }, [myMarkets]);

  const marketsByAddress = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of myMarkets) {
      const addr = mk.market_address;
      if (addr) m.set(addr, mk);
    }
    return m;
  }, [myMarkets]);

  const stats = useMemo(() => {
    const created = myMarkets.length;

    const volLamports = myMarkets.reduce((sum, m) => sum + toNum(m.total_volume), 0);
    const volSol = lamportsToSol(volLamports);

    const feesLamports = myMarkets.reduce((sum, m) => sum + toNum(m.fees_collected), 0);
    // your program adds BOTH fees into market.fees_collected (creator+platform).
    // creator earned ≈ half of that (1%).
    const creatorFeesSol = lamportsToSol(Math.floor(feesLamports / 2));

    return {
      created,
      volSol,
      creatorFeesSol,
    };
  }, [myMarkets]);

  const claimableMap = useMemo(() => {
    const m = new Map<string, Claimable>();
    for (const c of claimables) m.set(c.marketAddress, c);
    return m;
  }, [claimables]);

  // ---------- load supabase data ----------
  useEffect(() => {
    if (!connected || !walletBase58) {
      setLoading(false);
      setMyMarkets([]);
      setMyTxs([]);
      setClaimables([]);
      setErrorMsg(null);
      return;
    }

    if (!supabase) {
      setLoading(false);
      setErrorMsg("Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setErrorMsg(null);

      try {
        // 1) Markets created by this wallet
        const { data: markets, error: mErr } = await supabase
          .from("markets")
          .select("*")
          .eq("creator", walletBase58)
          .order("created_at", { ascending: false });

        if (mErr) throw mErr;
        if (!cancelled) setMyMarkets((markets as any[]) || []);

        // 2) Transactions by this wallet
        const { data: txs, error: tErr } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_address", walletBase58)
          .order("created_at", { ascending: false })
          .limit(30);

        if (tErr) throw tErr;
        if (!cancelled) setMyTxs((txs as any[]) || []);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Failed to load dashboard data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, walletBase58]);

  // ---------- compute claimables (on-chain) ----------
  useEffect(() => {
    // We compute claimables by scanning markets you interacted with (from txs),
    // then reading on-chain: Market(resolved+winning_outcome) + UserPosition(shares+claimed).
    if (!connected || !publicKey || !program) {
      setClaimables([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // gather unique market addresses from txs
        const marketAddrs = Array.from(
          new Set(
            myTxs
              .map((t) => t.market_address)
              .filter(Boolean)
              .map(String)
          )
        );

        // fallback: if tx only stores market_id, map to address using markets list
        if (marketAddrs.length === 0) {
          const fromIds = Array.from(
            new Set(myTxs.map((t) => t.market_id).filter(Boolean).map(String))
          );
          for (const id of fromIds) {
            const mk = marketsById.get(id);
            if (mk?.market_address) marketAddrs.push(mk.market_address);
          }
        }

        const unique = Array.from(new Set(marketAddrs)).slice(0, 30);
        const out: Claimable[] = [];

        for (const addr of unique) {
          if (cancelled) return;

          let marketPk: PublicKey;
          try {
            marketPk = new PublicKey(addr);
          } catch {
            continue;
          }

          // fetch market account
          let marketAcc: any = null;
          try {
            marketAcc = await (program as any).account.market.fetch(marketPk);
          } catch {
            // not found on this cluster or not decoded
            continue;
          }

          const resolved = !!marketAcc?.resolved;
          const winningOpt = marketAcc?.winningOutcome; // Option<u8> may come as null or number/BN
          const winningIndex =
            winningOpt == null
              ? null
              : typeof winningOpt === "number"
              ? winningOpt
              : typeof winningOpt?.toNumber === "function"
              ? winningOpt.toNumber()
              : Number(winningOpt);

          if (!resolved || winningIndex == null || !Number.isFinite(winningIndex)) continue;

          // fetch user position
          const [posPda] = getUserPositionPDA(marketPk, publicKey);
          let posAcc: any = null;
          try {
            posAcc = await (program as any).account.userPosition.fetch(posPda);
          } catch {
            continue; // no position => not claimable
          }

          const alreadyClaimed = !!posAcc?.claimed;
          if (alreadyClaimed) continue;

          const sharesArr = Array.isArray(posAcc?.shares)
            ? posAcc.shares.map((x: any) =>
                typeof x === "number" ? x : typeof x?.toNumber === "function" ? x.toNumber() : Number(x || 0)
              )
            : [];

          const winningShares = Math.floor(Number(sharesArr[winningIndex] || 0));
          if (winningShares <= 0) continue;

          // estimate payout like your Rust:
          // payout = winning_shares * market_balance / total_winning_supply
          const totalWinningSupply = Array.isArray(marketAcc?.outcomeSupplies)
            ? Number(
                typeof marketAcc.outcomeSupplies[winningIndex] === "number"
                  ? marketAcc.outcomeSupplies[winningIndex]
                  : typeof marketAcc.outcomeSupplies[winningIndex]?.toNumber === "function"
                  ? marketAcc.outcomeSupplies[winningIndex].toNumber()
                  : marketAcc.outcomeSupplies[winningIndex] || 0
              )
            : 0;

          let estPayoutLamports: number | undefined = undefined;
          if (totalWinningSupply > 0) {
            const bal = await connection.getBalance(marketPk);
            const payout =
              (BigInt(winningShares) * BigInt(bal)) / BigInt(Math.floor(totalWinningSupply));
            estPayoutLamports = Number(payout);
          }

          const mkDb = marketsByAddress.get(addr);
          out.push({
            marketAddress: addr,
            marketQuestion: mkDb?.question || "(Market)",
            estPayoutLamports,
            winningIndex,
          });
        }

        if (!cancelled) setClaimables(out);
      } catch {
        if (!cancelled) setClaimables([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, program, connection, myTxs, marketsById, marketsByAddress]);

  // ---------- claim handler ----------
  async function handleClaim(marketAddress: string) {
    if (!connected || !publicKey || !program) return;

    try {
      setClaimingMarket(marketAddress);

      const marketPk = new PublicKey(marketAddress);
      const [posPda] = getUserPositionPDA(marketPk, publicKey);

      const sig = await (program as any).methods
        .claimWinnings()
        .accounts({
          market: marketPk,
          userPosition: posPda,
          user: publicKey,
        })
        .rpc();

      alert(
        `Claim success 🎉\n\nTx: ${sig.slice(0, 16)}...\n\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`
      );

      // refresh claimables
      // quick refresh by forcing re-run: easiest is to refetch txs/markets, but we keep it simple:
      setClaimables((prev) => prev.filter((c) => c.marketAddress !== marketAddress));
    } catch (e: any) {
      alert(`Claim failed: ${e?.message || "Unknown error"}`);
    } finally {
      setClaimingMarket(null);
    }
  }

  // ---------- UI ----------
  const walletLabel = useMemo(() => shortAddr(walletBase58), [walletBase58]);

  const txRows = useMemo(() => {
    return myTxs.map((t) => {
      const mk =
        (t.market_id && marketsById.get(String(t.market_id))) ||
        (t.market_address && marketsByAddress.get(String(t.market_address))) ||
        null;

      const marketAddress = (mk?.market_address || t.market_address || "") as string;
      const marketQuestion = (mk?.question || "") as string;

      const side = t.is_buy ? "BUY" : "SELL";
      const shares = Math.floor(toNum(t.amount));
      const outcome = t.is_yes == null ? "" : t.is_yes ? "YES" : "NO";

      const title = `${side} • ${outcome || "Outcome"} • ${shares} shares`;

      const costSol = toNum(t.cost); // your DB stores cost in SOL
      const createdAt = t.created_at ? new Date(t.created_at) : null;

      const claimable = marketAddress ? claimableMap.get(marketAddress) : undefined;

      return {
        id: String(t.id || t.tx_signature || Math.random()),
        title,
        marketAddress,
        marketQuestion,
        sig: String(t.tx_signature || ""),
        costSol,
        createdAt,
        claimable,
      };
    });
  }, [myTxs, marketsById, marketsByAddress, claimableMap]);

  if (!connected) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-white mb-6">Dashboard</h1>
        <div className="card-pump">
          <p className="text-gray-400">Connect wallet to view your dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between gap-6 mb-8">
        <h1 className="text-4xl font-bold text-white">Dashboard</h1>
        <div className="text-sm text-gray-400">Wallet: {walletLabel}</div>
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {errorMsg}
        </div>
      )}

      {/* top stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Markets created</div>
          <div className="text-3xl font-bold text-white">
            {loading ? "…" : stats.created}
          </div>
        </div>

        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Volume (your markets)</div>
          <div className="text-3xl font-bold text-white">
            {loading ? "…" : `${stats.volSol.toFixed(2)} SOL`}
          </div>
        </div>

        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Fees earned (est.)</div>
          <div className="text-3xl font-bold text-white">
            {loading ? "…" : `${stats.creatorFeesSol.toFixed(4)} SOL`}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            (≈ 1% creator fee • from on-chain <code>fees_collected</code>)
          </div>
        </div>
      </div>

      {/* Claimables */}
      <div className="card-pump mb-6">
        <h2 className="text-xl font-bold text-white mb-2">Claimable Winnings</h2>

        {claimables.length === 0 ? (
          <p className="text-gray-400">No claimable winnings found yet.</p>
        ) : (
          <div className="space-y-3">
            {claimables.map((c) => (
              <div
                key={c.marketAddress}
                className="rounded-xl border border-white/10 bg-pump-dark/40 p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-white font-semibold truncate">
                    {c.marketQuestion}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {shortAddr(c.marketAddress)}
                    {typeof c.estPayoutLamports === "number" ? (
                      <>
                        {" "}
                        • est payout:{" "}
                        <span className="text-white/80">
                          {lamportsToSol(c.estPayoutLamports).toFixed(4)} SOL
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <button
                  onClick={() => handleClaim(c.marketAddress)}
                  disabled={claimingMarket === c.marketAddress}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    claimingMarket === c.marketAddress
                      ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                      : "bg-pump-green text-black hover:opacity-90"
                  }`}
                >
                  {claimingMarket === c.marketAddress ? "Claiming…" : "Claim"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transactions */}
      <div className="card-pump mb-6 border border-pump-green/40">
        <h2 className="text-xl font-bold text-white mb-3">My Transactions</h2>

        {loading ? (
          <p className="text-gray-400">Loading transactions…</p>
        ) : txRows.length === 0 ? (
          <p className="text-gray-400">No transactions yet.</p>
        ) : (
          <div className="space-y-4">
            {txRows.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-white/10 bg-pump-dark/30 p-4 flex items-center justify-between gap-6"
              >
                <div className="min-w-0">
                  <div className="text-white font-semibold">{r.title}</div>
                  <div className="text-sm text-gray-400 mt-1 truncate">
                    Market: {r.marketQuestion || shortAddr(r.marketAddress)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {r.createdAt ? r.createdAt.toLocaleString("fr-FR") : ""}
                    {r.sig ? ` • tx: ${shortSig(r.sig)}` : ""}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-pump-green font-bold">
                      {r.costSol > 0 ? `${r.costSol.toFixed(4)} SOL` : "0.0000 SOL"}
                    </div>
                  </div>

                  {r.marketAddress ? (
                    <Link
                      href={`/trade/${r.marketAddress}`}
                      className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
                    >
                      View Market
                    </Link>
                  ) : null}

                  {/* ✅ Claim button inline on transactions (only if claimable for that market) */}
                  {r.claimable?.marketAddress ? (
                    <button
                      onClick={() => handleClaim(r.claimable!.marketAddress)}
                      disabled={claimingMarket === r.claimable!.marketAddress}
                      className={`px-4 py-2 rounded-lg font-semibold transition ${
                        claimingMarket === r.claimable!.marketAddress
                          ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                          : "bg-white text-black hover:bg-gray-200"
                      }`}
                      title="Claim winnings for this market"
                    >
                      {claimingMarket === r.claimable!.marketAddress ? "Claiming…" : "Claim"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Markets */}
      <div className="card-pump">
        <h2 className="text-xl font-bold text-white mb-3">My Markets</h2>

        {loading ? (
          <p className="text-gray-400">Loading markets…</p>
        ) : myMarkets.length === 0 ? (
          <p className="text-gray-400">No markets created yet.</p>
        ) : (
          <div className="space-y-4">
            {myMarkets.map((m, idx) => {
              const addr = String(m.market_address || "");
              const q = String(m.question || "Market");
              const volSol = lamportsToSol(toNum(m.total_volume));
              const feesSol = lamportsToSol(Math.floor(toNum(m.fees_collected) / 2));

              return (
                <div
                  key={String(m.id || addr || idx)}
                  className="rounded-xl border border-white/10 bg-pump-dark/30 p-4 flex items-center justify-between gap-6"
                >
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{q}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {addr ? shortAddr(addr) : ""}
                      {m.resolved ? " • resolved" : " • active"}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-white font-semibold">{volSol.toFixed(2)} SOL vol</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Fees (est): {feesSol.toFixed(4)} SOL
                      </div>
                    </div>

                    {addr ? (
                      <Link
                        href={`/trade/${addr}`}
                        className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
                      >
                        View Market
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}