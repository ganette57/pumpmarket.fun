"use client";

// src/components/play/useLiveMarketEconomics.ts
//
// Mode-aware economics for a single Live market, built ENTIRELY on the
// existing MarketSnapshotProvider — no Live-specific store, no second cache.
//
// It answers "what odds / volume / status should this Live surface show in
// the CURRENT mode?" and nothing else. It never signs, never trades, never
// touches the Real Solana path.
//
// REAL SAFETY
// -----------
// Call sites keep their existing Real rendering path untouched by only
// consuming the PLAY branch of the result (`isPlay` / `percentages` /
// `volumeLabel` / `perSide`) when `isPlay` is true, and passing their
// original Real values otherwise. The Real values returned here are provided
// for convenience but are byte-identical to the current inline formatting, so
// a call site may use them in either mode if it prefers.
//
// PLAY ISOLATION
// --------------
// In Play mode the numbers come from the Play snapshot only. When the Play
// book has not arrived yet, the hook returns a NEUTRAL placeholder (an even
// split, no volume) — never the Real book. This is the whole point of the
// phase: Play must never borrow Real economics.

import { useEffect, useMemo } from "react";
import {
  useMarketSnapshot,
  useMarketSnapshotActions,
  type MarketSnapshot,
} from "@/components/mode/MarketSnapshotProvider";
import { formatUsd } from "@/lib/playClient";
import { formatVol } from "@/components/LiveMobileContent";

export type LiveEconomics = {
  /** True when the active mode is Play. */
  isPlay: boolean;
  /** 0..100 per outcome. Real: the real book. Play: the play book (or an
   *  even-split placeholder while the play book loads — never real numbers). */
  percentages: number[];
  /** Total volume label incl. currency ("12.34 SOL" / "$1,234"), or null. */
  volumeLabel: string | null;
  /**
   * Money shown under one outcome.
   *
   * PLAY: the ACTUAL cumulative stake on that outcome, from the authoritative
   * play_trades sums carried on the snapshot.
   * REAL: unchanged legacy approximation (total volume × probability) — see
   * the note on the Real branch below.
   */
  perSide: (idx: number) => string | null;
  /** Effective market status for the active mode ("open" | "resolved" | …). */
  status: string;
  /** Play mode but the Play book has not arrived — gate trading/economics. */
  playPending: boolean;
};

export function useLiveMarketEconomics(input: {
  address: string | null | undefined;
  /** Real per-outcome percentages already computed by the page (0..100). */
  realPercentages: number[];
  /** Real total volume in lamports (markets.total_volume). */
  realVolumeLamports: number;
  /** Real market status ("open" | "resolved" | …). */
  realStatus: string;
  /** Number of outcomes — used only for the Play loading placeholder. */
  outcomeCount: number;
}): LiveEconomics {
  const {
    address,
    realPercentages,
    realVolumeLamports,
    realStatus,
    outcomeCount,
  } = input;
  const { publishRealSnapshots, watchPlayMarket } = useMarketSnapshotActions();

  // The Real snapshot we hand the provider. Registering the address lets the
  // provider fetch the Play book when the user switches to Play — exactly the
  // Market Detail pattern, so there is no second fetch and no second store.
  //
  // STABLE IDENTITY: callers pass `realPercentages` from an inline
  // deriveOutcomeDisplay(), i.e. a NEW array every render. Keying this memo on
  // the array's *content* (pctKey) rather than its reference keeps realFallback
  // stable when the numbers are stable, so the publish effect below does not
  // fire on every render. (The provider also guards with an equality check, so
  // this is defence-in-depth against the "Maximum update depth" loop.)
  const pctKey = realPercentages.join(",");
  const realFallback = useMemo<MarketSnapshot>(
    () => ({
      mode: "real",
      marketAddress: address ?? "",
      supplies: [],
      probabilities: realPercentages.map((p) => (Number(p) || 0) / 100),
      volume: String(Math.max(0, Math.floor(Number(realVolumeLamports) || 0))),
      status: realStatus,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, pctKey, realVolumeLamports, realStatus]
  );

  useEffect(() => {
    if (!address) return;
    publishRealSnapshots([realFallback]);
  }, [address, realFallback, publishRealSnapshots]);

  // Keep this Play market synced across clients while mounted. The provider
  // only actually polls when the app is in Play mode and the tab is visible,
  // and stops when this unwatch runs (unmount / market change).
  useEffect(() => {
    if (!address) return;
    return watchPlayMarket(address);
  }, [address, watchPlayMarket]);

  const { snapshot, mode } = useMarketSnapshot(address ?? "", realFallback);
  const isPlay = mode === "play";

  return useMemo<LiveEconomics>(() => {
    if (!isPlay) {
      // REAL — identical to the current inline SOL formatting.
      //
      // KNOWN LIMITATION, DELIBERATELY LEFT: `perSide` here is still
      // volume × probability, which approximates but does not equal the
      // cumulative SOL actually spent per outcome. Fixing it authoritatively
      // needs a per-outcome SUM(cost) over `transactions`, which no Live
      // surface currently loads (the Live page holds only the last N
      // recentTrades, not the full history). That is a Real backend change,
      // and Real is production-validated, so it is out of scope here. Play is
      // now exact; Real keeps the legacy approximation until that aggregation
      // exists.
      const vol = Number(realVolumeLamports) || 0;
      return {
        isPlay: false,
        percentages: realPercentages,
        volumeLabel: vol > 0 ? `${formatVol(vol)} SOL` : null,
        perSide: (idx) =>
          vol > 0
            ? `${formatVol((vol * (realPercentages[idx] ?? 0)) / 100)} SOL`
            : null,
        status: realStatus,
        playPending: false,
      };
    }

    // PLAY — never borrow Real numbers.
    if (!snapshot || snapshot.mode !== "play") {
      const n = Math.max(outcomeCount, 0);
      const even = 100 / Math.max(outcomeCount, 1);
      return {
        isPlay: true,
        percentages: Array.from({ length: n }, () => even),
        volumeLabel: null,
        perSide: () => null,
        status: "open",
        playPending: true,
      };
    }

    const probs = snapshot.probabilities.map((p) => (Number(p) || 0) * 100);
    const poolUsd = snapshot.volume; // decimal USD string
    const poolNum = Number(poolUsd) || 0;
    const hasVol = poolNum > 0;
    // ACTUAL cumulative stake per outcome, straight from the authoritative
    // play_trades sums on the snapshot. Never pool × probability: the supplies
    // behind those probabilities include the seeded opening book that nobody
    // paid for, so that product is not what anyone staked.
    const stakes = snapshot.stakeByOutcomeUsd;
    return {
      isPlay: true,
      percentages: probs,
      volumeLabel: hasVol ? formatUsd(poolUsd, { compact: true }) : null,
      perSide: (idx) => {
        // No stakes array yet (snapshot from an older payload) — show nothing
        // rather than fall back to a number that would be wrong.
        if (!stakes) return null;
        return formatUsd(stakes[idx] ?? "0", { compact: true });
      },
      status: snapshot.status || "open",
      playPending: false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPlay,
    snapshot,
    pctKey,
    realVolumeLamports,
    realStatus,
    outcomeCount,
  ]);
}
