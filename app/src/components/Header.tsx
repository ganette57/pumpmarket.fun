'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import HowItWorksModal from '@/components/HowItWorksModal';

// --- Hook pour fermer le menu avatar quand on clique en dehors ---
function useClickOutside(ref: React.RefObject<HTMLDivElement>, onClose: () => void) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, onClose]);
}

export default function Header() {
  const router = useRouter();
  const sp = useSearchParams();
  const { connected, publicKey, disconnect } = useWallet();

  const [search, setSearch] = useState('');
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false));
  const DOCS_URL = "https://funmarket.gitbook.io/funmarket/";
const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";
const PRIVACY_URL = "https://funmarket.gitbook.io/funmarket/privacy-policy";
// (optionnel) une page affiliate/leaderboard si tu la gardes sur le site

  // pré-remplir search si on est sur /search?q=
  useEffect(() => {
    const q = sp.get('q') || '';
    setSearch(q);
  }, [sp]);

  const avatarLabel = useMemo(() => {
    return publicKey ? publicKey.toBase58().slice(0, 2).toUpperCase() : '??';
  }, [publicKey]);

  const handleSearchSubmit = () => {
    const q = search.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  return (
    <>
      {/* HEADER FIXE */}
      <header className="fixed top-0 left-0 right-0 z-[70] border-b border-gray-700/40 bg-pump-dark/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 py-4 pl-3 pr-4 sm:pl-4 sm:pr-6 lg:pl-4 lg:pr-8">
          {/* Logo + name -> home */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
  <img
    src="/logo4.png"
    alt="FunMarket"
    className="h-16 w-16 object-contain"
  />

  <div className="flex items-center gap-2">
    <span className="text-xl font-bold text-white">FunMarket</span>
    <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-pump-green text-black">
      beta
    </span>
  </div>
</Link>

          {/* Search bar */}
          <div className="flex-1 min-w-0">
          <div className="flex items-center rounded-lg border border-gray-700/60 bg-black px-4 py-2 text-sm text-gray-300">
              <button
                type="button"
                onClick={handleSearchSubmit}
                className="mr-3 text-gray-600 hover:text-gray-400 transition"
                aria-label="Search"
              >
                ⌕
              </button>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchSubmit();
                }}
                placeholder="Search markets, creators, categories..."
                className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {/* Right side */}
<div className="flex items-center gap-3 shrink-0">
  {/* How it works */}
  <button
    type="button"
    onClick={() => setIsHowItWorksOpen(true)}
    className="hidden text-sm text-gray-300 hover:text-white md:inline-block"
  >
    How it works
  </button>

  {/* Create */}
  <Link
    href="/create"
    className="inline-flex h-11 items-center justify-center rounded-full bg-pump-green px-6 text-sm font-semibold text-black hover:bg-pump-green/90 transition"
  >
    Create
  </Link>

  {/* Avatar/Menu (always visible) */}
  <div className="relative" ref={menuRef}>
    <button
      type="button"
      onClick={() => setMenuOpen((v) => !v)}
      className="flex h-11 w-11 items-center justify-center rounded-full
                 border border-gray-700
                 bg-gray-900
                 text-l font-semibold text-gray-200
                 hover:border-gray-400 hover:text-white
                 transition"
      aria-label="Open menu"
    >
      {connected ? avatarLabel : "☰"}
    </button>

    {menuOpen && (
      <div className="absolute right-0 mt-2 w-64 rounded-xl border border-pump-border bg-pump-gray shadow-lg py-2 text-sm text-gray-100">
        {/* Wallet connect/disconnect (top) */}
        <div className="px-3 pb-2">
          <WalletMultiButton className="!h-10 !w-full !justify-center !rounded-lg !bg-pump-green !text-black hover:!opacity-90 !font-semibold" />
        </div>

        <div className="h-px bg-gray-700/50 my-1" />

        {/* Connected-only */}
        {connected && (
          <Link
            href="/dashboard"
            className="block px-4 py-2 hover:bg-pump-dark"
            onClick={() => setMenuOpen(false)}
          >
            Dashboard
          </Link>
        )}

        {/* Public pages */}
        <Link
          href="/leaderboard"
          className="block px-4 py-2 hover:bg-pump-dark"
          onClick={() => setMenuOpen(false)}
        >
          🏆 Leaderboard
        </Link>

        <Link
          href="/affiliate"
          className="block px-4 py-2 hover:bg-pump-dark"
          onClick={() => setMenuOpen(false)}
        >
          💸 Affiliate
        </Link>

        <a
  href={DOCS_URL}
  target="_blank"
  rel="noopener noreferrer"
  className="block px-4 py-2 hover:bg-pump-dark"
  onClick={() => setMenuOpen(false)}
>
  📚 Documentation
</a>

<a
  href={TERMS_URL}
  target="_blank"
  rel="noopener noreferrer"
  className="block px-4 py-2 hover:bg-pump-dark"
  onClick={() => setMenuOpen(false)}
>
  📜 Terms of Use
</a>

<a
  href={PRIVACY_URL}
  target="_blank"
  rel="noopener noreferrer"
  className="block px-4 py-2 hover:bg-pump-dark"
  onClick={() => setMenuOpen(false)}
>
  🔒 Privacy Policy
</a>

        {/* Disconnect */}
        {connected && (
          <>
            <div className="h-px bg-gray-700/50 my-1" />
            <button
              type="button"
              className="block w-full px-4 py-2 text-left text-red-400 hover:bg-pump-dark hover:text-red-300"
              onClick={async () => {
                setMenuOpen(false);
                try {
                  await disconnect();
                } catch {
                  // ignore
                }
              }}
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
      </header>

      {/* SPACER : évite que le contenu passe sous le header fixe */}
      <div className="h-[64px]" />

      {/* How it works modal */}
      <HowItWorksModal isOpen={isHowItWorksOpen} onClose={() => setIsHowItWorksOpen(false)} />
    </>
  );
}
