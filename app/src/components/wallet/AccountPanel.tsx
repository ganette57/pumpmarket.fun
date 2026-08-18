"use client";

// src/components/wallet/AccountPanel.tsx
//
// The account block inside the header menus. Replaces the bare
// WalletMultiButton that used to sit there.
//
// It answers one question — "what can I do about my account right now?" —
// and the answer depends entirely on what the user has:
//
//   nothing yet   -> Continue with Google (primary), Connect wallet (quiet)
//   signed in     -> who you are, which wallet Real spends from, add funds,
//                    and the ways out (disconnect wallet / log out)
//
// WHAT A NORMAL USER MUST NEVER SEE
// ---------------------------------
// No prompt to install anything. No "wallet required". No seed phrase, no
// network name, no chain id. Someone who signed in with Google has a
// working Solana wallet; the only blockchain fact worth showing them is
// how much SOL is in it, and only once they care (Real mode).
//
// "Connect wallet" opens the existing Solana wallet-adapter modal rather
// than Privy's. Both work, but the adapter modal is the one every current
// Real path is already wired to, and the one crypto users here have used
// before. Phase 12's point stands: stable UX beats dependency purity.

import { LogOut, Wallet } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { useSolBalance } from "@/hooks/useSolBalance";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { formatBalanceSol, formatBalanceUsd } from "@/lib/compactBalance";
import AddFundsButton from "@/components/wallet/AddFundsButton";
import RealWalletSelector from "@/components/wallet/RealWalletSelector";

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function AccountPanel({ onNavigate }: { onNavigate?: () => void }) {
  const privy = usePrivyIdentity();
  const wallet = useFunMarketWallet();
  const { isReal } = useTradingMode();
  const { setVisible } = useWalletModal();
  // Read, never driven: this panel shows the Play balance, it does not
  // start sessions or trade. Sign-in stays with the Play CTAs.
  const play = usePlaySession();

  // Only read the chain when a Real balance is actually on screen.
  const sol = useSolBalance({ enabled: isReal && wallet.connected });

  const signedIn = privy.authenticated || wallet.connected;

  /* ---------------------------------------------------------------- */
  /*  Signed out                                                       */
  /* ---------------------------------------------------------------- */
  if (!signedIn) {
    return (
      <div className="space-y-2 p-3">
        {privy.configured && (
          <button
            type="button"
            onClick={() => {
              privy.loginWithGoogle();
              onNavigate?.();
            }}
            className="h-10 w-full rounded-xl bg-pump-green font-semibold text-black hover:opacity-90"
          >
            Continue with Google
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setVisible(true);
            onNavigate?.();
          }}
          className={
            privy.configured
              ? "h-10 w-full rounded-xl border border-gray-700 text-sm font-medium text-gray-300 hover:bg-white/5"
              : "h-10 w-full rounded-xl bg-pump-green font-semibold text-black hover:opacity-90"
          }
        >
          {privy.configured ? "Use another wallet" : "Connect wallet"}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Signed in                                                        */
  /* ---------------------------------------------------------------- */

  // The balance for the mode you are actually in, from the same source
  // that mode spends from — the identical rule ModeBalancePill follows,
  // so the header pill and this panel can never disagree.
  //
  //   PLAY → PlaySessionProvider.balanceUsd (authoritative Play account)
  //   REAL → useSolBalance() for the ACTIVE FunMarket wallet
  //
  // Neither is fetched here. Both are read from state that already
  // updates on a mode switch and after a trade, which is what makes this
  // react immediately without a second source of truth to keep in sync.
  //
  // Play needs BOTH a live session and a balance read back from it.
  // Either one missing means "unknown", not "empty" — and because
  // PlaySessionProvider clears balanceUsd whenever the identity changes,
  // a dash here can never be another account's figure left on screen.
  const modeBalance = isReal
    ? formatBalanceSol(sol.lamports)
    : play.authenticated && play.balanceUsd !== null
    ? formatBalanceUsd(play.balanceUsd)
    : null;

  return (
    <div className="p-3">
      {/* Who you are. Email when we have one — an address is an identifier,
          not a name, and a Google user should recognise themselves. */}
      <div className="mb-3 min-w-0">
        <div className="truncate text-sm font-medium text-white">
          {privy.email ?? (wallet.address ? short(wallet.address) : "Signed in")}
        </div>
        {wallet.address && (
          <div className="truncate font-mono text-[11px] text-gray-500">
            {short(wallet.address)}
            {wallet.source === "privy" ? " · FunMarket wallet" : ""}
          </div>
        )}
      </div>

      {/* The balance for the current mode, directly under the identity it
          belongs to. Muted label, brighter figure — it is a fact about the
          account above it, not a call to action. */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {isReal ? "Real balance" : "Play balance"}
        </div>
        <div className="mt-0.5 text-base font-bold tabular-nums text-white">
          {modeBalance ?? "—"}
        </div>
      </div>

      {/* Real-only — Play money is not funded, it is granted.
          Offered for ANY active wallet, not just the embedded one: an
          external wallet still needs an address to receive at, and the
          modal names the destination rather than assuming it. Hiding this
          for Phantom users was the "silently funds a different wallet"
          risk in reverse — they simply had no funding entry point. */}
      {isReal && wallet.address && (
        <div className="mb-3">
          <AddFundsButton onFunded={sol.refresh} onOpen={onNavigate} />
        </div>
      )}

      {/* Only renders when there is genuinely a choice to make. */}
      <RealWalletSelector />

      {/* Connected a wallet, but never signed in with Google.
          `signedIn` above is true for a wallet alone, so without this a
          legacy Phantom user would never be offered the Google identity —
          and Google identity is what survives losing that wallet. Primary
          styling, because for this user it is still the upgrade. */}
      {privy.configured && !privy.authenticated && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              privy.loginWithGoogle();
              onNavigate?.();
            }}
            className="h-10 w-full rounded-xl bg-pump-green font-semibold text-black hover:opacity-90"
          >
            Continue with Google
          </button>
          <p className="mt-1.5 px-1 text-[11px] leading-snug text-gray-500">
            Keeps your Play account if you change wallets.
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1 border-t border-gray-800 pt-3">
        {!wallet.externalAddress && (
          <button
            type="button"
            onClick={() => {
              setVisible(true);
              onNavigate?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5"
          >
            <Wallet className="h-4 w-4" /> Use another wallet
          </button>
        )}

        {/* Disconnecting an external wallet is NOT logging out. The Play
            session belongs to the Google account and survives. */}
        {wallet.externalAddress && (
          <button
            type="button"
            onClick={() => {
              void wallet.disconnect();
              onNavigate?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5"
          >
            <Wallet className="h-4 w-4" /> Disconnect wallet
          </button>
        )}

        {privy.authenticated && (
          <button
            type="button"
            onClick={() => {
              void privy.logout();
              onNavigate?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-400 hover:bg-white/5 hover:text-gray-200"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        )}
      </div>
    </div>
  );
}
