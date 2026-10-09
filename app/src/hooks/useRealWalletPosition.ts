"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/funmarket_pump.json";
import { getUserPositionPDA, PROGRAM_ID } from "@/utils/solana";

const coder = new BorshAccountsCoder(idl as Idl);

/** Current holdings only. Market pricing continues to use Trade's existing subscription. */
export function useRealWalletPosition(market: string, wallet: string | null, enabled: boolean) {
  const { connection } = useConnection();
  const key = JSON.stringify([market, wallet, enabled]);
  const [state, setState] = useState<{ key: string; shares: number[] } | null>(null);
  useEffect(() => {
    if (!enabled || !wallet || !market) return;
    let cancelled = false;
    let latestSlot = -1;
    let subscription: number;
    try {
      const marketKey = new PublicKey(market);
      const walletKey = new PublicKey(wallet);
      const [address] = getUserPositionPDA(marketKey, walletKey);
      const apply = (info: any, context: { slot: number }) => {
        if (cancelled || context.slot < latestSlot) return;
        latestSlot = context.slot;
        let shares: number[] = [];
        try {
          if (info?.owner.equals(PROGRAM_ID)) {
            const position = coder.decode("UserPosition", info.data);
            if (position.user.equals(walletKey) && position.market.equals(marketKey) && !position.claimed) shares = position.shares.map(Number);
          }
        } catch { /* unavailable holdings clear the old estimate */ }
        setState({ key, shares });
      };
      const refresh = () => {
        void connection.getAccountInfoAndContext(address, "confirmed").then(({ value, context }) => apply(value, context)).catch(() => {
          if (!cancelled) setState(null);
        });
      };
      subscription = connection.onAccountChange(address, apply, "confirmed");
      refresh();
      window.addEventListener("focus", refresh);
      return () => {
        cancelled = true;
        void connection.removeAccountChangeListener(subscription);
        window.removeEventListener("focus", refresh);
      };
    } catch { return; }
  }, [key, market, wallet, enabled, connection]);
  return state?.key === key ? state.shares : [];
}
