import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "PumpMarket.fun - Decentralized Prediction Markets",
  description: "Create and trade on prediction markets powered by Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <WalletProvider>
          <div className="min-h-screen flex flex-col bg-gray-50">
            <Header />
            <main className="flex-1">
              {children}
            </main>
            <footer className="bg-white border-t border-gray-200 py-6">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600">
                <p>&copy; 2025 PumpMarket.fun - Powered by Solana & Supabase</p>
              </div>
            </footer>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
