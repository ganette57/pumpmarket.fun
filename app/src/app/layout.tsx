import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { WalletContextProvider } from '@/components/WalletProvider';
import Header from '@/components/Header';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Funmarket.pump - Degen Prediction Markets',
  description: 'Polymarket meets PumpFun on Solana - Create and trade prediction markets with bonding curves',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletContextProvider>
          <Header />
          <main className="min-h-screen">
            {children}
          </main>
          <footer className="border-t border-gray-800 mt-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="text-center text-gray-500 text-sm">
                <p>Funmarket.pump - Built on Solana Devnet</p>
                <p className="mt-2">Trade responsibly. Markets for entertainment only.</p>
              </div>
            </div>
          </footer>
        </WalletContextProvider>
      </body>
    </html>
  );
}
