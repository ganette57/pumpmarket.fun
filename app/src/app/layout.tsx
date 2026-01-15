// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { WalletContextProvider } from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";
import LiveBuysTicker from "@/components/LiveBuysTicker";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Funmarket.pump - Degen Prediction Markets",
  description:
    "Polymarket meets PumpFun on Solana - Create and trade prediction markets with bonding curves",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletContextProvider>
          <AppShell>
            {children}

            {/* Desktop ticker (bottom of screen) */}
            <LiveBuysTicker
              variant="breaking"
              className="hidden md:block bottom-0"
            />

            {/* Mobile ticker (above mobile nav) */}
            <LiveBuysTicker variant="breaking" className="bottom-14 md:bottom-0" />
          </AppShell>
        </WalletContextProvider>
      </body>
    </html>
  );
}