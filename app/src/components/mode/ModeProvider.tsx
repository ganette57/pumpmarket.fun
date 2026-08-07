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
// FIRST-SWITCH CONFIRMATION
// -------------------------
// Switching between virtual and real money deserves one explanation — and
// exactly one. `requestMode()` is the INTERACTIVE path: it shows the
// explainer the first time the user enters a given mode, then never again.
// `setMode()` remains the direct path for programmatic changes, so nothing
// can accidentally put a modal on the screen without a user gesture.
//
// The acknowledgement lives in localStorage rather than the cookie: it is a
// per-device UI courtesy, not state the server needs to render anything.
// It is read lazily inside the click handler, never during render, so it
// cannot reintroduce a hydration mismatch.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ModeChangeDialog from "@/components/mode/ModeChangeDialog";
import ModeChangeToast from "@/components/mode/ModeChangeToast";
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
   * User-initiated switch. Shows the one-time explainer for a mode the user
   * has never entered on this device, then switches. Otherwise instant.
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

const ACK_KEY_PREFIX = "fm_mode_ack:";

/** Has the user already been told what this mode means, on this device? */
function hasAcknowledged(mode: TradingMode): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ACK_KEY_PREFIX + mode) === "1";
  } catch {
    // Private browsing / storage disabled: treat as acknowledged so a
    // broken localStorage cannot trap the user behind a modal every switch.
    return true;
  }
}

function markAcknowledged(mode: TradingMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACK_KEY_PREFIX + mode, "1");
  } catch {
    // Storage unavailable. Nothing is recorded, but hasAcknowledged() also
    // returns true in that case, so the explainer stays suppressed rather
    // than reappearing on every switch.
  }
}

/** How long the "Play mode" / "Real mode" confirmation toast stays up. */
const TOAST_MS = 1800;

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
  const [toast, setToast] = useState<TradingMode | null>(null);

  const setMode = useCallback((next: TradingMode) => {
    setModeState((prev) => (prev === next ? prev : next));
    persistMode(next);
  }, []);

  /** Switch + acknowledge + announce. The tail shared by both paths. */
  const commitMode = useCallback(
    (next: TradingMode) => {
      markAcknowledged(next);
      setMode(next);
      setToast(next);
    },
    [setMode]
  );

  const requestMode = useCallback(
    (next: TradingMode) => {
      if (next === mode) return;
      if (hasAcknowledged(next)) {
        commitMode(next);
        return;
      }
      setPending(next);
    },
    [mode, commitMode]
  );

  // commitMode() runs OUTSIDE the state updater: an updater must be pure,
  // and React may invoke it more than once (Strict Mode double-invokes in
  // dev), which would fire the switch and the toast twice.
  const confirmPending = useCallback(() => {
    if (!pending) return;
    const next = pending;
    setPending(null);
    commitMode(next);
  }, [pending, commitMode]);

  const cancelPending = useCallback(() => setPending(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

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
      <ModeChangeToast mode={toast} />
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
