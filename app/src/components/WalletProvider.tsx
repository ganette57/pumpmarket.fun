"use client";

import { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
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

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};