// app/src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { supabase } from "@/lib/supabaseClient";
import { useProgram } from "@/hooks/useProgram";
import { lamportsToSol, getUserPositionPDA } from "@/utils/solana";
import { outcomeLabelFromMarket } from "@/utils/outcomes";

// ---------------- helpers ----------------
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

function isMarketEnded(endDate?: string): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  return end.getTime() <= Date.now();
}

function formatTimeStatus(endDate?: string): string {
  if (!endDate) return "No end date";
  const end = new Date(endDate);
  const now = Date.now();

  if (end.getTime() <= now) return "Ended";

  const diff = end.getTime() - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return "< 1h left";
}

// ---------------- types ----------------
type DbMarket = {
  id?: string;
  market_address?: string;
  creator?: string;
  question?: string;
  total_volume?: number; // lamports
  end_date?: string;
  resolved?: boolean;
  outcome_names?: string[] | null; // ["Alice","Bob","Charlie"]
};

type DbTx = {
  id?: string;
  created_at?: string;

  market_id?: string | null;
  market_address?: string | null;

  user_address?: string | null;

  // legacy schema
  is_buy?: boolean | null;
  is_yes?: boolean | null;
  amount?: number | null;
  cost?: number | null;
  tx_signature?: string | null;

  // newer schema (optional)
  outcome_index?: number | null;
  shares?: number | null;
  outcome_name?: string | null;
};

type Claimable = {
  marketAddress: string;
  marketQuestion: string;
  estPayoutLamports?: number;
  winningIndex?: number;
};

// ---------------- data helpers ----------------
async function safeFetchUserTransactions(
  walletAddress: string,
  limit = 50
): Promise<DbTx[]> {
  // On tente d’abord avec outcome_index/shares/outcome_name,
  // sinon fallback sur le schéma legacy.
  const trySelects = [
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature,outcome_index,shares,outcome_name",
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature",
  ];

  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("transactions")
      .select(sel)
      .eq("user_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error) return (data as any[]) || [];

    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist")) {
      console.error("safeFetchUserTransactions error:", error);
      return [];
    }
  }

  return [];
}

