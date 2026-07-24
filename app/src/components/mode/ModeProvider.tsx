"use client";

// src/components/mode/ModeProvider.tsx
//
// The single source of truth for the global Play/Real trading mode.
//
// Deliberately contains NO trading logic: no balances, no quotes, no
// execution, no API calls, no wallet. It answers exactly one question —
// "which mode is the user in?" — and persists the answer.
//
// NO-FLASH CONTRACT
// -----------------
// `initialMode` is read from the fm_mode cookie by the ROOT LAYOUT on the
// server and passed in, so the server's first paint and the client's first
// render agree. That is why this is a prop and not a document.cookie read
// in a useState initializer: the latter returns the default on the server
// and the real value on the client, which is precisely the hydration
// mismatch we must avoid.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_TRADING_MODE,
  FM_MODE_COOKIE,
  FM_MODE_MAX_AGE_SECONDS,
  type TradingMode,
} from "@/lib/tradingMode";

type TradingModeContextValue = {
  mode: TradingMode;
  setMode: (next: TradingMode) => void;
  isPlay: boolean;
  isReal: boolean;
};

const TradingModeContext = createContext<TradingModeContextValue | null>(null);

/** Writes the cookie client-side so switching never needs a reload. */
function persistMode(next: TradingMode) {
  if (typeof document === "undefined") return;
  // `secure` is omitted on http://localhost — browsers drop Secure cookies
  // on insecure origins, which would silently break persistence in dev.
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; secure"
      : "";
  document.cookie =
    `${FM_MODE_COOKIE}=${next}; path=/; max-age=${FM_MODE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

export function ModeProvider({
  initialMode = DEFAULT_TRADING_MODE,
  children,
}: {
  initialMode?: TradingMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<TradingMode>(initialMode);

  const setMode = useCallback((next: TradingMode) => {
    setModeState((prev) => (prev === next ? prev : next));
    persistMode(next);
  }, []);

  const value = useMemo<TradingModeContextValue>(
    () => ({
      mode,
      setMode,
      isPlay: mode === "play",
      isReal: mode === "real",
    }),
    [mode, setMode]
  );

  return (
    <TradingModeContext.Provider value={value}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode(): TradingModeContextValue {
  const ctx = useContext(TradingModeContext);
  if (!ctx) {
    throw new Error("useTradingMode must be used inside <ModeProvider>");
  }
  return ctx;
}
