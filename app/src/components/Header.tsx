'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { HelpCircle, Menu, X, Target, LayoutDashboard } from 'lucide-react';
import SearchBar from './SearchBar';
import HowItWorksModal from './HowItWorksModal';

export default function Header() {
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="border-b border-gray-800 bg-pump-dark/95 backdrop-blur-md sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-2 flex-shrink-0">
              <span className="text-xl font-bold">
                <span className="text-pump-green">Fun</span>
                <span className="text-white">market</span>
                <span className="text-pump-red">.pump</span>
              </span>
            </Link>

            {/* Centered Search Bar - Desktop */}
            <div className="hidden md:flex flex-1 max-w-2xl mx-8">
              <SearchBar />
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center space-x-3">
              {/* How It Works - Just Icon */}
              <button
                onClick={() => setShowHowItWorks(true)}
                className="hidden sm:flex items-center justify-center w-9 h-9 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition text-gray-400 hover:text-pump-green"
                title="How It Works"
              >
                <HelpCircle className="w-5 h-5" />
              </button>

              {/* Create Market Button - Pump.fun style */}
              <Link href="/create">
                <button className="hidden sm:flex items-center space-x-2 px-4 py-2 bg-pump-green hover:bg-green-400 text-black font-semibold rounded-lg transition-all hover:scale-105">
                  <Target className="w-4 h-4" />
                  <span>Create Market</span>
                </button>
              </Link>

              {/* Dashboard Icon */}
              <Link href="/dashboard">
                <button
                  className="hidden sm:flex items-center justify-center p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition text-gray-300 hover:text-white"
                  title="Dashboard"
                >
                  <LayoutDashboard className="w-5 h-5" />
                </button>
              </Link>

              {/* Wallet Button */}
              <WalletMultiButton className="!bg-transparent !border !border-gray-700 !text-white hover:!border-pump-green !font-medium !rounded-lg !transition-all !text-sm" />

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-300 hover:text-white"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Search - Show below header on mobile */}
          <div className="md:hidden pb-3 pt-2">
            <SearchBar />
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-800 bg-pump-gray animate-slideDown">
            <div className="px-4 py-4 space-y-2">
              <Link
                href="/create"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center space-x-2 px-4 py-3 bg-pump-green hover:bg-green-400 text-black font-semibold rounded-lg transition"
              >
                <Target className="w-4 h-4" />
                <span>Create Market</span>
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
