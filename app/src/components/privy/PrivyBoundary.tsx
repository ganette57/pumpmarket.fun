"use client";

// src/components/privy/PrivyBoundary.tsx
//
// Keeps a broken Privy configuration from taking the whole site down.
//
// The `isPrivyConfigured()` check in PrivyAppProvider covers the app id
// being ABSENT, which is a supported configuration. This covers Privy
// failing at runtime once the app is already running — an SDK error after
// hydration, a provider that blows up on a config the dashboard changed
// under us. The app falls back to exactly the no-Privy path: Solana
// wallet adapter only, no Google login. A working product, just a
// smaller one.
//
// WHAT THIS DOES NOT COVER — READ BEFORE TRUSTING IT
// --------------------------------------------------
// An INVALID app id is caught by Privy synchronously during render
// ("Cannot initialize the Privy provider with an invalid Privy app ID").
// On the server that throw happens inside Next's app-router render, which
// intercepts it before React unwinds to this boundary — so a wrong
// NEXT_PUBLIC_PRIVY_APP_ID still produces a 500 on every route, verified
// against a deliberately bad id.
//
// The fix for that case is operational, not architectural: the app id
// must be correct or unset, and a deploy smoke test catches it on the
// first request. Making it survivable would mean deferring PrivyProvider
// to after mount, which remounts the entire app tree on hydration — a
// permanent cost on every page load to soften one class of config typo.
//
// Deliberately NOT a shape check on the app id. Privy validates it
// against its own format and backend; anything this file could pattern
// match would accept plenty of ids Privy rejects, and reject ids Privy
// might later issue. Catching the actual failure is honest, guessing at
// its shape is not.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Rendered instead of `children` once Privy has failed to initialize. */
  fallback: ReactNode;
};

type State = { failed: boolean };

export default class PrivyBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Loud in the console, silent in the UI. An operator needs to know
    // Google login is off; a trader does not need to hear about it while
    // the rest of the app works normally.
    console.error(
      "[Privy] provider failed to initialize — falling back to wallet-only " +
        "sign-in. Check NEXT_PUBLIC_PRIVY_APP_ID.",
      error,
      info.componentStack
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
