// src/components/MobileTopBar.tsx
//
// The mobile app header for every non-immersive surface: trade, leaderboard,
// explorer, dashboard, profile. (/ , /live and /live/[id] render their own
// headers — see AppShell.)
//
// LAYOUT: [ balance ]   [ PLAY | REAL ]   [ menu ]
//
// The FunMarket wordmark used to own the whole left half and pushed the mode
// switch against the menu button. Mode is the control users actually reach
// for on mobile, so the wordmark is gone and the switch sits dead centre.
// Branding still lives in the tab title, the favicon and the desktop header.
//
// Centring is done with a three-column grid whose outer columns are equal
// fractions, NOT with flex + ml-auto: that way the switch stays optically
// centred whether the balance pill reads "$850", "12.4K SOL" or is absent
// entirely (no wallet connected).
//
// DELIBERATELY COMPACT. The immersive home feed enlarges its own copies of
// these controls to 44px — see src/app/page.tsx — because there they float
// over video as the only chrome on screen. That sizing is requested there by
// name (ModeSwitch size="xl") and must not leak here: this bar sits on
// ordinary pages that have their own content to lead with.

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AccountPanel from "@/components/wallet/AccountPanel";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import ModeSwitch from "@/components/mode/ModeSwitch";
import ModeBalancePill from "@/components/mode/ModeBalancePill";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";

export default function MobileTopBar({ showSearch }: { showSearch: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();

  const initialQ = useMemo(() => sp.get("q") || "", [sp]);
  const [q, setQ] = useState(initialQ);
  const { connected, publicKey, disconnect } = useFunMarketWallet();
const onboarding = useOnboarding();
const [menuOpen, setMenuOpen] = useState(false);
const menuRef = useRef<HTMLDivElement | null>(null);
const DOCS_URL = "https://funmarket.gitbook.io/funmarket/";
const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";
const PRIVACY_URL = "https://funmarket.gitbook.io/funmarket/privacy-policy";
// (optionnel) une page affiliate/leaderboard si tu la gardes sur le site

useEffect(() => {
  function onDown(e: MouseEvent) {
    if (!menuRef.current) return;
    if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
  }
  document.addEventListener("mousedown", onDown);
  return () => document.removeEventListener("mousedown", onDown);
}, []);

const avatarLabel = useMemo(() => {
  const s = publicKey?.toBase58();
  return s ? s.slice(0, 2).toUpperCase() : "☰";
}, [publicKey]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQ(sp.get("q") || "");
  }, [sp]);

  useEffect(() => {
    if (!showSearch) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [showSearch]);

  function submit(next?: string) {
    const value = (next ?? q).trim();
    router.push(value ? `/explorer?q=${encodeURIComponent(value)}` : "/explorer");
  }

  return (
    <>
      <div
        className={`fixed top-0 left-0 right-0 z-[70] border-b border-gray-800 bg-black/80 backdrop-blur ${showSearch ? "h-[116px]" : "h-16"}`}
        // Kept off the notch / status bar in standalone (PWA) mode. The
        // spacer below carries the identical padding so nothing shifts.
        // content-box because Tailwind's preflight is border-box globally:
        // without it the safe-area padding would eat into h-16 instead of
        // adding to it, and the row would overflow its own bar.
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
      >
        {/* Row 1 */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 h-16 px-3">
          {/* Left: active-mode balance */}
          <div className="flex min-w-0 items-center justify-start">
            <ModeBalancePill variant="header" />
          </div>

          {/* Centre: Play / Real mode — the primary control on mobile */}
          <ModeSwitch size="sm" variant="header" />

          {/* Right: menu / wallet */}
          <div className="flex min-w-0 items-center justify-end">
<div className="shrink-0 relative" ref={menuRef}>
  <button
    type="button"
    onClick={() => setMenuOpen((v) => !v)}
    className="h-9 w-9 rounded-full border border-gray-800 bg-black/40 text-white text-xs font-semibold flex items-center justify-center"
    aria-label="Open menu"
  >
    {connected ? avatarLabel : "☰"}
  </button>

  {menuOpen && (
    <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-gray-800 bg-black/90 backdrop-blur shadow-xl overflow-hidden">
      <AccountPanel onNavigate={() => setMenuOpen(false)} />

      <div className="h-px bg-gray-800" />

      {connected && (
        <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
          Dashboard
        </Link>
      )}

      <Link href="/leaderboard" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
        🏆 Leaderboard
      </Link>

      <Link href="/referrals" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
        🤝 Referrals
      </Link>

      <Link href="/treasury" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
        💰 Treasury
      </Link>

      <a
  href={DOCS_URL}
  target="_blank"
  rel="noopener noreferrer"
  onClick={() => setMenuOpen(false)}
  className="block px-4 py-3 text-white/90 hover:bg-white/5"
>
  📚 Documentation
</a>

<a
  href={TERMS_URL}
  target="_blank"
  rel="noopener noreferrer"
  onClick={() => setMenuOpen(false)}
  className="block px-4 py-3 text-white/90 hover:bg-white/5"
>
  📜 Terms of Use
</a>

<a
  href={PRIVACY_URL}
  target="_blank"
  rel="noopener noreferrer"
  onClick={() => setMenuOpen(false)}
  className="block px-4 py-3 text-white/90 hover:bg-white/5"
>
  🔒 Privacy Policy
</a>

{/* Replays the three-step tour. Same steps as first run; opening
    it here never resets the first-run flag. */}
<button
  type="button"
  onClick={() => {
    setMenuOpen(false);
    onboarding.open();
  }}
  className="block w-full px-4 py-3 text-left font-bold text-pump-green hover:bg-white/5"
>
  How it works
</button>

      {connected && (
        <>
          <div className="h-px bg-gray-800" />
          <button
            type="button"
            onClick={async () => {
              setMenuOpen(false);
              try { await disconnect(); } catch {}
            }}
            className="w-full text-left px-4 py-3 text-red-400 hover:bg-white/5"
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  )}
</div>
          </div>
        </div>

        {/* Search */}
        {showSearch && (
          <div className="px-4 pb-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Search markets…"
                className="w-full rounded-xl bg-black/40 border border-gray-800 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none focus:border-pump-green/60"
              />

              <button
                type="button"
                onClick={() => submit()}
                className="rounded-xl px-4 py-3 text-sm font-extrabold bg-pump-green text-black"
              >
                Go
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer — must match the fixed bar's height AND its safe-area pad */}
      <div
        className={showSearch ? "h-[116px]" : "h-16"}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
      />
          </>
  );
}
