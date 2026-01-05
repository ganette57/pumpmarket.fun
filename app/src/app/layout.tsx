import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WalletContextProvider } from "@/components/WalletProvider";
import AppShell from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Funmarket.pump - Degen Prediction Markets",
  description: "Polymarket meets PumpFun on Solana - Create and trade prediction markets with bonding curves",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WalletContextProvider>
          <AppShell>{children}</AppShell>
        </WalletContextProvider>
      </body>
    </html>
  );
}