"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  getFollowers,
  getFollowing,
  type FollowEdge,
} from "@/lib/profiles";

type Mode = "followers" | "following";

interface FollowListModalProps {
  open: boolean;
  onClose: () => void;
  wallet: string;
  mode: Mode;
}

const TRANSITION_MS = 240;

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function initials(src: string) {
  return src.trim().slice(0, 2).toUpperCase();
}

export default function FollowListModal({
  open,
  onClose,
  wallet,
  mode,
}: FollowListModalProps) {
  const [rows, setRows] = useState<FollowEdge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mount/unmount with a brief slide animation. `mounted` controls DOM
  // presence; `shown` controls the transform/opacity classes.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Lock body scroll while the sheet is mounted.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Lazy-load list whenever the sheet opens or the mode/wallet changes.
  useEffect(() => {
    if (!open || !wallet) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const list =
          mode === "followers" ? await getFollowers(wallet) : await getFollowing(wallet);
        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load list.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, wallet, mode]);

  function handleClose() {
    onClose();
  }

  if (!mounted) return null;

  const title = mode === "followers" ? "Followers" : "Following";
  const emptyText =
    mode === "followers" ? "No followers yet" : "Not following anyone yet";

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label={title}>
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />

      {/* Sheet (mobile: bottom) / Drawer (desktop: right side) */}
      <div
        className={[
          "absolute bg-[#0a0b0d] text-white shadow-[0_-12px_40px_rgba(0,0,0,0.55)]",
          // Mobile: full-width bottom sheet
          "left-0 right-0 bottom-0 h-[82vh] max-h-[82vh] rounded-t-2xl border-t border-gray-800",
          // Desktop: right-side drawer
          "md:left-auto md:right-4 md:top-1/2 md:bottom-auto md:-translate-y-1/2 md:h-[80vh] md:max-h-[80vh] md:w-[460px] md:rounded-2xl md:border md:border-gray-800 md:shadow-[0_20px_60px_rgba(0,0,0,0.6)]",
          // Slide animation — mobile slides up, desktop slides in from right
          "transition-transform duration-[240ms] ease-out will-change-transform",
          shown
            ? "translate-y-0 md:translate-y-[-50%] md:translate-x-0"
            : "translate-y-full md:translate-y-[-50%] md:translate-x-[110%]",
        ].join(" ")}
      >
        <div className="flex h-full flex-col">
          {/* Drag handle (mobile only) */}
          <div className="md:hidden flex justify-center pt-2.5 pb-1">
            <span className="h-1 w-10 rounded-full bg-gray-700" />
          </div>

          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-[#0a0b0d]/95 backdrop-blur">
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={handleClose}
              className="-mr-1 p-1 text-gray-400 hover:text-white"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {error && (
              <p className="px-5 py-6 text-sm text-red-400">{error}</p>
            )}

            {!error && rows === null && (
              <div className="px-3 py-3 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                    <div className="h-11 w-11 rounded-full bg-gray-900/80 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-1/2 rounded bg-gray-900/80 animate-pulse" />
                      <div className="h-2.5 w-1/3 rounded bg-gray-900/60 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!error && rows !== null && rows.length === 0 && (
              <div className="flex flex-1 items-center justify-center px-5 py-16">
                <p className="text-sm text-gray-400">{emptyText}</p>
              </div>
            )}

            {!error && rows !== null && rows.length > 0 && (
              <ul className="py-1">
                {rows.map((row) => {
                  const profile = row.profile;
                  const name =
                    profile?.display_name && profile.display_name.trim().length > 0
                      ? profile.display_name
                      : shortAddr(row.wallet_address);
                  const avatar = profile?.avatar_url || null;
                  const initialSrc = profile?.display_name || row.wallet_address;
                  const subtitle =
                    profile?.bio && profile.bio.trim().length > 0
                      ? profile.bio.trim()
                      : shortAddr(row.wallet_address);
                  return (
                    <li key={row.wallet_address}>
                      <Link
                        href={`/profile/${row.wallet_address}`}
                        onClick={handleClose}
                        className="flex items-center gap-3 px-4 py-2.5 active:bg-white/[0.04] hover:bg-white/[0.03] transition-colors"
                      >
                        <span className="h-11 w-11 rounded-full overflow-hidden bg-gray-900 ring-1 ring-white/5 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span>{initials(initialSrc)}</span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold text-white truncate leading-tight">
                            {name}
                          </span>
                          <span className="block text-[12px] text-gray-500 truncate leading-snug">
                            {subtitle}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
