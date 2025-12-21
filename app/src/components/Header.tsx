'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import HowItWorksModal from '@/components/HowItWorksModal';

// --- Hook pour fermer le menu avatar quand on clique en dehors ---
function useClickOutside(ref: React.RefObject<HTMLDivElement>, onClose: () => void) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, onClose]);
}

export default function Header() {
  const router = useRouter();
  const { connected, publicKey, disconnect } = useWallet();

  const [search, setSearch] = useState('');
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false));

  const avatarLabel = publicKey
    ? publicKey.toBase58().slice(0, 2).toUpperCase()
    : '??';

  const handleSearchSubmit = () => {
    const q = search.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-pump-border bg-pump-dark/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo + name -> home */}
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-pump-border bg-black text-sm font-semibold text-white">
              F
            </div>
            <span className="text-lg font-semibold text-white">
              Funmarket
            </span>
          </Link>

          {/* Search bar */}
          <div className="flex-1">
            <div className="flex items-center rounded-full border border-pump-border bg-black px-4 py-2 text-sm text-gray-300">
              <button
                type="button"
                onClick={handleSearchSubmit}
                className="mr-3 text-gray-500 hover:text-gray-300"
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
          <div className="flex items-center gap-3">
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

            {/* Wallet button (violet par défaut, style lib) */}
            <div className="flex items-center">
              <WalletMultiButton />
            </div>

            {/* Avatar + menu quand wallet connecté */}
            {connected && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-pump-border bg-black text-xs font-semibold text-white hover:border-pump-green transition"
                >
                  {avatarLabel}
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-40 rounded-xl border border-pump-border bg-pump-gray shadow-lg py-1 text-sm text-gray-100">
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
                          // ignore errors
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

      {/* How it works modal */}
      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
      />
    </>
  );
}