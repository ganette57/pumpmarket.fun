"use client";

import { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

function getEndpoint() {
  const env = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

  // ✅ In prod: no silent fallback
  if (process.env.NODE_ENV === "production" && !env) {
    throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC_URL in production");
  }

  // ✅ Dev fallback
  return env || "https://api.devnet.solana.com";
}

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const endpoint = useMemo(() => getEndpoint(), []);

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};