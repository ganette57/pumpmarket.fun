"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { useProgram } from "@/hooks/useProgram";
import { getUserPositionPDA, PROGRAM_ID } from "@/utils/solana";
import { supabase } from "@/lib/supabaseClient";
import { parseBLamports, realQuote, type RealQuote } from "@/lib/realTradeQuote";

type Snapshot = { base: number; pool: number; supplies: number[]; holdings: number[] };
type Request = { address: string; deliver: (snapshot: Snapshot | null) => void };
// Batch mounted cards against the SAME connection and Anchor coder as Trade.
const queues = new Map<object, Map<string, Request[]>>();
function enqueue(connection: ReturnType<typeof useConnection>["connection"], program: NonNullable<ReturnType<typeof useProgram>>,
  wallet: PublicKey, request: Request) {
  let groups = queues.get(connection);
  if (!groups) { groups = new Map(); queues.set(connection, groups); }
  const key = wallet.toBase58();
  const current = groups.get(key);
  if (current) { current.push(request); return; }
  const requests = [request];
  groups.set(key, requests);
  setTimeout(async () => {
    groups!.delete(key);
    const addresses = Array.from(new Set(requests.map(r => r.address)));
    const snapshots = new Map<string, Snapshot>();
    try {
      for (let start = 0; start < addresses.length; start += 50) {
        const batch = addresses.slice(start, start + 50);
        const keys = batch.flatMap(address => {
          const market = new PublicKey(address);
          return [market, getUserPositionPDA(market, wallet)[0]];
        });
        const [infos, rows] = await Promise.all([
          connection.getMultipleAccountsInfo(keys, "confirmed"),
          supabase.from("markets").select("*").in("market_address", batch),
        ]);
        if (rows.error) throw rows.error;
        batch.forEach((address, i) => {
          try {
            const info = infos[i * 2], positionInfo = infos[i * 2 + 1];
            if (!info || !info.owner.equals(PROGRAM_ID)) return;
            const market = program.coder.accounts.decode("market", info.data) as any;
            const row = rows.data?.find(r => r.market_address === address);
            if (!row || row.is_blocked || row.resolved || row.cancelled || market.resolved || market.cancelled) return;
            const count = Number(market.outcomeCount);
            if (count < 2 || count > 10 || !("open" in market.status) || Number(market.resolutionTime) <= Date.now() / 1000) return;
            let holdings = Array(count).fill(0);
            if (positionInfo) {
              if (!positionInfo.owner.equals(PROGRAM_ID)) return;
              const position = program.coder.accounts.decode("userPosition", positionInfo.data) as any;
              if (!position.market.equals(keys[i * 2]) || !position.user.equals(wallet)) return;
              holdings = position.shares.slice(0, count).map(Number);
            }
            snapshots.set(address, { base: parseBLamports(row)!, pool: info.lamports,
              supplies: market.q.slice(0, count).map(Number), holdings });
          } catch { /* Invalid data cannot produce a quote. */ }
        });
      }
    } catch { /* RPC unavailable: omit, never invent a quote. */ }
    requests.forEach(r => r.deliver(snapshots.get(r.address) ?? null));
  }, 40);
}

export function useRealQuotes(address: string, enabled: boolean, revision: string,
  input: { shares: number } | { budget: number } = { budget: 1e9 },
  options: { expectedSupplies?: number[] } = {}) {
  const { connection } = useConnection();
  const program = useProgram();
  const wallet = useFunMarketWallet();
  const identity = wallet.connected ? wallet.publicKey?.toBase58() ?? null : null;
  const [positionRevision, setPositionRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.mode === "real" && detail.marketAddress === address) setPositionRevision(v => v + 1);
    };
    window.addEventListener("market-position-invalidated", refresh);
    return () => window.removeEventListener("market-position-invalidated", refresh);
  }, [address]);
  const key = JSON.stringify([address, enabled, revision, identity, positionRevision]);
  const [result, setResult] = useState<{ key: string; snapshot: Snapshot | null } | null>(null);
  useEffect(() => {
    setResult(null);
    if (!enabled || !address || !identity || !program) return;
    let cancelled = false;
    enqueue(connection, program, new PublicKey(identity), { address, deliver: snapshot => {
      if (!cancelled) setResult({ key, snapshot });
    } });
    return () => { cancelled = true; };
  }, [address, enabled, identity, key, connection, program]);
  const snapshot = result?.key === key && result.snapshot &&
    (!options.expectedSupplies ||
      result.snapshot.supplies.length === options.expectedSupplies.length &&
      result.snapshot.supplies.every((value, index) => value === options.expectedSupplies?.[index]))
    ? result.snapshot
    : null;
  // Input changes calculate synchronously from one snapshot: no previous quote frame.
  return snapshot ? snapshot.supplies.map((s, i): RealQuote | null =>
    realQuote(snapshot.base, s, snapshot.pool, snapshot.holdings[i], input)) : [];
}
