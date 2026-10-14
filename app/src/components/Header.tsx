'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import ModeSwitch from '@/components/mode/ModeSwitch';
import ModeBalancePill from '@/components/mode/ModeBalancePill';
import ProfileMenu from '@/components/ProfileMenu';

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [search, setSearch] = useState('');

  // Check if we're on explorer/search page
  const isOnSearchPage = pathname === '/search' || pathname === '/explorer';
  const isLeaderboard = pathname === '/leaderboard' || pathname?.startsWith('/leaderboard/');

  // pré-remplir search si on est sur /search?q=
  useEffect(() => {
    const q = sp.get('q') || '';
    setSearch(q);
  }, [sp]);

  // Navigate to search page on focus (if not already there)
  const handleSearchFocus = () => {
    if (!isOnSearchPage) {
      router.push('/explorer');
    }
  };

  const handleSearchSubmit = () => {
    const q = search.trim();
    router.push(q ? `/explorer?q=${encodeURIComponent(q)}` : '/explorer');
  };

  return (
    <>
      {/* HEADER FIXE - h-16 = 64px */}
      <header className="fixed top-0 left-0 right-0 z-[70] h-16 border-b border-gray-700/40 bg-pump-dark/95 backdrop-blur"> 
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          {/* Left side: logo + desktop nav */}
          <div className="flex min-w-0 items-center gap-5">
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

            <nav className="ml-6 hidden md:flex items-center gap-4">
              {/* Leaderboard */}
              <Link
                href="/leaderboard"
                className={`inline-flex items-center gap-1.5 border-b pb-0.5 text-sm font-medium transition ${
                  isLeaderboard
                    ? 'border-[#EAB54C] text-[#EAB54C]'
                    : 'border-transparent text-[#EAB54C] hover:text-[#F5C76A]'
                }`}
              >
                <span aria-hidden="true">🏆</span>
                Leaderboard
              </Link>

              {/* Live */}
              <Link
                href="/live"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-white hover:text-pump-green transition"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
                Live
              </Link>
            </nav>
          </div>

          {/* Search bar - hidden on mobile, visible on md+ */}
          <div className="hidden min-w-0 md:block md:flex-1 md:max-w-md lg:max-w-lg">
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
                onFocus={handleSearchFocus}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchSubmit();
                }}
                placeholder="Search markets, creators, categories..."
                className="w-full bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {/* Balance for the CURRENT mode, immediately left of the control
                it belongs to — the pair reads as one statement: this is your
                money, and this is which money it is. */}
            <ModeBalancePill variant="hero" />

            {/* Play / Real mode */}
            <ModeSwitch size="lg" variant="header" />

            {/* Create */}
            <Link
              href="/create"
              className="inline-flex h-8 items-center justify-center rounded-full bg-pump-green px-6 text-sm font-semibold text-black hover:bg-pump-green/90 transition"
            >
              Create
            </Link>

            {/* Avatar/Menu (always visible) */}
            <ProfileMenu trigger="avatar" />
          </div>
        </div>
      </header>

      {/* SPACER : h-16 = 64px (matches header height) */}
      <div className="h-16" />
    </>
  );
}
