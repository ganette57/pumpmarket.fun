// src/lib/privyChain.ts
//
// The translation layer between FunMarket's Solana cluster naming and
// Privy's CAIP-2 chain identifiers.
//
// FunMarket has said "mainnet-beta" | "devnet" | "testnet" since before
// Privy existed (see utils/explorer.ts, lib/solanaCluster.ts). Privy's
// Solana hooks want "solana:mainnet" | "solana:devnet" | "solana:testnet".
// Rather than sprinkle that mapping through every signing call site, it
// lives here once.
//
// Nothing in this file is Privy-specific enough to import Privy: it is
// plain strings and URLs, so it stays usable from server code and from
// tests without pulling the SDK into the bundle.

import { getSolanaCluster, type SolanaCluster } from "@/utils/explorer";

/** Exactly the three values Privy's `SolanaChain` union permits. */
export type PrivySolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

export function toPrivyChain(cluster: SolanaCluster): PrivySolanaChain {
  if (cluster === "devnet") return "solana:devnet";
  if (cluster === "testnet") return "solana:testnet";
  return "solana:mainnet";
}

/**
 * The chain every Real transaction is signed against.
 *
 * Derived from NEXT_PUBLIC_SOLANA_CLUSTER — the SAME source the Anchor
 * program id, the explorer links and the RPC endpoint already use. A
 * mismatch here would mean signing a devnet transaction as mainnet, so it
 * deliberately has no independent env var of its own.
 */
export function activePrivyChain(): PrivySolanaChain {
  return toPrivyChain(getSolanaCluster());
}

/** True only on Solana mainnet-beta. The one network test the UI needs. */
export function isMainnet(): boolean {
  return getSolanaCluster() === "mainnet-beta";
}

/**
 * Human label for the network the app is pointed at. Shown on the receive
 * screen so nobody sends mainnet SOL to a devnet-funded session (or the
 * reverse) because the UI never said which one they were looking at.
 */
export function solanaNetworkLabel(): string {
  const cluster = getSolanaCluster();
  if (cluster === "devnet") return "Solana Devnet";
  if (cluster === "testnet") return "Solana Testnet";
  return "Solana mainnet";
}

/* -------------------------------------------------------------------------- */
/*  Fiat onramp                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The chain Privy's fiat onramp buys on.
 *
 * The `solana:mainnet` ALIAS, not the genesis hash. Both forms exist in the
 * SDK — `solana.mjs` maps the alias to `solana:5eykt4Us…Kvdp` internally for
 * the Wallet Standard layer — but the alias is the caller-facing form, it is
 * what Privy's own asset registry keys on, and it is what the onramp docs
 * use. Confirmed at runtime: this value reached the provider UI.
 *
 * Deliberately mainnet-only and NOT derived from the active cluster: a fiat
 * onramp buys real SOL. There is no devnet equivalent to fall back to, and a
 * constant that silently followed the cluster would be an invitation to ship
 * a devnet build that spends real money. The devnet guard lives in
 * AddFundsModal; this constant simply has no devnet form to offer it.
 */
export const ONRAMP_SOLANA_MAINNET_CHAIN = "solana:mainnet";

/**
 * The asset identifier for native SOL: the ticker, not a mint address.
 *
 * This was previously the wrapped-SOL mint, reasoned from Privy's balance
 * registry (which keys tokens by mint) and from the EVM doc example (which
 * passes a contract address). Both were the wrong vocabulary: Privy's own
 * Solana funding path builds `asset: "SOL"`, and the Stripe branch forwards
 * `destination.asset` straight into `destination_currency`, which wants a
 * currency code.
 *
 * VERIFIED AT RUNTIME against an authenticated embedded wallet: "SOL" +
 * `solana:mainnet` was accepted far enough to render the provider's Buy SOL
 * UI, and the only rejection was the user closing it ("User exited flow").
 * No purchase was made.
 */
export const ONRAMP_SOL_ASSET = "SOL";

/**
 * The RPC endpoint the app already talks to.
 *
 * Mirrors pickEndpoint() in components/WalletProvider.tsx exactly, because
 * Privy and the wallet-adapter ConnectionProvider MUST agree: a Privy
 * wallet simulating against one cluster while our Connection broadcasts to
 * another is a silent, confusing failure.
 */
export function solanaHttpEndpoint(): string {
  const mainnet = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const devnet = process.env.NEXT_PUBLIC_SOLANA_RPC;

  if (process.env.NODE_ENV === "production") {
    if (!mainnet) throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC_URL in production");
    return mainnet;
  }
  return devnet || mainnet || "https://api.devnet.solana.com";
}

/**
 * The websocket twin of the HTTP endpoint.
 *
 * Privy's `config.solana.rpcs` wants both a `Rpc` and an
 * `RpcSubscriptions`. Providers publish the subscription endpoint at the
 * same host over wss, so deriving it beats adding a second env var that
 * can drift out of sync with the first.
 */
export function solanaWsEndpoint(): string {
  const http = solanaHttpEndpoint();
  if (http.startsWith("https://")) return `wss://${http.slice("https://".length)}`;
  if (http.startsWith("http://")) return `ws://${http.slice("http://".length)}`;
  return http;
}
