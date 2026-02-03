"use client";

import { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

function readClusterFromUrl(): "devnet" | "mainnet-beta" | null {
  if (typeof window === "undefined") return null;
  const c = new URLSearchParams(window.location.search).get("cluster");
  if (c === "devnet") return "devnet";
  if (c === "mainnet" || c === "mainnet-beta") return "mainnet-beta";
  return null;
}

function getEndpoint(clusterOverride: "devnet" | "mainnet-beta" | null) {
  // 1) primary vars (what you intended)
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const rpcFallback = process.env.NEXT_PUBLIC_SOLANA_RPC; // you have this in Vercel

  // 2) optional dedicated cluster vars (if you add them later)
  const rpcDevnet = process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET;
  const rpcMainnet = process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET;

  let endpoint =
    clusterOverride === "devnet"
      ? (rpcDevnet || rpcFallback || rpcUrl || "https://api.devnet.solana.com")
      : clusterOverride === "mainnet-beta"
      ? (rpcMainnet || rpcUrl || rpcFallback || "https://api.mainnet-beta.solana.com")
      : (rpcUrl || rpcFallback || "https://api.devnet.solana.com");

  console.log("[RPC] cluster override =", clusterOverride);
  console.log("[RPC] NEXT_PUBLIC_SOLANA_RPC_URL =", rpcUrl);
  console.log("[RPC] NEXT_PUBLIC_SOLANA_RPC =", rpcFallback);
  console.log("[RPC] endpoint USED =", endpoint);

  // avoid silent wrong prod fallback
  if (process.env.NODE_ENV === "production" && !rpcUrl && !rpcFallback && !clusterOverride) {
    throw new Error("Missing RPC env in production");
  }

  return endpoint;
}

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const clusterOverride = useMemo(() => readClusterFromUrl(), []);
  const endpoint = useMemo(() => getEndpoint(clusterOverride), [clusterOverride]);

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};