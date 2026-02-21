export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

const EXPLORER_BASE = "https://explorer.solana.com";

export function getSolanaCluster(): SolanaCluster {
  const raw = String(process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "")
    .trim()
    .toLowerCase();

  if (raw === "mainnet") return "mainnet-beta";
  if (raw === "mainnet-beta" || raw === "devnet" || raw === "testnet") return raw;
  return "mainnet-beta";
}

function withCluster(path: string): string {
  const cluster = getSolanaCluster();
  if (cluster === "mainnet-beta") return `${EXPLORER_BASE}${path}`;
  return `${EXPLORER_BASE}${path}?cluster=${cluster}`;
}

// Sanity check:
// - mainnet-beta => https://explorer.solana.com/tx/<sig>
// - devnet/testnet => https://explorer.solana.com/tx/<sig>?cluster=<cluster>
export function solanaExplorerTxUrl(signature: string): string {
  return withCluster(`/tx/${signature}`);
}

export function solanaExplorerAddressUrl(address: string): string {
  return withCluster(`/address/${address}`);
}

export function solanaExplorerAccountUrl(address: string): string {
  return solanaExplorerAddressUrl(address);
}
