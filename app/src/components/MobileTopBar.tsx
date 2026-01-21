// src/components/MobileTopBar.tsx
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export default function MobileTopBar({ showSearch }: { showSearch: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();

  const initialQ = useMemo(() => sp.get("q") || "", [sp]);
  const [q, setQ] = useState(initialQ);
  const { connected, publicKey, disconnect } = useWallet();
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
    router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
  }

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[70] border-b border-gray-800 bg-black/80 backdrop-blur">
        {/* Row 1 */}
        <div className="pl-1 pr-4 h-14 flex items-center gap-3">
          {/* Brand */}
          <Link href="/" className="flex items-center flex-1 min-w-0 -ml-1">
  <div className="h-24 w-24 shrink-0">
    <img
      src="/logo4.png"
      alt="FunMarket"
      className="h-full w-full object-contain"
    />
  </div>

  <div className="flex items-center gap-2 min-w-0">
    <span className="font-semibold text-white truncate">FunMarket</span>
    <span className="shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full bg-pump-green text-black">
      beta
    </span>
  </div>
</Link>

         {/* Menu button */}
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
      <div className="p-3">
        <WalletMultiButton className="!h-10 !w-full !justify-center !rounded-xl !bg-pump-green !text-black hover:!opacity-90 !font-semibold" />
      </div>

      <div className="h-px bg-gray-800" />

      {connected && (
        <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
          Dashboard
        </Link>
      )}

      <Link href="/leaderboard" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
        🏆 Leaderboard
      </Link>

      <Link href="/affiliate" onClick={() => setMenuOpen(false)} className="block px-4 py-3 text-white/90 hover:bg-white/5">
        💸 Affiliate
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

      {/* Spacer */}
      <div className={showSearch ? "h-[112px]" : "h-[52px]"} />
    </>
  );
}