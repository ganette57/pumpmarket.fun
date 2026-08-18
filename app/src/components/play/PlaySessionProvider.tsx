"use client";

// src/components/play/PlaySessionProvider.tsx
//
// The Play session: the ONLY place in the UI that turns an identity into
// a Play session. Presentation components call ensureSession() and read
// balanceUsd — they never build a message, never call signMessage, never
// touch a Privy token, and never see a route path.
//
// TWO DOORS, ONE SESSION
// ----------------------
// PRIVY (the normal path). The user signed in with Google, so they are
// already authenticated:
//   1. getAccessToken()             -> a verified Privy token
//   2. POST /api/play/auth/privy    -> sets the httpOnly play_session cookie
// No signature. No wallet popup. No extension required to play.
//
// WALLET SIGNATURE (legacy, still supported). For someone who connected
// Phantom and never signed in with Google:
//   1. POST /api/play/auth/nonce    -> single-use challenge + message
//   2. wallet.signMessage(message)  -> one wallet popup
//   3. POST /api/play/auth/verify   -> sets the same cookie
//
// Afterwards both are indistinguishable: state/quote/trade ride the
// cookie, and every Play route is unchanged.
//
// PRIVY WINS WHEN BOTH ARE PRESENT. A crypto user who logs in with Google
// AND connects Phantom gets ONE Play account — the Privy one — because
// the Privy identity survives wallet changes and the wallet identity does
// not. Their Phantom stays available for Real trading, which is a
// separate question answered by useFunMarketWallet().

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
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";

type PlaySessionContextValue = {
  /** A live Play session exists for the CURRENT identity. */
  authenticated: boolean;
  /** The sign-in handshake is in flight. */
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
  /**
   * How the current session was established. Lets the UI say "Continue
   * with Google" to someone with no identity at all, without offering it
   * to someone already signed in.
   */
  identityKind: "privy" | "wallet" | null;
  /**
   * What the Play sign-in button should say right now.
   *
   * Centralised here so the four trading panels stay dumb and can never
   * drift apart — and so none of them has to know whether Privy is
   * configured for this deployment.
   */
  signInLabel: string;
};

const PlaySessionContext = createContext<PlaySessionContextValue | null>(null);

