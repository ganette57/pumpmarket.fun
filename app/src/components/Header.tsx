'use client';

import Link from 'next/link';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Header() {
  return (
    <header className="border-b border-gray-800 bg-pump-dark/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl font-bold">
                <span className="text-pump-green">Fun</span>
                <span className="text-white">market</span>
                <span className="text-pump-red">.pump</span>
              </span>
            </Link>
            <nav className="hidden md:flex space-x-6">
              <Link href="/" className="text-gray-300 hover:text-pump-green transition">
                Markets
              </Link>
              <Link href="/create" className="text-gray-300 hover:text-pump-green transition">
                Create
              </Link>
              <Link href="/dashboard" className="text-gray-300 hover:text-pump-green transition">
                Dashboard
              </Link>
            </nav>
          </div>
          <WalletMultiButton className="!bg-pump-green !text-black hover:!bg-green-400" />
        </div>
      </div>
    </header>
  );
}
