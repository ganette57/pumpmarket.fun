"use client";

// src/hooks/useSolBalance.ts
//
// The ONE place the UI reads the connected wallet's native SOL balance.
//
// It exists because nothing else in the app owned that number: every page
// that needed lamports called connection.getBalance() inline for its own
// purposes. The header pill needs it on every Real-mode screen, so it gets
// a single hook instead of a fetch copied into each header.
//
// Native SOL only — no SPL token accounts, by design.
//
// The `enabled` flag is what keeps this cheap: in Play mode the hook never
// touches the RPC at all, exactly as PlaySessionProvider never touches a
// Play endpoint while in Real mode.
//
// It reads the ACTIVE FunMarket wallet, not the wallet adapter, so the
// figure always belongs to the account a Real trade would actually spend
// from — Privy embedded or external. Switching the active wallet reruns
// the effect and clears the old number before the new read starts, so a
// Phantom balance can never linger under a Privy address.

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";

/** How often to re-read while the tab is visible. */
const POLL_MS = 60_000;

export type SolBalanceState = {
  /** Raw lamports. Null until known — never 0 as a stand-in for "unknown". */
  lamports: number | null;
  /** A read is in flight and no value is known yet. */
  loading: boolean;
  /**
   * Re-read now, out of band with the poll.
   *
   * Exists for one caller: returning from the funding flow, where waiting
   * up to POLL_MS to see money that has already landed feels broken. It
   * runs the SAME read against the SAME connection and writes the SAME
   * state as the poll — deliberately not a second balance source.
   *
   * Safe to call when disabled or disconnected: it no-ops.
   */
  refresh: () => void;
};

export function useSolBalance({ enabled = true }: { enabled?: boolean } = {}): SolBalanceState {
  const { connection } = useConnection();
  const { publicKey, connected, address: wallet } = useFunMarketWallet();

  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  // Points at the live effect's read(). Held in a ref so refresh() has a
  // stable identity and cannot re-trigger the effect that defines it.
  const readRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(() => {
    readRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || !connected || !publicKey) {
      // Disconnected, or Play mode took over: there is no account for a
      // balance to belong to, so drop the figure rather than leaving it up.
      setLamports(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Clear BEFORE the read, not after it resolves. This effect also reruns
    // when the user switches wallets, and the previous wallet's lamports
    // would otherwise stay on screen for the whole round trip — a real
    // balance, shown under the wrong account.
    setLamports(null);
    setLoading(true);

    async function read() {
      if (!publicKey) return;
      try {
        const value = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) setLamports(value);
      } catch {
        // A failed poll leaves the last value for THIS wallet in place. A
        // failed first read has nothing to fall back on — the pre-read clear
        // above already emptied it — so the pill shows its placeholder.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    readRef.current = () => void read();
    void read();

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void read();
    }, POLL_MS);

    return () => {
      cancelled = true;
      readRef.current = null;
      clearInterval(timer);
    };
    // `wallet` (the base58 string) rather than publicKey: the PublicKey
    // object identity changes on every adapter update and would restart the
    // poll continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, connected, wallet, connection]);

  return { lamports, loading, refresh };
}
