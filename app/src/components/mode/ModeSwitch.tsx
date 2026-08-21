"use client";

// src/components/mode/ModeSwitch.tsx
//
// PLAY | REAL segmented control.
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
// SIZES
// -----
// `sm` / `md` are the compact pills the overlay surfaces use on top of video.
// `xl` is the same compact LOOK at thumb size (44px, the iOS minimum target)
// for the immersive home feed, where the control is the only chrome on screen
// and was reading as a filter chip. It keeps `sm`'s colours and its dotless
// segments deliberately — the feed is not the place to introduce a treatment
// the rest of the app does not have.
//
// Its 36px segment height and 16px label are FIXED; only the horizontal
// padding steps down as the viewport narrows. The feed header has to fit a
// balance, this control and a search button on one 375px row, and the thing
// that must never shrink there is the touch target.
// `lg` is the prominent header control: 32px segments inside 3px of padding,
// so the group is 38px tall and still clears the 64px header. At that size
// each segment carries a status dot, and REAL-active reads as an OUTLINED
// "live funds" chip rather than a second green fill — the two modes must not
// look interchangeable when one of them spends real SOL. The dot is rendered
// in every state (grey when inactive) so the pill does not change width when
// the mode changes.
//
// It calls requestMode() rather than setMode(), which is what gives every
// instance of this control — mobile header, home feed, Live tabs, desktop
// header — the same "Switch to Real?" confirmation for free.

import { useTradingMode } from "@/components/mode/ModeProvider";
import type { TradingMode } from "@/lib/tradingMode";

type Size = "sm" | "md" | "lg" | "xl";

/**
 * `header`  — solid surfaces (desktop header, mobile top bar)
 * `overlay` — on top of video/imagery (mobile feed, Live), needs blur + contrast
 */
type Variant = "header" | "overlay";

const CONTAINER: Record<Variant, string> = {
  header: "border border-gray-700/60 bg-black/40",
  overlay: "border border-white/10 bg-black/65 backdrop-blur-md",
};

const SIZE: Record<
  Size,
  {
    pad: string;
    text: string;
    weight: string;
    gap: string;
    dot: string | null;
    /**
     * Overrides the variant's shell. Only the prominent desktop control takes
     * the design's solid-black / 13%-white treatment; every compact consumer
     * keeps the shell its variant has always had, so sizing this component up
     * for one surface cannot restyle the others.
     */
    shell?: string;
  }
> = {
  sm: { pad: "px-2.5 py-1", text: "text-[10px] tracking-wide", weight: "font-bold", gap: "p-0.5", dot: null },
  md: { pad: "px-3 py-1.5", text: "text-xs tracking-wide", weight: "font-bold", gap: "p-1", dot: null },
  lg: {
    pad: "h-8 px-4",
    text: "text-xs tracking-[0.05em]",
    weight: "font-extrabold",
    gap: "p-[3px]",
    dot: "h-1.5 w-1.5",
    shell: "border border-white/[0.13] bg-black",
  },
  // 36px segments + 3px padding + 1px border = 44px overall. Segment padding
  // tightens below 360px so the row still clears a 320px screen without the
  // control itself shrinking.
  xl: {
    pad: "h-9 px-3 max-[389px]:px-2.5 max-[359px]:px-2",
    text: "text-base tracking-normal",
    weight: "font-semibold",
    gap: "p-[3px]",
    dot: null,
  },
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
    // Only the prominent size differentiates the two active fills; the
    // compact pills stay as they were on the overlay surfaces.
    const outlinedReal = !!s.dot && value === "real";

    const state = !active
      ? "text-gray-400 hover:text-gray-200"
      : outlinedReal
      ? "bg-[#101319] text-white ring-1 ring-inset ring-pump-green/55"
      : s.dot
      ? "bg-pump-green text-black shadow-[0_4px_16px_rgba(0,255,136,0.28)]"
      : "bg-pump-green text-black";

    const dotTone = !active
      ? "bg-gray-700"
      : outlinedReal
      ? "bg-pump-green shadow-[0_0_8px_#00ff88]"
      : "bg-black/45";

    return (
      <button
        key={value}
        type="button"
        onClick={() => requestMode(value)}
        aria-pressed={active}
        aria-label={`Switch to ${label} mode`}
        className={`inline-flex items-center justify-center gap-1.5 rounded-full uppercase transition-colors duration-150 ${s.pad} ${s.text} ${s.weight} ${state}`}
      >
        {s.dot && (
          <span
            aria-hidden="true"
            className={`${s.dot} shrink-0 rounded-full ${dotTone}`}
          />
        )}
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Trading mode"
      className={`inline-flex shrink-0 items-center rounded-full ${s.gap} ${s.shell ?? CONTAINER[variant]} ${className}`}
    >
      {item("play", "Play")}
      {item("real", "Real")}
    </div>
  );
}
