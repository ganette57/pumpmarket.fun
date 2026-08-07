"use client";

// src/components/mode/ModeChangeToast.tsx
//
// "Play mode" / "Real mode" — a one-line confirmation after a switch.
//
// Deliberately non-interactive: no dismiss button, no actions, pointer
// events off. It confirms what just happened and gets out of the way. The
// dismiss timer lives in ModeProvider, which owns the state.
//
// aria-live="polite" so the switch is announced to screen readers, which
// otherwise get no feedback from a segmented control changing colour.

import type { TradingMode } from "@/lib/tradingMode";

const LABEL: Record<TradingMode, string> = {
  play: "Play mode",
  real: "Real mode",
};

export default function ModeChangeToast({ mode }: { mode: TradingMode | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[190] flex justify-center"
      // Clear of the mobile bottom nav and the home indicator.
      style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {mode && (
        <div className="rounded-full border border-white/10 bg-black/85 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-lg backdrop-blur-md">
          {LABEL[mode]}
        </div>
      )}
    </div>
  );
}
