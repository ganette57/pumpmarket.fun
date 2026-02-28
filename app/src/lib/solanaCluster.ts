import { Connection, PublicKey } from "@solana/web3.js";
import { getSolanaCluster, type SolanaCluster } from "@/utils/explorer";

const NEXT_PUBLIC_PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || "";
const NEXT_PUBLIC_PROGRAM_ID_MAINNET = process.env.NEXT_PUBLIC_PROGRAM_ID_MAINNET || "";
const NEXT_PUBLIC_PROGRAM_ID_DEVNET = process.env.NEXT_PUBLIC_PROGRAM_ID_DEVNET || "";
const NEXT_PUBLIC_PROGRAM_ID_TESTNET = process.env.NEXT_PUBLIC_PROGRAM_ID_TESTNET || "";

const NEXT_PUBLIC_SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "";
const NEXT_PUBLIC_SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "";
const NEXT_PUBLIC_RPC_MAINNET = process.env.NEXT_PUBLIC_RPC_MAINNET || "";
const NEXT_PUBLIC_RPC_DEVNET = process.env.NEXT_PUBLIC_RPC_DEVNET || "";
const NEXT_PUBLIC_RPC_TESTNET = process.env.NEXT_PUBLIC_RPC_TESTNET || "";

function normalizeCluster(raw: unknown): SolanaCluster | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "mainnet" || s === "mainnet-beta") return "mainnet-beta";
  if (s === "devnet") return "devnet";
  if (s === "testnet") return "testnet";
  return null;
}

export function getClusterFromContest(contestOrMarket: any): SolanaCluster {
  const fromRow =
    normalizeCluster(contestOrMarket?.cluster) ||
    normalizeCluster(contestOrMarket?.chain);
  return fromRow || getSolanaCluster();
}

export function getProgramIdForCluster(cluster: SolanaCluster): PublicKey {
  const fallback = NEXT_PUBLIC_PROGRAM_ID;
  const byCluster =
    cluster === "devnet"
      ? NEXT_PUBLIC_PROGRAM_ID_DEVNET
      : cluster === "mainnet-beta"
      ? NEXT_PUBLIC_PROGRAM_ID_MAINNET
      : NEXT_PUBLIC_PROGRAM_ID_TESTNET;
  const value = byCluster || fallback;
  if (!value) throw new Error(`Missing program id for ${cluster}`);
  return new PublicKey(value);
}

export function getRpcForCluster(cluster: SolanaCluster): string {
  const byCluster =
    cluster === "devnet"
      ? NEXT_PUBLIC_RPC_DEVNET || NEXT_PUBLIC_SOLANA_RPC
      : cluster === "mainnet-beta"
      ? NEXT_PUBLIC_RPC_MAINNET || NEXT_PUBLIC_SOLANA_RPC_URL
      : NEXT_PUBLIC_RPC_TESTNET;

  if (byCluster) return byCluster;
  if (cluster === "devnet") return "https://api.devnet.solana.com";
  if (cluster === "testnet") return "https://api.testnet.solana.com";
  return "https://api.mainnet-beta.solana.com";
}

export function getConnectionForCluster(cluster: SolanaCluster): Connection {
  return new Connection(getRpcForCluster(cluster), "confirmed");
}

export function inferClusterFromRpcEndpoint(endpoint: string): SolanaCluster | null {
  const e = String(endpoint || "").toLowerCase();
  if (!e) return null;
  if (e.includes("devnet")) return "devnet";
  if (e.includes("testnet")) return "testnet";
  if (e.includes("mainnet")) return "mainnet-beta";
  return null;
}
