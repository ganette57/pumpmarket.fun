"use client";

// src/components/mode/ModeBalancePill.tsx
//
// The compact balance shown on the left of the mobile header.
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

import { useTradingMode } from "@/components/mode/ModeProvider";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useSolBalance } from "@/hooks/useSolBalance";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatCompactSol, formatCompactUsd } from "@/lib/compactBalance";

/**
 * `header`  — solid surfaces (mobile top bar)
 * `overlay` — on top of video/imagery (home feed), needs blur + contrast
 *
 * Mirrors ModeSwitch's variants so the two always sit on the same surface.
 */
type Variant = "header" | "overlay";

const CONTAINER: Record<Variant, string> = {
  header: "border border-gray-700/60 bg-black/40",
  overlay: "border border-white/10 bg-black/65 backdrop-blur-md",
};

export default function ModeBalancePill({
  variant = "header",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  const { isPlay } = useTradingMode();
  const { connected } = useWallet();
  const play = usePlaySession();

  // Only Real mode reads the chain. In Play mode this hook makes no RPC
  // call at all.
  const sol = useSolBalance({ enabled: !isPlay && connected });

  if (!connected) return null;

  // Play needs BOTH conditions: a live session, and a balance actually read
  // back from it. Either one missing means "unknown", not "empty".
  const value = isPlay
    ? play.authenticated && play.balanceUsd !== null
      ? formatCompactUsd(play.balanceUsd)
      : null
    : formatCompactSol(sol.lamports);

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums tracking-tight ${
        value ? "text-white" : "text-gray-500"
      } ${CONTAINER[variant]} ${className}`}
      aria-label={
        value
          ? `${isPlay ? "Play" : "Wallet"} balance ${value}`
          : "Balance unavailable"
      }
    >
      {value ?? "—"}
    </span>
  );
}
