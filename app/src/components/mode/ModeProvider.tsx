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
//
// MODE CONFIRMATION
// -----------------
// Every real crossing between virtual and real money stops for a
// confirmation. `requestMode()` is the INTERACTIVE path and never switches
// anything on its own — it only opens the dialog. `setMode()` remains the
// direct path for programmatic changes, so nothing can put a modal on
// screen without a user gesture, and nothing can switch modes behind the
// dialog's back.
//
// There is deliberately no "you have seen this already" memory. The dialog
// is a safety step, not an onboarding tip, so it is worth one tap every
// time real funds come into or out of play. Nothing here reads or writes
// localStorage.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ModeChangeDialog from "@/components/mode/ModeChangeDialog";
import {
  DEFAULT_TRADING_MODE,
  FM_MODE_COOKIE,
  FM_MODE_MAX_AGE_SECONDS,
  type TradingMode,
} from "@/lib/tradingMode";

type TradingModeContextValue = {
  mode: TradingMode;
  /** Direct, silent switch. Use for programmatic changes. */
  setMode: (next: TradingMode) => void;
  /**
   * User-initiated switch. Opens the confirmation dialog for any actual
   * mode change; the switch happens only once the user confirms.
   */
  requestMode: (next: TradingMode) => void;
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
  /** The mode awaiting confirmation, or null when no dialog is open. */
  const [pending, setPending] = useState<TradingMode | null>(null);

  const setMode = useCallback((next: TradingMode) => {
    setModeState((prev) => (prev === next ? prev : next));
    persistMode(next);
  }, []);

  // Opens the dialog and nothing else. Tapping the mode you are already in
  // is a no-op, so the dialog never appears without a mode actually
  // changing — and it can only ever be opened from this call, which is why
  // a page load cannot produce one.
  const requestMode = useCallback(
    (next: TradingMode) => {
      if (next === mode) return;
      setPending(next);
    },
    [mode]
  );

  // setMode() runs OUTSIDE the state updater: an updater must be pure, and
  // React may invoke it more than once (Strict Mode double-invokes in dev),
  // which would write the cookie twice.
  const confirmPending = useCallback(() => {
    if (!pending) return;
    const next = pending;
    setPending(null);
    setMode(next);
  }, [pending, setMode]);

  const cancelPending = useCallback(() => setPending(null), []);

  const value = useMemo<TradingModeContextValue>(
    () => ({
      mode,
      setMode,
      requestMode,
      isPlay: mode === "play",
      isReal: mode === "real",
    }),
    [mode, setMode, requestMode]
  );

  return (
    <TradingModeContext.Provider value={value}>
      {children}
      <ModeChangeDialog
        pending={pending}
        onConfirm={confirmPending}
        onCancel={cancelPending}
      />
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
