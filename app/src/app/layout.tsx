// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

import { WalletContextProvider } from "@/components/WalletProvider";
import PrivyAppProvider from "@/components/privy/PrivyAppProvider";
import { FunMarketWalletProvider } from "@/components/wallet/FunMarketWalletProvider";
import { AddFundsProvider } from "@/components/wallet/AddFundsProvider";
import AppShell from "@/components/AppShell";
import LiveBuysTicker from "@/components/LiveBuysTicker";
import GeoGateController from "@/components/GeoGateController";
import ReferralCapture from "@/components/ReferralCapture";
import { ModeProvider } from "@/components/mode/ModeProvider";
import { PlaySessionProvider } from "@/components/play/PlaySessionProvider";
import { MarketSnapshotProvider } from "@/components/mode/MarketSnapshotProvider";
import { FM_MODE_COOKIE, parseTradingMode } from "@/lib/tradingMode";

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
  // Read the trading mode on the SERVER so the first paint already shows the
  // correct PLAY/REAL state. Reading it on the client instead would render
  // the default first and then correct itself — a visible flash and a
  // hydration mismatch.
  //
  // Note: cookies() opts the app out of static prerendering. That is an
  // accepted trade for a correct first paint; see docs/play-mode-ui.md.
  const initialMode = parseTradingMode(cookies().get(FM_MODE_COOKIE)?.value);

  return (
    <html lang="en">
      <body className={inter.className}>
        <ModeProvider initialMode={initialMode}>
          {/* Privy outermost of the wallet providers: FunMarketWalletProvider
              reads Privy AND the wallet adapter, so both must already be
              mounted above it. */}
          <PrivyAppProvider>
            <WalletContextProvider>
              {/* The one wallet the rest of the app knows about: Privy
                  embedded or external, behind a single interface. */}
              <FunMarketWalletProvider>
                {/* Owns the one Add Funds modal. Mounted HERE, not inside
                    the header dropdown that opens it: the header is
                    `fixed … backdrop-blur`, which would capture the
                    modal's fixed positioning, and the dropdown's
                    click-outside would unmount it mid-use. */}
                <AddFundsProvider>
                {/* Play identity: a verified Privy login, or — for legacy
                    users — a wallet signature. */}
                <PlaySessionProvider>
                  <MarketSnapshotProvider>
                  <AppShell>
                  <GeoGateController />
                  <ReferralCapture />
                    {children}

                    {/* Single ticker: bottom-14 on mobile (above nav), bottom-0 on desktop */}
                    <LiveBuysTicker variant="breaking" className="bottom-14 md:bottom-0" />
                  </AppShell>
                  </MarketSnapshotProvider>
                </PlaySessionProvider>
                </AddFundsProvider>
              </FunMarketWalletProvider>
            </WalletContextProvider>
          </PrivyAppProvider>
        </ModeProvider>
      </body>
    </html>
  );
}