// ---------------- component ----------------
export default function DashboardPage() {
  const { publicKey, connected } = useWallet();
  const walletBase58 = publicKey?.toBase58() || "";
  const { connection } = useConnection();
  const program = useProgram();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [loadingClaimables, setLoadingClaimables] = useState(false);

  // data
  const [myCreatedMarkets, setMyCreatedMarkets] = useState<DbMarket[]>([]);
  const [myTxs, setMyTxs] = useState<DbTx[]>([]);
  const [refMarkets, setRefMarkets] = useState<DbMarket[]>([]);

  const [claimables, setClaimables] = useState<Claimable[]>([]);
  const [claimingMarket, setClaimingMarket] = useState<string | null>(null);

  // resolve UI
  const [resolvingMarket, setResolvingMarket] = useState<DbMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  // ---------------- derived maps ----------------
  const marketsById = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of [...myCreatedMarkets, ...refMarkets]) {
      if (mk.id) m.set(mk.id, mk);
    }
    return m;
  }, [myCreatedMarkets, refMarkets]);

  const marketsByAddress = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of [...myCreatedMarkets, ...refMarkets]) {
      const addr = mk.market_address;
      if (addr) m.set(addr, mk);
    }
    return m;
  }, [myCreatedMarkets, refMarkets]);

  // ---------------- load dashboard data ----------------
  useEffect(() => {
    if (!connected || !walletBase58) {
      setErrorMsg(null);
      setMyCreatedMarkets([]);
      setMyTxs([]);
      setRefMarkets([]);
      setClaimables([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setErrorMsg(null);

      // 1) created markets
      setLoadingMarkets(true);
      try {
        const { data, error } = await supabase
          .from("markets")
          .select(
            "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names"
          )
          .eq("creator", walletBase58)
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (!cancelled)
          setMyCreatedMarkets(((data as any[]) || []) as DbMarket[]);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Failed to load markets");
        if (!cancelled) setMyCreatedMarkets([]);
      } finally {
        if (!cancelled) setLoadingMarkets(false);
      }

      // 2) txs
      setLoadingTxs(true);
      try {
        const txs = await safeFetchUserTransactions(walletBase58, 50);
        if (!cancelled) setMyTxs(txs || []);
      } catch (e: any) {
        if (!cancelled)
          setErrorMsg(e?.message || "Failed to load transactions");
        if (!cancelled) setMyTxs([]);
      } finally {
        if (!cancelled) setLoadingTxs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, walletBase58]);

  // 3) fetch referenced markets for txs (for bettors)
  useEffect(() => {
    if (!connected || !walletBase58) return;
    if (!myTxs.length) {
      setRefMarkets([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const ids = Array.from(
          new Set(myTxs.map((t) => t.market_id).filter(Boolean).map(String))
        );
        const addrs = Array.from(
          new Set(
            myTxs.map((t) => t.market_address).filter(Boolean).map(String)
          )
        );

        const out: DbMarket[] = [];

        if (ids.length) {
          const { data, error } = await supabase
            .from("markets")
            .select(
              "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names"
            )
            .in("id", ids.slice(0, 100));
          if (error) throw error;
          out.push(...(((data as any[]) || []) as DbMarket[]));
        }

        if (addrs.length) {
          const { data, error } = await supabase
            .from("markets")
            .select(
              "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names"
            )
            .in("market_address", addrs.slice(0, 100));
          if (error) throw error;
          out.push(...(((data as any[]) || []) as DbMarket[]));
        }

        // dedupe
        const byAddr = new Map<string, DbMarket>();
        for (const m of out) {
          if (m.market_address) byAddr.set(m.market_address, m);
          else if (m.id) byAddr.set(`id:${m.id}`, m);
        }

        if (!cancelled) setRefMarkets(Array.from(byAddr.values()));
      } catch (e: any) {
        console.warn("refMarkets fetch failed:", e?.message || e);
        if (!cancelled) setRefMarkets([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, walletBase58, myTxs]);

  // ---------------- stats ----------------
  const stats = useMemo(() => {
    const created = myCreatedMarkets.length;
    const volLamports = myCreatedMarkets.reduce(
      (sum, m) => sum + toNum(m.total_volume),
      0
    );
    const volSol = lamportsToSol(volLamports);
    const creatorFeesSol = volSol * 0.01; // ~1%

    return { created, volSol, creatorFeesSol };
  }, [myCreatedMarkets]);

  // ---------------- claimables (on-chain) ----------------
  useEffect(() => {
    if (!connected || !publicKey || !program) {
      setClaimables([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingClaimables(true);
      try {
        const marketAddresses: string[] = [];

        // bettors: txs
        for (const t of myTxs) {
          if (t.market_address) marketAddresses.push(String(t.market_address));
          else if (t.market_id) {
            const mk = marketsById.get(String(t.market_id));
            if (mk?.market_address)
              marketAddresses.push(String(mk.market_address));
          }
        }

        // creators: their own markets
        for (const m of myCreatedMarkets) {
          if (m.market_address)
            marketAddresses.push(String(m.market_address));
        }

        const unique = Array.from(new Set(marketAddresses)).slice(0, 50);
        const out: Claimable[] = [];

        for (const addr of unique) {
          if (cancelled) return;

          let marketPk: PublicKey;
          try {
            marketPk = new PublicKey(addr);
          } catch {
            continue;
          }

          let marketAcc: any = null;
          try {
            marketAcc = await (program as any).account.market.fetch(marketPk);
          } catch {
            continue;
          }

          const resolved = !!marketAcc?.resolved;
          const winningOpt = marketAcc?.winningOutcome;

          const winningIndex =
            winningOpt == null
              ? null
              : typeof winningOpt === "number"
              ? winningOpt
              : typeof winningOpt?.toNumber === "function"
              ? winningOpt.toNumber()
              : Number(winningOpt);

          if (!resolved || winningIndex == null || !Number.isFinite(winningIndex))
            continue;

          const [posPda] = getUserPositionPDA(marketPk, publicKey);

          let posAcc: any = null;
          try {
            posAcc = await (program as any).account.userPosition.fetch(posPda);
          } catch {
            continue;
          }

          if (posAcc?.claimed) continue;

          const sharesArr = Array.isArray(posAcc?.shares)
            ? posAcc.shares.map((x: any) =>
                typeof x === "number"
                  ? x
                  : typeof x?.toNumber === "function"
                  ? x.toNumber()
                  : Number(x || 0)
              )
            : [];

          const winningShares = Math.floor(
            Number(sharesArr[winningIndex] || 0)
          );
          if (winningShares <= 0) continue;

          const totalWinningSupply = Array.isArray(marketAcc?.outcomeSupplies)
            ? Number(
                typeof marketAcc.outcomeSupplies[winningIndex] === "number"
                  ? marketAcc.outcomeSupplies[winningIndex]
                  : typeof marketAcc.outcomeSupplies[winningIndex]?.toNumber ===
                    "function"
                  ? marketAcc.outcomeSupplies[winningIndex].toNumber()
                  : marketAcc.outcomeSupplies[winningIndex] || 0
              )
            : 0;

          let estPayoutLamports: number | undefined = undefined;
          if (totalWinningSupply > 0) {
            const bal = await connection.getBalance(marketPk);
            const payout =
              (BigInt(winningShares) * BigInt(bal)) /
              BigInt(Math.floor(totalWinningSupply));
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
      } catch (e) {
        if (!cancelled) setClaimables([]);
      } finally {
        if (!cancelled) setLoadingClaimables(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connected,
    publicKey,
    program,
    connection,
    myTxs,
    myCreatedMarkets,
    marketsById,
    marketsByAddress,
  ]);

  // ---------------- handlers ----------------
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
        `Claim success 🎉\n\nTx: ${sig.slice(
          0,
          16
        )}...\n\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`
      );

      setClaimables((prev) =>
        prev.filter((c) => c.marketAddress !== marketAddress)
      );
    } catch (e: any) {
      alert(`Claim failed: ${e?.message || "Unknown error"}`);
    } finally {
      setClaimingMarket(null);
    }
  }

  async function handleResolve() {
    if (
      !connected ||
      !publicKey ||
      !program ||
      !resolvingMarket ||
      selectedOutcome === null
    )
      return;

    const marketAddress = resolvingMarket.market_address;
    if (!marketAddress) return;

    try {
      setResolveLoading(true);

      const marketPk = new PublicKey(marketAddress);

      const sig = await (program as any).methods
        .resolveMarket(selectedOutcome)
        .accounts({
          market: marketPk,
          creator: publicKey,
        })
        .rpc();

      const labels = resolvingMarket.outcome_names || ["YES", "NO"];
      alert(
        `Market resolved! 🎉\n\nWinning outcome: ${
          labels[selectedOutcome] || `Option ${selectedOutcome + 1}`
        }\n\nTx: ${sig.slice(
          0,
          16
        )}...\n\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`
      );

      // update local state
      setMyCreatedMarkets((prev) =>
        prev.map((m) =>
          m.market_address === marketAddress ? { ...m, resolved: true } : m
        )
      );

      // update Supabase (best-effort)
      try {
        await supabase
          .from("markets")
          .update({ resolved: true, winning_outcome: selectedOutcome } as any)
          .eq("market_address", marketAddress);
      } catch {
        /* ignore */
      }

      setResolvingMarket(null);
      setSelectedOutcome(null);
    } catch (e: any) {
      alert(`Resolution failed: ${e?.message || "Unknown error"}`);
    } finally {
      setResolveLoading(false);
    }
  }

  // ---------------- UI derived ----------------
  const walletLabel = useMemo(() => shortAddr(walletBase58), [walletBase58]);

  const txRows = useMemo(() => {
    return myTxs.map((t) => {
      const mk =
        (t.market_id && marketsById.get(String(t.market_id))) ||
        (t.market_address && marketsByAddress.get(String(t.market_address))) ||
        null;

      const marketAddress = (mk?.market_address || t.market_address || "") as string;
      const marketQuestion = (mk?.question || "(Market)") as string;

      const side = t.is_buy ? "BUY" : "SELL";

      const shares =
        t.shares != null
          ? Math.floor(toNum(t.shares))
          : Math.floor(toNum(t.amount)); // legacy

      const names = (mk?.outcome_names || null) as string[] | null;

      const outcomeIndex =
        t.outcome_index != null
          ? Number(t.outcome_index)
          : t.is_yes == null
          ? null
          : t.is_yes
          ? 0
          : 1;

      const pseudoMarket = { outcome_names: names };

      const outcomeLabel = outcomeLabelFromMarket(pseudoMarket, {
        outcomeIndex,
        isYes: t.is_yes,
        txOutcomeName: t.outcome_name ?? null,
      });

      const title = `${side} • ${outcomeLabel} • ${shares} shares`;
      const costSol = toNum(t.cost);
      const createdAt = t.created_at ? new Date(t.created_at) : null;

      return {
        id: String(t.id || t.tx_signature || Math.random()),
        title,
        marketAddress,
        marketQuestion,
        sig: String(t.tx_signature || ""),
        costSol,
        createdAt,
      };
    });
  }, [myTxs, marketsById, marketsByAddress]);

  // ---------------- render ----------------
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

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Markets created</div>
          <div className="text-3xl font-bold text-white">
            {loadingMarkets ? "…" : stats.created}
          </div>
        </div>

        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Volume (your markets)</div>
          <div className="text-3xl font-bold text-white">
            {loadingMarkets ? "…" : `${stats.volSol.toFixed(2)} SOL`}
          </div>
        </div>

        <div className="card-pump">
          <div className="text-xs text-gray-500 mb-2">Fees earned (est.)</div>
          <div className="text-3xl font-bold text-white">
            {loadingMarkets ? "…" : `${stats.creatorFeesSol.toFixed(4)} SOL`}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            ~1% of volume (creator) unless total fees are stored
          </div>
        </div>
      </div>

      {/* Claimable Winnings */}
      <div className="card-pump mb-6">
        <h2 className="text-xl font-bold text-white mb-2">🏆 Claimable Winnings</h2>

        {loadingClaimables ? (
          <p className="text-gray-400">Checking claimables…</p>
        ) : claimables.length === 0 ? (
          <p className="text-gray-400">No claimable winnings found yet.</p>
        ) : (
          <div className="space-y-3">
            {claimables.map((c) => (
              <div
                key={c.marketAddress}
                className="rounded-xl border border-pump-green/30 bg-pump-green/5 p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-white font-semibold truncate">
                    {c.marketQuestion}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {shortAddr(c.marketAddress)}
                    {typeof c.estPayoutLamports === "number" && (
                      <>
                        {" • "}
                        <span className="text-pump-green font-semibold">
                          ~{lamportsToSol(c.estPayoutLamports).toFixed(4)} SOL
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleClaim(c.marketAddress)}
                  disabled={claimingMarket === c.marketAddress}
                  className={`px-5 py-2 rounded-lg font-semibold transition ${
                    claimingMarket === c.marketAddress
                      ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                      : "bg-pump-green text-black hover:opacity-90"
                  }`}
                >
                  {claimingMarket === c.marketAddress ? "Claiming…" : "💰 Claim"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Transactions */}
      <div className="card-pump mb-6">
        <h2 className="text-xl font-bold text-white mb-3">My Transactions</h2>

        {loadingTxs ? (
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
                    {r.sig && (
                      <>
                        {" • "}
                        <a
                          href={`https://explorer.solana.com/tx/${r.sig}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-pump-green hover:underline"
                        >
                          tx: {shortSig(r.sig)}
                        </a>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-pump-green font-bold">
                      {r.costSol > 0 ? `${r.costSol.toFixed(4)} SOL` : "0.0000 SOL"}
                    </div>
                  </div>

                  {r.marketAddress && (
                    <Link
                      href={`/trade/${r.marketAddress}`}
                      className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
                    >
                      View
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Markets (creator only) */}
      <div className="card-pump">
        <h2 className="text-xl font-bold text-white mb-3">My Markets</h2>

        {loadingMarkets ? (
          <p className="text-gray-400">Loading markets…</p>
        ) : myCreatedMarkets.length === 0 ? (
          <p className="text-gray-400">No markets created yet.</p>
        ) : (
          <div className="space-y-4">
            {myCreatedMarkets.map((m, idx) => {
              const addr = String(m.market_address || "");
              const q = String(m.question || "Market");
              const volSol = lamportsToSol(toNum(m.total_volume));

              const ended = isMarketEnded(m.end_date);
              const canResolve = !m.resolved && ended;
              const timeStatus = formatTimeStatus(m.end_date);

              return (
                <div
                  key={String(m.id || addr || idx)}
                  className={`rounded-xl border p-4 flex items-center justify-between gap-6 ${
                    m.resolved
                      ? "border-gray-600 bg-gray-800/30"
                      : canResolve
                      ? "border-yellow-500/50 bg-yellow-500/5"
                      : "border-white/10 bg-pump-dark/30"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{q}</div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                      <span>{addr ? shortAddr(addr) : ""}</span>
                      <span>•</span>
                      {m.resolved ? (
                        <span className="text-green-400">✓ Resolved</span>
                      ) : (
                        <span
                          className={
                            ended ? "text-yellow-400" : "text-gray-400"
                          }
                        >
                          {timeStatus}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-white font-semibold">
                        {volSol.toFixed(2)} SOL
                      </div>
                    </div>

                    {canResolve && (
                      <button
                        onClick={() => {
                          setResolvingMarket(m);
                          setSelectedOutcome(null);
                        }}
                        className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold hover:bg-yellow-400 transition"
                      >
                        ⚖️ Resolve
                      </button>
                    )}

                    {addr && (
                      <Link
                        href={`/trade/${addr}`}
                        className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
                      >
                        View
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resolve Modal */}
      {resolvingMarket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-pump-dark border border-white/20 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Resolve Market</h3>
            <p className="text-gray-400 text-sm mb-4 truncate">
              {resolvingMarket.question}
            </p>

            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                Select winning outcome:
              </label>
              <div className="space-y-2">
                {(resolvingMarket.outcome_names || ["YES", "NO"]).map(
                  (label, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedOutcome(idx)}
                      className={`w-full p-3 rounded-lg border text-left transition ${
                        selectedOutcome === idx
                          ? "border-pump-green bg-pump-green/20 text-white"
                          : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40"
                      }`}
                    >
                      <span className="font-semibold">{label}</span>
                      {selectedOutcome === idx && (
                        <span className="float-right text-pump-green">✓</span>
                      )}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setResolvingMarket(null);
                  setSelectedOutcome(null);
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-gray-300 hover:bg-white/10 transition"
              >
                Cancel
              </button>

              <button
                onClick={handleResolve}
                disabled={selectedOutcome === null || resolveLoading}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition ${
                  selectedOutcome === null || resolveLoading
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-yellow-500 text-black hover:bg-yellow-400"
                }`}
              >
                {resolveLoading ? "Resolving…" : "Confirm Resolution"}
              </button>
            </div>

            <p className="text-xs text-red-400 mt-4 text-center">
              ⚠️ This action is irreversible. Make sure you select the correct
              outcome.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}