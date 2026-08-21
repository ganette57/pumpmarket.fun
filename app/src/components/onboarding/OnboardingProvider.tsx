"use client";

// src/components/onboarding/OnboardingProvider.tsx
//
// Owns WHEN the three-step tour is on screen, and nothing about what it says.
//
// FIRST RUN ONLY
// --------------
// It auto-opens exactly once per browser, on the first render after mount,
// and marks itself seen the moment it closes for ANY reason — Skip, Maybe
// later, Escape, the scrim, or finishing. There is no second automatic
// showing, and nothing here re-opens it on navigation: the provider is
// mounted once, above the router outlet, so the tour survives a route change
// rather than being re-triggered by one.
//
// The auto-open decision is made in an effect, never in a state initializer:
// localStorage does not exist on the server, and reading it during render
// would hand React a different first paint on the client — the hydration
// mismatch ModeProvider goes to some length to avoid.
//
// When localStorage cannot be read at all (private mode, storage disabled)
// the tour does NOT auto-open. A modal on every single page load is a worse
// failure than a missed introduction, and "How it works" still reaches it.
//
// REPLAY
// ------
// open() is the "How it works" entry in the desktop account menu and the
// mobile menu. It shows the same three steps and never clears the flag, so
// replaying the tour cannot turn a returning user back into a first-run one.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import FunMarketOnboarding from "@/components/onboarding/FunMarketOnboarding";

/** Bump the suffix to re-introduce the tour after a material rewrite. */
const SEEN_KEY = "fm_onboarding_v1";

function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Unreadable storage means we cannot promise "once", so we promise
    // "never automatically" instead.
    return true;
  }
}

function markOnboardingSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* nothing to do — the tour simply may show again on a later visit */
  }
}

type OnboardingContextValue = {
  /** Opens the tour on demand. Used by the "How it works" menu entries. */
  open: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!hasSeenOnboarding()) setIsOpen(true);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    markOnboardingSeen();
    setIsOpen(false);
  }, []);

  const value = useMemo<OnboardingContextValue>(() => ({ open }), [open]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {isOpen && <FunMarketOnboarding onClose={close} />}
    </OnboardingContext.Provider>
  );
}

/**
 * Safe to call from anywhere under the provider. Returns a no-op opener when
 * the provider is absent so a header rendered outside the shell (tests,
 * stories) still builds.
 */
export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext) ?? { open: () => {} };
}
