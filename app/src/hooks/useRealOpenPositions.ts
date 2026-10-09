"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/funmarket_pump.json";
import { PROGRAM_ID } from "@/utils/solana";
import { fetchMarketsByAddresses } from "@/lib/activity";
import { realOpenPositionRows, type RealOpenPosition } from "@/lib/realPositionDisplay";

const coder = new BorshAccountsCoder(idl as Idl);

/** Public, read-only wallet holdings; no signing or transaction history estimates. */
export function useRealOpenPositions(wallet: string) {
  const { connection } = useConnection();
  const [state, setState] = useState<{ wallet: string; rows: RealOpenPosition[]; error: boolean; connection: typeof connection } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let again = false;
    const subscriptions = new Map<string, number>();
    const marketSlots = new Map<string, number>();
    const positions = new Map<string, any>();
    const markets = new Map<string, { account: any; lamports: number }>();
    const metadata = new Map<string, { question?: string | null; outcome_names?: unknown }>();
    let walletKey: PublicKey;
    try { walletKey = new PublicKey(wallet); } catch { return; }
    // UserPosition: discriminator (8), market (32), user (32).
    const filters = [{ memcmp: coder.memcmp("UserPosition") }, { memcmp: { offset: 40, bytes: wallet } }];
    const publish = () => {
      if (cancelled) return;
      const rows = Array.from(positions.entries()).flatMap(([address, position]) => {
        const market = markets.get(address);
        return market ? realOpenPositionRows(address, position, market.account, market.lamports, metadata.get(address)) : [];
      }).sort((a, b) => (b.lastTradeAt ?? "").localeCompare(a.lastTradeAt ?? ""));
      setState({ wallet, rows, error: false, connection });
    };
    const applyMarket = (address: string, info: any, slot: number) => {
      if (slot < (marketSlots.get(address) ?? -1)) return;
      marketSlots.set(address, slot);
      markets.delete(address);
      if (info?.owner.equals(PROGRAM_ID)) {
        try { markets.set(address, { account: coder.decode("Market", info.data), lamports: info.lamports }); } catch { /* omit unavailable */ }
      }
    };
    const refresh = async () => {
      if (cancelled) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters });
        if (cancelled) return;
        positions.clear();
        for (const { account } of accounts) {
          try {
            const position = coder.decode("UserPosition", account.data);
            if (position.user.equals(walletKey) && !position.claimed && position.shares.some((s: unknown) => Number(s) > 0)) {
              positions.set(position.market.toBase58(), position);
            }
          } catch { /* invalid account */ }
        }
        const addresses = Array.from(positions.keys());
        for (const [address, subscription] of Array.from(subscriptions)) {
          if (!positions.has(address)) { void connection.removeAccountChangeListener(subscription); subscriptions.delete(address); }
        }
        const rows = (await Promise.all(Array.from({ length: Math.ceil(addresses.length / 100) }, (_, i) =>
          fetchMarketsByAddresses(addresses.slice(i * 100, (i + 1) * 100)),
        ))).flat();
        if (cancelled) return;
        for (const row of rows) if (row.market_address) metadata.set(row.market_address, row);
        for (let i = 0; i < addresses.length; i += 100) {
          const batch = addresses.slice(i, i + 100);
          batch.forEach(address => {
            if (!subscriptions.has(address)) subscriptions.set(address, connection.onAccountChange(
              new PublicKey(address), (info, context) => {
                if (!cancelled) { applyMarket(address, info, context.slot); publish(); }
              }, "confirmed",
            ));
          });
          const { value: infos, context } = await connection.getMultipleAccountsInfoAndContext(batch.map(a => new PublicKey(a)), "confirmed");
          if (cancelled) return;
          batch.forEach((address, index) => applyMarket(address, infos[index], context.slot));
        }
        publish();
      } catch {
        if (!cancelled) setState({ wallet, rows: [], error: true, connection });
      } finally {
        busy = false;
        if (again && !cancelled) { again = false; void refresh(); }
      }
    };
    const subscription = connection.onProgramAccountChange(PROGRAM_ID, () => { void refresh(); }, "confirmed", filters);
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    void refresh();
    return () => {
      cancelled = true;
      void connection.removeProgramAccountChangeListener(subscription);
      subscriptions.forEach(id => { void connection.removeAccountChangeListener(id); });
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [wallet, connection]);
  return state?.wallet === wallet && state.connection === connection ? state : null;
}
