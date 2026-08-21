"use client";

// src/components/mode/ModeBalancePill.tsx
//
// The balance shown immediately to the left of the PLAY/REAL control, in the
// mobile top bar and the desktop header.
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
 * `header`  — solid surfaces, chip-sized (kept for any caller that wants the
 *              bordered pill)
 * `overlay` — on top of video/imagery (the immersive home feed), needs blur +
 *             contrast. Stays a compact chip ON PURPOSE: it shares a 375px row
 *             with a mathematically centred 44px mode switch, and the switch's
 *             centring is what gives way first if this grows. A small type
 *             bump (11px → 13px) is all the room there is.
 * `hero`    — the top bars. No container at all: the number IS the element,
 *             set large enough to be read at arm's length, and the wallet
 *             glyph takes the accent of the mode the balance belongs to
 *             (green in Play, white in Real). Sitting bare next to the
 *             segmented control, a second bordered pill would compete with
 *             it; the naked figure reads as the headline it is.
 *
 * Mirrors ModeSwitch's variants so the two always sit on the same surface.
 */
type Variant = "header" | "overlay" | "hero";

const CONTAINER: Record<Variant, string> = {
  header: "gap-1.5 rounded-full border border-gray-600/70 bg-black/60 px-2.5 py-1 text-[11px] tracking-tight",
  overlay:
    "gap-1.5 rounded-full border border-white/20 bg-black/75 px-2.5 py-1.5 text-[13px] tracking-tight backdrop-blur-md max-[389px]:gap-1 max-[389px]:px-2 max-[359px]:px-1.5",
  // 18px on the mobile bar, 22px on the desktop one — one class, because the
  // two bars never render at the same breakpoint.
  hero: "gap-[7px] text-[18px] tracking-[-0.015em] md:gap-[9px] md:text-[22px]",
};

const ICON: Record<Variant, string> = {
  header: "h-3.5 w-3.5",
  // Dropped below 360px: the glyph is the one part of this chip that can go
  // without the balance itself becoming less exact.
  overlay: "h-4 w-4 max-[359px]:hidden",
  hero: "h-[15px] w-[15px] md:h-[17px] md:w-[17px]",
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

  const hero = variant === "hero";

  return (
    <span
      className={`inline-flex shrink-0 items-center tabular-nums ${
        hero ? "font-extrabold leading-none" : "font-bold"
      } ${value ? "text-white" : "text-gray-500"} ${CONTAINER[variant]} ${className}`}
      aria-label={
        value
          ? `${isPlay ? "Play" : "Wallet"} balance ${value}`
          : "Balance unavailable"
      }
    >
      <Wallet
        aria-hidden="true"
        strokeWidth={2.25}
        className={`${ICON[variant]} shrink-0 ${
          !value
            ? "text-gray-600"
            : hero
            ? isPlay
              ? "text-pump-green"
              : "text-white"
            : "text-gray-300"
        }`}
      />
      {value ?? "—"}
    </span>
  );
}
