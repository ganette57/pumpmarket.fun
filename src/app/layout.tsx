import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { WalletProvider } from '@/components/WalletProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PumpMarket.fun - Decentralized Prediction Markets',
  description: 'Create and trade on prediction markets powered by Solana',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletProvider>
          <div className="min-h-screen">
            <nav className="border-b border-gray-800 bg-black/50 backdrop-blur-sm">
              <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between">
                  <a href="/" className="text-2xl font-bold text-primary">
                    PumpMarket.fun
                  </a>
                  <div className="flex gap-4 items-center">
                    <a href="/create" className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg transition">
                      Create Market
                    </a>
                    <div id="wallet-button"></div>
                  </div>
                </div>
              </div>
            </nav>
            {children}
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
