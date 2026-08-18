"use client";

import { FC, ReactNode, useCallback, useEffect, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
// Imported from the two adapter packages directly rather than from the
// aggregate @solana/wallet-adapter-wallets. Same adapter classes — but the
// aggregate pulls in every supported wallet including Trezor, whose
// @solana-program/system@^0.7 pin is incompatible with the >=0.8 Privy
// requires. Two imports instead of one, and the Trezor/Ledger trees leave
// the bundle.
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Stable endpoint selection.
 * IMPORTANT: must NOT depend on URL params, otherwise Phantom resets trust session.
 */
function pickEndpoint(): string {
  const mainnet = process.env.NEXT_PUBLIC_SOLANA_RPC_URL; // production mainnet RPC
  const devnet = process.env.NEXT_PUBLIC_SOLANA_RPC;      // dev RPC

  if (process.env.NODE_ENV === "production") {
    if (!mainnet) {
      throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC_URL in production");
    }
    return mainnet;
  }

  return devnet || mainnet || "https://api.devnet.solana.com";
}

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  /**
   * CRITICAL: endpoint must be stable (useMemo with empty deps)
   * Otherwise Phantom considers it a new app each time.
   */
  const endpoint = useMemo(() => pickEndpoint(), []);

  /**
   * CRITICAL: wallets must be stable too
   */
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  const onError = useCallback((error: Error) => {
    // Suppress MetaMask auto-connect failures (browser extension noise)
    if (error?.message?.includes("MetaMask")) return;
    console.error("Wallet error:", error);
  }, []);

  // Suppress MetaMask extension errors from triggering the Next.js dev error overlay
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const msg = String(event?.reason?.message || event?.reason || "");
      if (msg.includes("MetaMask")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};