"use client";

// src/components/mode/ModeChangeDialog.tsx
//
// The one-time explainer shown the first time a user enters Play or Real.
//
// Rendered once, by ModeProvider, so every PLAY/REAL switch in the app
// (mobile header, home feed, Live tabs, desktop header) gets identical
// behaviour without any of them knowing this component exists.
//
// It is driven purely by the `pending` prop — it has no timers, no storage
// access and no mode state of its own. Nothing can put it on screen except
// an explicit requestMode() call from a user gesture, so it can never
// interrupt a page load.

import { useEffect, useRef } from "react";
import type { TradingMode } from "@/lib/tradingMode";

const COPY: Record<TradingMode, { title: string; body: string; cta: string }> = {
  real: {
    title: "Switch to Real?",
    body: "Real mode uses actual SOL. Trades involve real funds.",
    cta: "Switch to Real",
  },
  play: {
    title: "Switch to Play?",
    body: "Play mode uses virtual funds and counts toward Play competitions.",
    cta: "Switch to Play",
  },
};

export default function ModeChangeDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: TradingMode | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onCancel]);

  if (!pending) return null;

  const copy = COPY[pending];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      // A tap on the scrim is a cancel, the same as Escape.
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-change-title"
        aria-describedby="mode-change-body"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-gray-800 bg-[#0d0d0d] p-5 shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <h2
          id="mode-change-title"
          className="text-lg font-bold text-white"
        >
          {copy.title}
        </h2>

        <p id="mode-change-body" className="mt-2 text-sm leading-relaxed text-gray-400">
          {copy.body}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="h-11 w-full rounded-xl bg-pump-green text-sm font-extrabold text-black transition hover:opacity-90"
          >
            {copy.cta}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 w-full rounded-xl border border-gray-800 bg-black/40 text-sm font-semibold text-gray-300 transition hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
