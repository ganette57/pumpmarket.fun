"use client";

// src/components/mode/ModeSwitch.tsx
//
// Compact PLAY | REAL segmented control.
//
// Deliberately has NO wallet dependency and NO trading dependency — it only
// reads and writes the global mode. That keeps the future identity swap
// (Privy) away from presentation entirely.
//
// Styling reuses the shapes already in the app: the rounded-full pill group
// from the Live MobileTabs, `bg-pump-green text-black` for the active state
// (the same accent as the Create / Go Live buttons), and subtle grey for the
// inactive one. No new design language is introduced.
//
// It calls requestMode() rather than setMode(), which is what gives every
// instance of this control — mobile header, home feed, Live tabs, desktop
// header — the same one-time "Switch to Real?" explainer for free.

import { useTradingMode } from "@/components/mode/ModeProvider";
import type { TradingMode } from "@/lib/tradingMode";

type Size = "sm" | "md";

/**
 * `header`  — solid surfaces (desktop header, mobile top bar)
 * `overlay` — on top of video/imagery (mobile feed, Live), needs blur + contrast
 */
type Variant = "header" | "overlay";

const CONTAINER: Record<Variant, string> = {
  header: "border border-gray-700/60 bg-black/40",
  overlay: "border border-white/10 bg-black/65 backdrop-blur-md",
};

const SIZE: Record<Size, { pad: string; text: string; gap: string }> = {
  sm: { pad: "px-2.5 py-1", text: "text-[10px]", gap: "p-0.5" },
  md: { pad: "px-3 py-1.5", text: "text-xs", gap: "p-1" },
};

export default function ModeSwitch({
  size = "md",
  variant = "header",
  className = "",
}: {
  size?: Size;
  variant?: Variant;
  className?: string;
}) {
  const { mode, requestMode } = useTradingMode();
  const s = SIZE[size];

  const item = (value: TradingMode, label: string) => {
    const active = mode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => requestMode(value)}
        aria-pressed={active}
        aria-label={`Switch to ${label} mode`}
        className={`${s.pad} ${s.text} rounded-full font-bold uppercase tracking-wide transition-colors duration-150 ${
          active
            ? "bg-pump-green text-black"
            : "text-gray-400 hover:text-gray-200"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Trading mode"
      className={`inline-flex shrink-0 items-center rounded-full ${s.gap} ${CONTAINER[variant]} ${className}`}
    >
      {item("play", "Play")}
      {item("real", "Real")}
    </div>
  );
}
