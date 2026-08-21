"use client";

// src/components/privy/PrivyIdentityProvider.tsx
//
// Who the user is, according to Privy — and nothing else.
//
// This exists so that no component outside src/components/privy/ has to
// import the Privy SDK, and so that every consumer can call one hook
// unconditionally. Privy's own hooks throw when there is no PrivyProvider
// above them, which would otherwise force every caller to branch on
// whether the app has a Privy app id configured. The branch happens here,
// once, at mount — and because it is decided by a build-time env var it
// can never flip between renders and change a hook count.
//
// Identity ONLY. No wallets (that is FunMarketWalletProvider), no Play
// session (that is PlaySessionProvider), no balances.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";

export type PrivyIdentityValue = {
  /** A Privy app id is set for this deployment. */
  configured: boolean;
  /** Privy has finished restoring any existing session. */
  ready: boolean;
  authenticated: boolean;
  /** The Privy DID. Never sent to our server as identity — see privyServer.ts. */
  userId: string | null;
  /** Google email when linked. Display only. */
  email: string | null;
  /** Fresh access token, auto-refreshed by Privy. Null when logged out. */
  getAccessToken: () => Promise<string | null>;
  /** Opens Privy's login modal: Google, then "Continue with a wallet". */
  loginWithGoogle: () => void;
  /** Opens Privy's full login modal (Google + Solana wallets). */
  login: () => void;
  logout: () => Promise<void>;
};

const PrivyIdentityContext = createContext<PrivyIdentityValue | null>(null);

/** What every consumer sees when Privy is not configured for this build. */
const ABSENT: PrivyIdentityValue = {
  configured: false,
  ready: true,
  authenticated: false,
  userId: null,
  email: null,
  getAccessToken: async () => null,
  loginWithGoogle: () => {},
  login: () => {},
  logout: async () => {},
};

export function PrivyIdentityAbsent({ children }: { children: ReactNode }) {
  return (
    <PrivyIdentityContext.Provider value={ABSENT}>
      {children}
    </PrivyIdentityContext.Provider>
  );
}

export function PrivyIdentityBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken, login, logout } = usePrivy();

  const email = useMemo(() => {
    const accounts = user?.linkedAccounts ?? [];
    for (const account of accounts) {
      if (account.type === "google_oauth") return account.email ?? null;
    }
    return user?.email?.address ?? null;
  }, [user]);

  // Google plus Privy's own wallet step, in that order: `showWalletLoginFirst:
  // false` in PrivyAppProvider renders Google as the buttons and collapses
  // every wallet behind a single "Continue with a wallet" row, so a normal
  // user still sees the method they came for first while a Phantom user can
  // authenticate up front instead of signing in with Google they do not want.
  // The wallet list is Solana-only — that is `appearance.walletChainType` in
  // PrivyAppProvider, which this runtime override inherits.
  const loginWithGoogle = useCallback(
    () => login({ loginMethods: ["google", "wallet"] }),
    [login]
  );

  const value = useMemo<PrivyIdentityValue>(
    () => ({
      configured: true,
      ready,
      authenticated,
      userId: user?.id ?? null,
      email,
      getAccessToken: async () => (await getAccessToken()) ?? null,
      loginWithGoogle,
      login: () => login(),
      logout,
    }),
    [ready, authenticated, user, email, getAccessToken, loginWithGoogle, login, logout]
  );

  return (
    <PrivyIdentityContext.Provider value={value}>
      {children}
    </PrivyIdentityContext.Provider>
  );
}

export function usePrivyIdentity(): PrivyIdentityValue {
  const ctx = useContext(PrivyIdentityContext);
  // Falling back to ABSENT rather than throwing: a component rendered
  // outside the provider should degrade to "no Google login available",
  // not crash the page.
  return ctx ?? ABSENT;
}