export function PlaySessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, signMessage } = useWallet();
  const privy = usePrivyIdentity();
  const { isPlay } = useTradingMode();
  const wallet = publicKey?.toBase58() ?? null;

  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The identity this component would sign in as right now.
   *
   * A single opaque key, so the "did the user switch?" check below is one
   * string comparison whichever door they came through. Privy is checked
   * first: see the header note on why it wins.
   */
  const identityKind: "privy" | "wallet" | null = privy.authenticated
    ? "privy"
    : connected && wallet
    ? "wallet"
    : null;
  const identityKey = privy.authenticated
    ? `privy:${privy.userId ?? ""}`
    : connected && wallet
    ? `wallet:${wallet}`
    : null;

  // The identity the current session belongs to. The play_session cookie
  // is HMAC-bound to one account server-side, so if the user switches
  // identity the cookie still resolves to the OLD account. Tracking this
  // lets us detect the switch and force a fresh handshake instead of
  // silently showing another account's balance.
  const sessionIdentityRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  // ensureSession is declared below but the auto-sign-in effect above it
  // needs to call it. A ref breaks the cycle without reordering the file
  // or putting ensureSession in that effect's dependency list, where its
  // changing identity would re-fire the effect on every render.
  const ensureSessionRef = useRef<(() => Promise<boolean>) | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const resetSession = useCallback(() => {
    sessionIdentityRef.current = null;
    setAuthenticated(false);
    setBalanceUsd(null);
  }, []);

  /** Identity lost or changed -> drop the local session view. */
  useEffect(() => {
    if (!identityKey) {
      // Logging out of Google, or disconnecting the wallet that WAS the
      // identity, ends the Play session too — the cookie outlives the
      // identity that earned it otherwise, and the next visitor on a
      // shared browser would inherit a signed-in Play account.
      //
      // `sessionIdentityRef.current` gates this so it fires on an actual
      // sign-out, not on every first render before an identity resolves.
      //
      // Disconnecting an external wallet while signed in with Google is
      // NOT this case: identityKey stays `privy:…` and nothing here runs.
      if (sessionIdentityRef.current) void playClient.logout().catch(() => {});
      resetSession();
      return;
    }
    if (sessionIdentityRef.current && sessionIdentityRef.current !== identityKey) {
      resetSession();
      // Best-effort: clear the stale cookie bound to the previous
      // identity. Only in Play mode — Real must not call a Play endpoint.
      // A stale cookie is harmless meanwhile: the next handshake
      // overwrites it.
      if (isPlay) void playClient.logout().catch(() => {});
    }
  }, [identityKey, resetSession, isPlay]);

  const refreshState = useCallback(async () => {
    if (!identityKey) return;
    setLoading(true);
    try {
      const s = await playClient.state();

      // Whose cookie is this? Two different answers, for the same reason
      // as the ensureSession() block below.
      //
      // WALLET: the account's wallet_address is the identity, so a
      // mismatch means the cookie belongs to someone else.
      if (
        identityKind === "wallet" &&
        s.account?.wallet_address &&
        s.account.wallet_address !== wallet
      ) {
        resetSession();
        return;
      }

      // PRIVY: nothing here can prove the cookie belongs to this DID, so
      // only a session THIS component already established through the
      // handshake counts. Otherwise we would be adopting whatever cookie
      // happened to be in the jar — the bug that surfaced another
      // player's balance under a brand-new Google account.
      //
      // Bailing out is safe: the auto-sign-in effect runs ensureSession()
      // for a Privy identity, which does the handshake and replaces the
      // cookie with the right one.
      if (identityKind === "privy" && sessionIdentityRef.current !== identityKey) {
        resetSession();
        return;
      }
      sessionIdentityRef.current = identityKey;
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
  }, [identityKey, identityKind, wallet, resetSession]);

  // Probe for an existing session so a returning user never sees "Enable
  // Play" when their cookie is still good.
  //
  // Gated on isPlay: in Real mode the app must not touch a Play endpoint
  // at all, so this only runs once the user is actually in Play mode.
  //
  // For a PRIVY identity this goes further and completes the whole
  // handshake, not just the probe. It can afford to: the Privy door is a
  // single authenticated POST with no popup and no signature, so running
  // it unprompted costs the user nothing and is what makes "log in with
  // Google, start playing" true. The WALLET door only probes — starting
  // its handshake here would throw an unrequested signature prompt at
  // someone who merely opened the app.
  useEffect(() => {
    if (!isPlay || !identityKey || authenticated || authenticating) return;
    if (identityKind === "privy") void ensureSessionRef.current?.();
    else void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlay, identityKey, identityKind]);

  /**
   * Google/Privy sign-in. One request, no popup.
   *
   * Returns false rather than throwing on a missing token so the caller
   * can fall through to the wallet door.
   */
  const signInWithPrivy = useCallback(async (): Promise<boolean> => {
    const token = await privy.getAccessToken();
    if (!token) {
      setError("Your Google session expired. Sign in again.");
      // Fall through to the cleanup below: no token means no way to prove
      // who this is, so any cookie still present is not ours.
      await playClient.logout().catch(() => {});
      return false;
    }
    try {
      const verified = await playClient.privyLogin(token);
      setBalanceUsd(decimal(verified.account?.balance_usd));
      setAuthenticated(true);
      return true;
    } catch (e) {
      // The handshake is what REPLACES a pre-existing cookie. If it fails
      // — expired token, or a deployment missing the Play migration — a
      // cookie from some earlier session is still in the jar, still valid,
      // and still belongs to whoever earned it. The client no longer
      // adopts it, but leaving it there means any future request would
      // still carry it. Drop it, then re-throw for normal error handling.
      await playClient.logout().catch(() => {});
      throw e;
    }
  }, [privy]);

  /** Legacy wallet-signature sign-in. Unchanged behaviour. */
  const signInWithWallet = useCallback(async (): Promise<boolean> => {
    if (!wallet) {
      setError("Connect your wallet to use Play mode.");
      return false;
    }
    if (!signMessage) {
      setError("This wallet cannot sign messages.");
      return false;
    }

    const { nonce, message } = await playClient.requestNonce(wallet);
    const signatureBytes = await signMessage(new TextEncoder().encode(message));
    const signature = bs58.encode(Buffer.from(signatureBytes));

    const verified = await playClient.verify({ wallet, nonce, signature });
    setBalanceUsd(decimal(verified.account?.balance_usd));
    setAuthenticated(true);
    return true;
  }, [wallet, signMessage]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (authenticated && sessionIdentityRef.current === identityKey) return true;
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async (): Promise<boolean> => {
      if (!identityKey) {
        // No identity at all. With Privy available, open Google login
        // rather than showing an error — for a normal user this IS the
        // sign-in step, and asking them to go find a Connect button
        // first would be the extra hop this whole integration removes.
        // Returning false is correct: the session does not exist yet.
        // The auto-sign-in effect finishes the job once Privy reports an
        // authenticated user.
        if (privy.configured) {
          privy.loginWithGoogle();
          return false;
        }
        setError("Connect your wallet to use Play mode.");
        return false;
      }

      setAuthenticating(true);
      setError(null);
      try {
        // THE WALLET DOOR may reuse an existing cookie, because it can
        // PROVE the cookie is the right one: a wallet account's
        // wallet_address IS its identity, so comparing it to the connected
        // wallet is a real check.
        //
        // THE PRIVY DOOR MUST NOT. There is nothing on the client that can
        // tie a play_session cookie to a Privy DID — the account's pinned
        // wallet_address deliberately does not track the user's current
        // embedded wallet, so no comparison here is meaningful. An earlier
        // version treated "any valid cookie" as good enough for a Privy
        // user, which meant a leftover cookie from a previous wallet login
        // was adopted by the Google account: it showed that player's
        // balance, and because /api/play/trade authenticates from the same
        // cookie, a trade would have spent their bankroll.
        //
        // So Privy always runs the handshake. It is one silent POST, it is
        // idempotent, and it REPLACES whatever cookie was there with one
        // the server minted for this DID. Skipping a round trip is not
        // worth reintroducing a cross-account hole.
        if (identityKind === "wallet") {
          try {
            const s = await playClient.state();
            if (s.account?.wallet_address === wallet) {
              sessionIdentityRef.current = identityKey;
              setBalanceUsd(decimal(s.account.balance_usd));
              setAuthenticated(true);
              return true;
            }
          } catch (e) {
            if (!(e instanceof PlayApiError && e.needsSession)) throw e;
          }
        }

        const ok =
          identityKind === "privy"
            ? await signInWithPrivy()
            : await signInWithWallet();
        if (!ok) return false;

        sessionIdentityRef.current = identityKey;
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
  }, [
    authenticated,
    identityKey,
    identityKind,
    wallet,
    privy,
    signInWithPrivy,
    signInWithWallet,
    resetSession,
  ]);

  // Published for the auto-sign-in effect above.
  ensureSessionRef.current = ensureSession;

  // "Enable Play" is right for someone who already has an identity and
  // just needs a session. Someone with no identity at all is being asked
  // to sign in, so say that instead — and name the method they will
  // actually be shown.
  const signInLabel = identityKind
    ? "Enable Play"
    : privy.configured
    ? "Continue with Google"
    : "Connect wallet";

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
      identityKind,
      signInLabel,
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
      identityKind,
      signInLabel,
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
