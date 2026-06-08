"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getFunPointsBalance } from "@/lib/funPoints";
import { supabase } from "@/lib/supabaseClient";

// Reactive Fun Points balance for the header pill.
// - Reads once when the wallet changes.
// - Subscribes to the wallet's ledger rows so the pill updates after a
//   trade, daily claim, or task completion lands.
export function useFunPointsBalance(): number {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!wallet) {
      setBalance(0);
      return;
    }

    let cancelled = false;
    (async () => {
      const v = await getFunPointsBalance(wallet);
      if (!cancelled) setBalance(v);
    })();

    const channel = supabase
      .channel(`fp-ledger-${wallet}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "fun_points_ledger", filter: `wallet=eq.${wallet}` },
        async () => {
          const v = await getFunPointsBalance(wallet);
          if (!cancelled) setBalance(v);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [wallet]);

  return balance;
}
