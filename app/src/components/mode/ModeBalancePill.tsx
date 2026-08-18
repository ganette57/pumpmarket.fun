"use client";

// src/components/mode/ModeBalancePill.tsx
//
// The balance shown on the left of the mobile header.
//
// It shows the balance for the mode you are actually in, from the same
// source that mode spends from:
//
//   PLAY → PlaySessionProvider.balanceUsd — the authoritative Play account
//          balance, the identical figure the Play trading panels check a
//          stake against. No second fetch: this reads the provider.
//   REAL → useSolBalance() — native SOL from the wallet adapter connection.
//          No SPL tokens.
//
// The wallet glyph is what makes the number legible at a glance: a bare
// "$5,500" floating in a header could be anything — a prize pool, a volume
// figure, a market cap. The icon says "this is yours" in the width a text
// label like "Balance:" could never afford on mobile.
//
// HONESTY RULE
// ------------
// "$0" and "0 SOL" are only ever rendered when they are the real answer.
// A balance that is loading, unauthenticated, or failed to read shows a
// neutral dash instead, because a zero balance and an unknown balance mean
// very different things to someone about to place a trade.
//
// With no wallet connected the pill renders nothing at all — there is no
// account for a balance to belong to. The header centres its mode switch
// with a grid, so the switch does not move when the pill disappears.

import { Wallet } from "lucide-react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useSolBalance } from "@/hooks/useSolBalance";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { formatBalanceSol, formatBalanceUsd } from "@/lib/compactBalance";

/**
 * `header`  — solid surfaces (mobile top bar)
 * `overlay` — on top of video/imagery (home feed), needs blur + contrast
 *
 * Mirrors ModeSwitch's variants so the two always sit on the same surface.
 */
type Variant = "header" | "overlay";

const CONTAINER: Record<Variant, string> = {
  header: "border border-gray-600/70 bg-black/60",
  overlay: "border border-white/20 bg-black/75 backdrop-blur-md",
};

export default function ModeBalancePill({
  variant = "header",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  const { isPlay } = useTradingMode();
  const { connected } = useFunMarketWallet();
  const play = usePlaySession();

  // Only Real mode reads the chain. In Play mode this hook makes no RPC
  // call at all.
  const sol = useSolBalance({ enabled: !isPlay && connected });

  // What has to exist for a balance to exist DIFFERS by mode, and it did
  // not before Google login. Play money belongs to a Play account, which a
  // Google user has whether or not any wallet has resolved yet; Real money
  // belongs to a wallet. Gating both on `connected` would blank the pill
  // for a signed-in Play user in the moment before their embedded wallet
  // loads — hiding a balance they definitely have.
  const hasAccount = isPlay ? play.authenticated : connected;
  if (!hasAccount) return null;

  // Play needs BOTH conditions: a live session, and a balance actually read
  // back from it. Either one missing means "unknown", not "empty".
  const value = isPlay
    ? play.authenticated && play.balanceUsd !== null
      ? formatBalanceUsd(play.balanceUsd)
      : null
    : formatBalanceSol(sol.lamports);

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums tracking-tight ${
        value ? "text-white" : "text-gray-500"
      } ${CONTAINER[variant]} ${className}`}
      aria-label={
        value
          ? `${isPlay ? "Play" : "Wallet"} balance ${value}`
          : "Balance unavailable"
      }
    >
      <Wallet
        aria-hidden="true"
        strokeWidth={2.25}
        className={`h-3.5 w-3.5 shrink-0 ${value ? "text-gray-300" : "text-gray-600"}`}
      />
      {value ?? "—"}
    </span>
  );
}
