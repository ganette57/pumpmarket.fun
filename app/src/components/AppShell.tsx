"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import MobileTopBar from "@/components/MobileTopBar";
import SiteFooter from "@/components/SiteFooter";

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
{!isTrade && <div className="hidden md:block"><SiteFooter /></div>}

      {/* Bottom nav mobile */}
      <MobileNav />
    </div>
  );
}