"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveTradeSuccessDetails = {
  mode: "real" | "play";
  outcomeName: string;
  shares: number;
  /** Confirmed-flow amount: SOL for REAL, USD stake for PLAY. */
  amount: number | null;
};

type ActiveSuccess = LiveTradeSuccessDetails & { key: number };

const DISPLAY_MS = 2300;

function compactNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Latest confirmed trade wins; a rapid second buy restarts the animation. */
export function useLiveTradeSuccess() {
  const [success, setSuccess] = useState<ActiveSuccess | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef(0);

  const showTradeSuccess = useCallback((details: LiveTradeSuccessDetails) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const key = ++counterRef.current;
    setSuccess({ ...details, key });
    timerRef.current = setTimeout(() => {
      setSuccess((current) => (current?.key === key ? null : current));
      timerRef.current = null;
    }, DISPLAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { success, showTradeSuccess };
}

export default function LiveTradeSuccessOverlay({
  success,
}: {
  success: ActiveSuccess | null;
}) {
  if (!success) return null;

  const normalized = success.outcomeName.trim().toUpperCase();
  const positive = normalized === "YES";
  const negative = normalized === "NO";
  const accent = positive
    ? "#00ff87"
    : negative
      ? "#ff5c73"
      : "#7dd3fc";
  const amount = success.amount != null && success.amount > 0
    ? success.mode === "play"
      ? `$${compactNumber(success.amount, 2)}`
      : `${compactNumber(success.amount, 4)} SOL`
    : null;
  const shares = `${compactNumber(success.shares, 2)} share${success.shares === 1 ? "" : "s"}`;
  const detail = success.mode === "play"
    ? [amount, shares].filter(Boolean).join(" · ")
    : [shares, amount].filter(Boolean).join(" · ");

  return (
    <div
      key={success.key}
      role="status"
      aria-live="assertive"
      aria-label={`Trade placed for ${success.outcomeName}`}
      className="pointer-events-none fixed inset-0 z-[160] flex items-center justify-center px-4"
    >
      <div className="fm-live-trade-success relative -translate-y-[7vh]">
        <div
          aria-hidden
          className="fm-live-trade-success-burst absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: `radial-gradient(circle, ${accent}55 0%, ${accent}18 38%, transparent 72%)`,
          }}
        />
        <div
          aria-hidden
          className="fm-live-trade-success-ring absolute -inset-3 rounded-[1.75rem] border"
          style={{ borderColor: `${accent}55` }}
        />
        <div className="relative min-w-[17rem] max-w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-white/15 bg-black/90 px-7 py-6 text-center shadow-[0_22px_70px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div
            aria-hidden
            className="absolute inset-x-8 top-0 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
          <div
            className="fm-live-trade-success-check mx-auto flex h-11 w-11 items-center justify-center rounded-full border text-2xl font-black"
            style={{
              color: accent,
              borderColor: `${accent}99`,
              backgroundColor: `${accent}18`,
              boxShadow: `0 0 26px ${accent}55`,
            }}
          >
            ✓
          </div>
          <div className="mt-3 text-[11px] font-black tracking-[0.22em] text-white/75">
            TRADE PLACED
          </div>
          <div
            className="mt-1.5 truncate text-[clamp(2rem,9vw,3.4rem)] font-black leading-none tracking-tight"
            style={{ color: accent, textShadow: `0 0 24px ${accent}66` }}
          >
            {success.outcomeName}
          </div>
          <div className="mt-3 text-sm font-bold tabular-nums text-white/85">
            {detail}
          </div>
        </div>
      </div>

      <style>{`
        .fm-live-trade-success{animation:fm-live-trade-success 2.3s cubic-bezier(.2,.82,.2,1) both;transform-origin:center}
        .fm-live-trade-success-burst{animation:fm-live-trade-success-burst 2.3s ease-out both}
        .fm-live-trade-success-ring{animation:fm-live-trade-success-ring 2.3s ease-out both}
        .fm-live-trade-success-check{animation:fm-live-trade-success-check 2.3s cubic-bezier(.2,.82,.2,1) both}
        @keyframes fm-live-trade-success{0%{opacity:0;transform:translateY(-7vh) scale(.9)}9%{opacity:1;transform:translateY(-7vh) scale(1.03)}16%,76%{opacity:1;transform:translateY(-7vh) scale(1)}100%{opacity:0;transform:translateY(-7vh) scale(.96)}}
        @keyframes fm-live-trade-success-burst{0%{opacity:0;transform:translate(-50%,-50%) scale(.45)}14%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}52%{opacity:.55;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.18)}}
        @keyframes fm-live-trade-success-ring{0%{opacity:0;transform:scale(.82)}14%{opacity:.9;transform:scale(1.03)}48%{opacity:.35;transform:scale(1.08)}100%{opacity:0;transform:scale(1.18)}}
        @keyframes fm-live-trade-success-check{0%{transform:scale(.72) rotate(-8deg)}12%{transform:scale(1.12) rotate(2deg)}22%,100%{transform:scale(1) rotate(0)}}
        @media (prefers-reduced-motion:reduce){.fm-live-trade-success,.fm-live-trade-success-burst,.fm-live-trade-success-ring,.fm-live-trade-success-check{animation:none!important}}
      `}</style>
    </div>
  );
}
