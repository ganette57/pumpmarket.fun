"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import MobileTopBar from "@/components/MobileTopBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSearch = pathname?.startsWith("/search");
  const isTrade = pathname?.startsWith("/trade/");

  return (
    <div className={isTrade ? "md:h-screen md:flex md:flex-col md:overflow-hidden" : ""}>
      {/* Desktop header */}
      <div className="hidden md:block flex-shrink-0">
        <Header />
      </div>

      {/* Mobile header */}
      <div className="md:hidden">
        <MobileTopBar showSearch={!!isSearch} />
      </div>

      {/* Main content */}
      <main
        className={
          isTrade
            ? "flex-1 min-h-0 overflow-hidden pb-32 md:pb-0"
            : "min-h-screen pb-32 md:pb-0"
        }
      >
        {children}
      </main>

      {/* Footer desktop only - hidden on trade pages */}
      {!isTrade && (
        <footer className="hidden md:block border-t border-gray-800 mt-20 flex-shrink-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center text-gray-500 text-sm">
              <p>Funmarket.pump - Built on Solana Devnet</p>
              <p className="mt-2">Trade responsibly. Markets for entertainment only.</p>
            </div>
          </div>
        </footer>
      )}

      {/* Bottom nav mobile */}
      <MobileNav />
    </div>
  );
}