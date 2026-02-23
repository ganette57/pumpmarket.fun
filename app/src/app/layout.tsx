// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { WalletContextProvider } from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";
import LiveBuysTicker from "@/components/LiveBuysTicker";
import GeoGateController from "@/components/GeoGateController";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FunMarket — Prediction markets made simple, fun, and profitable.",
  description:
    "Turn opinions into markets. Create and trade prediction markets on Solana with multi-outcome pricing.",

  icons: {
    icon: "/favicon.ico",
    apple: "/favicon/apple-touch-icon.png",
  },

  manifest: "/favicon/site.webmanifest",
};



export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletContextProvider>
          <AppShell>
          <GeoGateController />
            {children}

            {/* Single ticker: bottom-14 on mobile (above nav), bottom-0 on desktop */}
            <LiveBuysTicker variant="breaking" className="bottom-14 md:bottom-0" />
          </AppShell>
        </WalletContextProvider>
      </body>
    </html>
  );
}