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
      <header className="fixed top-0 left-0 right-0 z-[70] border-b border-pump-border bg-pump-dark/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo + name -> home */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-pump-border bg-black text-sm font-semibold text-white">
              F
            </div>
            <div className="flex items-center gap-2">
  <span className="text-xl font-bold text-white">FunMarket</span>
  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-pump-green text-black">
    beta
  </span>
</div>
          </Link>

          {/* Search bar */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center rounded-full border border-pump-border bg-black px-4 py-2 text-sm text-gray-300">
              <button
                type="button"
                onClick={handleSearchSubmit}
                className="mr-3 text-gray-500 hover:text-gray-300"
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
                className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none"
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

            {/* Wallet button */}
            <div className="flex items-center">
              <WalletMultiButton className="!h-11 !rounded-full !bg-pump-green !text-black hover:!opacity-90 !font-semibold" />
            </div>

            {/* Avatar + menu quand wallet connecté */}
            {connected && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-pump-border bg-black text-xs font-semibold text-white hover:border-pump-green transition"
                  aria-label="User menu"
                >
                  {avatarLabel}
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border border-pump-border bg-pump-gray shadow-lg py-1 text-sm text-gray-100">
                    <Link
                      href="/dashboard"
                      className="block px-4 py-2 hover:bg-pump-dark"
                      onClick={() => setMenuOpen(false)}
                    >
                      Dashboard
                    </Link>

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
                  </div>
                )}
              </div>
            )}
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