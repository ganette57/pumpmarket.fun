// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { WalletContextProvider } from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";
import LiveBuysTicker from "@/components/LiveBuysTicker";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FunMarket — Predict. Earn. Repeat.",
description:
  "Turn opinions into markets. Create and trade prediction markets on Solana with multi-outcome pricing.",
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