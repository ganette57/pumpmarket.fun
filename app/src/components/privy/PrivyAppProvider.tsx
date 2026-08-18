"use client";

// src/components/privy/PrivyAppProvider.tsx
//
// FunMarket's single mount point for Privy.
//
// It sits ABOVE the Solana wallet-adapter provider in the tree, because
// the unified wallet (components/wallet/FunMarketWalletProvider) reads
// both and needs Privy's state to already exist when it renders.
//
// GRACEFUL ABSENCE
// ----------------
// With no NEXT_PUBLIC_PRIVY_APP_ID set, this renders children untouched
// rather than throwing. That is deliberate: a developer who has not yet
// created a Privy app — or a preview deploy without the env var — still
// gets a working app on the legacy wallet-adapter path. Every Privy
// consumer downstream already tolerates "no Privy user", so the only
// thing lost is Google login. Failing hard here would take the whole site
// down over a missing onboarding option.
//
// WHAT IS AND IS NOT CONFIGURED HERE
// ----------------------------------
// This file decides identity and wallet creation. It does NOT decide how
// a Real transaction is signed — that is FunMarketWalletProvider's job —
// and it does not know anything about Play.

import { useMemo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  activePrivyChain,
  solanaHttpEndpoint,
  solanaWsEndpoint,
} from "@/lib/privyChain";
import {
  PrivyIdentityAbsent,
  PrivyIdentityBridge,
} from "@/components/privy/PrivyIdentityProvider";
import PrivyBoundary from "@/components/privy/PrivyBoundary";

/** Public identifiers only. Never a Privy app SECRET — that is server-side. */
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || "";

export function isPrivyConfigured(): boolean {
  return PRIVY_APP_ID.length > 0;
}

export default function PrivyAppProvider({ children }: { children: ReactNode }) {
  // The RPC clients are built once. Rebuilding them on every render would
  // hand Privy a new transport each time — the same stability rule that
  // makes WalletProvider memoize its endpoint with empty deps.
  const config = useMemo(() => {
    const chain = activePrivyChain();

    return {
      // Google is the headline path; `wallet` keeps the Privy-native
      // Solana connect flow available to crypto users who prefer it.
      loginMethods: ["google", "wallet"] as const,

      appearance: {
        theme: "dark" as const,
        // FunMarket is Solana-only. Without this, Privy's wallet list
        // offers Ethereum wallets that can never sign for our program.
        walletChainType: "solana-only" as const,
        // Google first: the normal user should not have to look past a
        // wall of wallet logos to find the button meant for them.
        showWalletLoginFirst: false,
        logo: "/favicon/apple-touch-icon.png",
      },

      // Every authenticated user gets a Solana embedded wallet, including
      // one who linked Phantom — Play identity and Real custody are
      // separate concerns, and the embedded wallet is what makes "Google
      // login is enough" true.
      embeddedWallets: {
        solana: { createOnLogin: "all-users" as const },
      },

      externalWallets: {
        solana: { connectors: toSolanaWalletConnectors() },
      },

      // Only consulted by Privy's own transaction UIs. FunMarket signs
      // with useSignTransaction() and broadcasts over its own Connection,
      // so this exists to keep Privy's simulation on the same cluster the
      // app actually trades on.
      solana: {
        rpcs: {
          [chain]: {
            rpc: createSolanaRpc(solanaHttpEndpoint()),
            rpcSubscriptions: createSolanaRpcSubscriptions(solanaWsEndpoint()),
          },
        },
      },
    };
  }, []);

  if (!PRIVY_APP_ID) {
    return <PrivyIdentityAbsent>{children}</PrivyIdentityAbsent>;
  }

  return (
    // Catches Privy failing after the app is up and degrades to the same
    // tree the no-app-id branch above renders. It does NOT rescue an
    // invalid app id — that throws during the server render, which Next
    // intercepts first. See PrivyBoundary for the whole story.
    <PrivyBoundary fallback={<PrivyIdentityAbsent>{children}</PrivyIdentityAbsent>}>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        clientId={PRIVY_CLIENT_ID || undefined}
        config={config as never}
      >
        {/* Identity is republished through our own context so nothing below
            this point imports the Privy SDK. */}
        <PrivyIdentityBridge>{children}</PrivyIdentityBridge>
      </PrivyProvider>
    </PrivyBoundary>
  );
}
