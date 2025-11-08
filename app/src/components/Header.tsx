'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { HelpCircle, Menu, X } from 'lucide-react';
import SearchBar from './SearchBar';
import HowItWorksModal from './HowItWorksModal';

export default function Header() {
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="border-b border-gray-800 bg-pump-dark/95 backdrop-blur-md sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
              <span className="text-2xl font-bold">
                <span className="text-pump-green">Fun</span>
                <span className="text-white">market</span>
                <span className="text-pump-red">.pump</span>
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-6 flex-shrink-0">
              <Link href="/" className="text-gray-300 hover:text-pump-green transition font-medium">
                Markets
              </Link>
              <Link
                href="/create"
                className="text-gray-300 hover:text-pump-green transition font-medium"
              >
                Create
              </Link>
              <Link
                href="/dashboard"
                className="text-gray-300 hover:text-pump-green transition font-medium"
              >
                Dashboard
              </Link>
            </nav>

            {/* Search Bar - Hidden on mobile */}
            <div className="hidden md:flex flex-1 max-w-md mx-6">
              <SearchBar />
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center space-x-4">
              {/* How It Works Button */}
              <button
                onClick={() => setShowHowItWorks(true)}
                className="hidden sm:flex items-center space-x-2 px-4 py-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition text-gray-300 hover:text-white"
              >
                <HelpCircle className="w-4 h-4" />
                <span className="font-medium">How It Works</span>
              </button>

              {/* Wallet Button */}
              <WalletMultiButton className="!bg-pump-green !text-black hover:!bg-green-400 !font-bold !rounded-lg !transition-all hover:!scale-105" />

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 text-gray-300 hover:text-white"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Search - Show below header on mobile */}
          <div className="md:hidden pb-4">
            <SearchBar />
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-gray-800 bg-pump-gray animate-slideDown">
            <div className="px-4 py-4 space-y-3">
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-pump-dark rounded-lg transition"
              >
                Markets
              </Link>
              <Link
                href="/create"
                onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-pump-dark rounded-lg transition"
              >
                Create Market
              </Link>
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="block px-4 py-3 text-gray-300 hover:text-white hover:bg-pump-dark rounded-lg transition"
              >
                Dashboard
              </Link>
              <button
                onClick={() => {
                  setShowHowItWorks(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left px-4 py-3 text-gray-300 hover:text-white hover:bg-pump-dark rounded-lg transition flex items-center space-x-2"
              >
                <HelpCircle className="w-4 h-4" />
                <span>How It Works</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* How It Works Modal */}
      <HowItWorksModal isOpen={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </>
  );
}
