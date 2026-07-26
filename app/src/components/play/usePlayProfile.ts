"use client";

// src/components/play/usePlayProfile.ts
//
// One wallet's Play profile, from the authoritative /api/play/profile route.
//
// REAL SAFETY / MODE ISOLATION
// ----------------------------
// It fetches only while Play mode is active, and reads nothing but
// /api/play/profile. Every fetch captures an epoch that bumps on mode change
// and wallet change, so a late Play response can never paint after the user
// switched to Real or navigated to another profile. On error it does NOT fall
// back to Real data — there is no Real read in this file at all.
//
// NO POLLING
// ----------
// A profile is not a live book: it changes when the owner trades or a market
// settles, not on a ticker. It loads once per (wallet, mode) and exposes
// refresh() for the error-state retry and for the owner's post-trade refresh.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { playClient, type PlayProfileView } from "@/lib/playClient";

export type PlayProfileState = {
  profile: PlayProfileView | null;
  loading: boolean;
  error: boolean;
  /** True until the first response resolves — render the skeleton on this. */
  pending: boolean;
  refresh: () => void;
};

export function usePlayProfile(
  wallet: string | null | undefined
): PlayProfileState {
  const { isPlay } = useTradingMode();
  const addr = (wallet ?? "").trim();
  const active = isPlay && addr.length > 0;

  const [profile, setProfile] = useState<PlayProfileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refresh() only — the error state never retries on its own.
  const [reloadNonce, setReloadNonce] = useState(0);

  const epochRef = useRef(0);

  // Reset when the target wallet changes or Play is left, so one wallet's
  // positions can never flash under another — or under Real.
  useEffect(() => {
    epochRef.current += 1;
    setProfile(null);
    setLoaded(false);
    setError(false);
    setLoading(false);
  }, [addr, isPlay]);

  useEffect(() => {
    if (!active) return;

    const epoch = ++epochRef.current;
    setLoading(true);

    (async () => {
      try {
        const p = await playClient.profile(addr);
        if (epoch !== epochRef.current) return; // stale — discard
        setProfile(p);
        setError(false);
        setLoaded(true);
      } catch {
        if (epoch !== epochRef.current) return;
        setProfile(null);
        setError(true);
        setLoaded(true);
      } finally {
        if (epoch === epochRef.current) setLoading(false);
      }
    })();
  }, [active, addr, reloadNonce]);

  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  return {
    profile,
    loading,
    error,
    pending: active && !loaded && !error,
    refresh,
  };
}
