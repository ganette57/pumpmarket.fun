"use client";

// src/components/play/PlaySessionProvider.tsx
//
// The Play session: the ONLY place in the UI that touches wallet signing
// for Play. Presentation components call ensureSession() and read
// balanceUsd — they never build a message, never call signMessage, and
// never see a route path.
//
// TEMPORARY IDENTITY: the connected Solana wallet is the Play identity for
// this internal beta. Privy replaces this later. Because every consumer
// goes through this hook rather than useWallet(), that swap is contained
// to this file.
//
// Handshake (one signature, then a cookie):
//   1. POST /api/play/auth/nonce   -> single-use challenge + message
//   2. wallet.signMessage(message) -> the ONLY wallet popup, ever
//   3. POST /api/play/auth/verify  -> sets the httpOnly play_session cookie
// Afterwards, state/quote/trade ride the cookie with no popup.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { PlayApiError, decimal, playClient } from "@/lib/playClient";
import { useTradingMode } from "@/components/mode/ModeProvider";

type PlaySessionContextValue = {
  /** A live Play session exists for the CURRENTLY connected wallet. */
  authenticated: boolean;
  /** The sign-in handshake is in flight (nonce → signature → verify). */
  authenticating: boolean;
  /** Decimal string, never a float. Null until known. */
  balanceUsd: string | null;
  /** Background refresh of balance/state in flight. */
  loading: boolean;
  error: string | null;
  clearError: () => void;
  /** Idempotent: returns true if a session is (now) available. */
  ensureSession: () => Promise<boolean>;
  /** Re-reads balance from the server. Safe to call after a trade. */
  refreshState: () => Promise<void>;
  /** Applies an authoritative balance returned by a trade response. */
  applyBalance: (next: string) => void;
};

const PlaySessionContext = createContext<PlaySessionContextValue | null>(null);

export function PlaySessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, signMessage } = useWallet();
  const { isPlay } = useTradingMode();
  const wallet = publicKey?.toBase58() ?? null;

  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The wallet the current session belongs to. The play_session cookie is
  // HMAC-bound to one wallet server-side, so if the user switches wallets
  // the cookie still resolves to the OLD account. Tracking this lets us
  // detect the switch and force a fresh handshake instead of silently
  // showing another wallet's balance.
  const sessionWalletRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const resetSession = useCallback(() => {
    sessionWalletRef.current = null;
    setAuthenticated(false);
    setBalanceUsd(null);
  }, []);

  /** Wallet disconnected or changed -> drop the local session view. */
  useEffect(() => {
    if (!connected || !wallet) {
      resetSession();
      return;
    }
    if (sessionWalletRef.current && sessionWalletRef.current !== wallet) {
      resetSession();
      // Best-effort: clear the stale cookie bound to the previous wallet.
      // Only in Play mode — Real must not call a Play endpoint. A stale
      // cookie is harmless meanwhile: refreshState() compares the returned
      // wallet_address and resets if it does not match.
      if (isPlay) void playClient.logout().catch(() => {});
    }
  }, [connected, wallet, resetSession, isPlay]);

  const refreshState = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const s = await playClient.state();
      // Guard against a wallet switch racing this request.
      if (s.account?.wallet_address && s.account.wallet_address !== wallet) {
        resetSession();
        return;
      }
      sessionWalletRef.current = wallet;
      setBalanceUsd(decimal(s.account?.balance_usd));
      setAuthenticated(true);
      setError(null);
    } catch (e) {
      if (e instanceof PlayApiError && e.needsSession) {
        // No session yet, or it expired — not an error worth surfacing.
        resetSession();
      } else if (e instanceof PlayApiError) {
        setError(e.message);
      } else {
        setError("Could not load your Play balance.");
      }
    } finally {
      setLoading(false);
    }
  }, [wallet, resetSession]);

  // Probe for an existing session so a returning user never sees "Enable
  // Play" when their cookie is still good.
  //
  // Gated on isPlay: in Real mode the app must not touch a Play endpoint at
  // all, so this only runs once the user is actually in Play mode.
  useEffect(() => {
    if (isPlay && connected && wallet && !authenticated && !authenticating) {
      void refreshState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlay, connected, wallet]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (authenticated && sessionWalletRef.current === wallet) return true;
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async (): Promise<boolean> => {
      if (!connected || !wallet) {
        setError("Connect your wallet to use Play mode.");
        return false;
      }
      if (!signMessage) {
        setError("This wallet cannot sign messages.");
        return false;
      }

      setAuthenticating(true);
      setError(null);
      try {
        // A cookie may already be valid (page reload, second tab).
        try {
          const s = await playClient.state();
          if (s.account?.wallet_address === wallet) {
            sessionWalletRef.current = wallet;
            setBalanceUsd(decimal(s.account.balance_usd));
            setAuthenticated(true);
            return true;
          }
        } catch (e) {
          if (!(e instanceof PlayApiError && e.needsSession)) throw e;
        }

        const { nonce, message } = await playClient.requestNonce(wallet);
        const signatureBytes = await signMessage(
          new TextEncoder().encode(message)
        );
        const signature = bs58.encode(Buffer.from(signatureBytes));

        const verified = await playClient.verify({ wallet, nonce, signature });

        sessionWalletRef.current = wallet;
        setBalanceUsd(decimal(verified.account?.balance_usd));
        setAuthenticated(true);
        return true;
      } catch (e) {
        resetSession();
        if (e instanceof PlayApiError) {
          setError(e.message);
        } else {
          // signMessage throws on user rejection.
          const msg = String((e as Error)?.message || "");
          setError(
            /reject|denied|cancel/i.test(msg)
              ? "Signature cancelled."
              : "Could not start your Play session."
          );
        }
        return false;
      } finally {
        setAuthenticating(false);
      }
    })();

    inFlightRef.current = run;
    try {
      return await run;
    } finally {
      inFlightRef.current = null;
    }
  }, [authenticated, wallet, connected, signMessage, resetSession]);

  const applyBalance = useCallback((next: string) => {
    setBalanceUsd(decimal(next));
  }, []);

  const value = useMemo<PlaySessionContextValue>(
    () => ({
      authenticated,
      authenticating,
      balanceUsd,
      loading,
      error,
      clearError,
      ensureSession,
      refreshState,
      applyBalance,
    }),
    [
      authenticated,
      authenticating,
      balanceUsd,
      loading,
      error,
      clearError,
      ensureSession,
      refreshState,
      applyBalance,
    ]
  );

  return (
    <PlaySessionContext.Provider value={value}>
      {children}
    </PlaySessionContext.Provider>
  );
}

export function usePlaySession(): PlaySessionContextValue {
  const ctx = useContext(PlaySessionContext);
  if (!ctx) {
    throw new Error("usePlaySession must be used inside <PlaySessionProvider>");
  }
  return ctx;
}
