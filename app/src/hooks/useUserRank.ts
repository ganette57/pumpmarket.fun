"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getUserRank } from "@/lib/leaderboard";

// Thin wrapper around the leaderboard getUserRank helper. Returns the
// connected wallet's rank, or null when disconnected / unranked. Rank
// logic itself lives in lib/leaderboard.ts — this only handles the
// wallet wiring so heroes don't duplicate it.
export function useUserRank(): number | null {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet) {
      setRank(null);
      return;
    }
    let cancelled = false;
    getUserRank(wallet)
      .then((r) => { if (!cancelled) setRank(r?.rank ?? null); })
      .catch(() => { if (!cancelled) setRank(null); });
    return () => { cancelled = true; };
  }, [wallet]);

  return rank;
}
