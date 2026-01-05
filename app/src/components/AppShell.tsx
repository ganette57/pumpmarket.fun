"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import MobileTopBar from "@/components/MobileTopBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSearch = pathname?.startsWith("/search");

  return (
    <>
      {/* Desktop header (gardé) */}
      <div className="hidden md:block">
        <Header />
      </div>

      {/* Mobile header (logo + name + wallet) + search ONLY sur /search */}
      <div className="md:hidden">
        <MobileTopBar showSearch={!!isSearch} />
      </div>

      {/* Main content: padding bottom pour la bottom nav */}
      <main className="min-h-screen pb-28 md:pb-0">{children}</main>

      {/* Footer desktop only */}
      <footer className="hidden md:block border-t border-gray-800 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-500 text-sm">
            <p>Funmarket.pump - Built on Solana Devnet</p>
            <p className="mt-2">Trade responsibly. Markets for entertainment only.</p>
          </div>
        </div>
      </footer>

      {/* Bottom nav mobile */}
      <MobileNav />
    </>
  );
}