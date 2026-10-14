// src/components/MobileTopBar.tsx
//
// The mobile app header for every non-immersive surface: trade, leaderboard,
// explorer, dashboard, profile. (/ , /live and /live/[id] render their own
// headers — see AppShell.)
//
// LAYOUT: [ balance ]   [ PLAY | REAL ]   [ leaderboard ] [ referrals ]
//
// The FunMarket wordmark used to own the whole left half and pushed the mode
// switch against the menu button. Mode is the control users actually reach
// for on mobile, so the wordmark is gone and the switch remains prominent.
// Branding still lives in the tab title, the favicon and the desktop header.
//
// Equal minmax side columns keep the mode switch centred on the viewport,
// independently of the different widths of the balance and quick actions.
// The compact mobile balance fits inside its side without moving the centre.
//
// DELIBERATELY COMPACT. The immersive home feed enlarges its own copies of
// these controls to 44px — see src/app/page.tsx — because there they float
// over video as the only chrome on screen. That sizing is requested there by
// name (ModeSwitch size="xl") and must not leak here: this bar sits on
// ordinary pages that have their own content to lead with.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import ModeSwitch from "@/components/mode/ModeSwitch";
import ModeBalancePill from "@/components/mode/ModeBalancePill";
import MobileHeaderActions from "@/components/MobileHeaderActions";

export default function MobileTopBar({ showSearch, showClose = false, actions }: { showSearch: boolean; showClose?: boolean; actions?: React.ReactNode }) {
  const router = useRouter();
  const sp = useSearchParams();

  const initialQ = useMemo(() => sp.get("q") || "", [sp]);
  const [q, setQ] = useState(initialQ);

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
        className={`fixed top-0 left-0 right-0 z-[70] ${showClose ? "border-b border-white/[0.04] bg-black/35 backdrop-blur-xl backdrop-saturate-150" : "border-b border-gray-800 bg-black/80 backdrop-blur"} ${showSearch ? "h-[116px]" : "h-16"}`}
        // Kept off the notch / status bar in standalone (PWA) mode. The
        // spacer below carries the identical padding so nothing shifts.
        // content-box because Tailwind's preflight is border-box globally:
        // without it the safe-area padding would eat into h-16 instead of
        // adding to it, and the row would overflow its own bar.
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
      >
        {/* Row 1 */}
        <div className="grid h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2.5 min-[390px]:gap-2 min-[390px]:px-3">
          {/* Left: active-mode balance */}
          <div className="flex min-w-0 items-center justify-start overflow-hidden">
            {showClose ? <button
              type="button"
              aria-label="Close market"
              onClick={() => { if (window.history.length > 1) router.back(); else router.replace("/"); }}
              className="flex h-11 w-11 items-center justify-center rounded-full text-gray-200 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green"
            >
              <X size={22} strokeWidth={1.6} aria-hidden="true" />
            </button> : <ModeBalancePill variant="header" className="max-w-full" />}
          </div>

          {/* Centre: Play / Real mode — the primary control on mobile */}
          <ModeSwitch size="sm" variant="header" />

          {/* Right: the two public destinations promoted by the mobile nav. */}
          <div className="flex min-w-0 items-center justify-end">
            {showClose ? (
              <div className="flex h-11 w-[88px] items-center">{actions}</div>
            ) : (
              <MobileHeaderActions />
            )}
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
