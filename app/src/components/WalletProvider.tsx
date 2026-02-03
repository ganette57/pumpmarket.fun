"use client";

import { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useSearchParams } from "next/navigation";
import "@solana/wallet-adapter-react-ui/styles.css";

function pickEndpoint(cluster: string | null) {
  const mainnet = process.env.NEXT_PUBLIC_SOLANA_RPC_URL; // prod = mainnet helius
  const devnet = process.env.NEXT_PUBLIC_SOLANA_RPC;     // all envs = devnet helius (chez toi)

  const c = (cluster || "").toLowerCase();

  // cluster override
  if (c === "devnet") {
    return devnet || "https://api.devnet.solana.com";
  }

  // default: mainnet (prod)
  if (process.env.NODE_ENV === "production") {
    if (!mainnet) throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC_URL in production");
    return mainnet;
  }

  // dev fallback
  return devnet || mainnet || "https://api.devnet.solana.com";
}

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const sp = useSearchParams();
  const cluster = sp.get("cluster"); // ex: ?cluster=devnet

  const endpoint = useMemo(() => pickEndpoint(cluster), [cluster]);

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};